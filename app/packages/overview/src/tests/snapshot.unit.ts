/* eslint-disable no-underscore-dangle -- Splunk KV Store defines the _key protocol field. */
import { splunkInventoryClient } from '../services/inventory';

jest.mock('@splunk/splunk-utils/config', () => ({ username: 'operator', splunkdPath: '/splunkd' }));
jest.mock('@splunk/splunk-utils/fetch', () => ({ createFetchInit: (init: RequestInit) => init }));
jest.mock('@splunk/splunk-utils/url', () => ({
    createRESTURL: (path: string, namespace?: { owner?: string; app?: string }) =>
        namespace
            ? `/servicesNS/${namespace.owner ?? 'nobody'}/${namespace.app ?? 'content_hygiene'}/${path}`
            : `/services/${path}`,
}));

type Row = Record<string, any>;
const collections = new Map<string, Map<string, Row>>();
let failEdges = false;
let requests: Array<{ path: string; method: string; query?: string | null; fields?: string | null }> = [];
const reply = (data: unknown, status = 200): Response =>
    ({ status, text: async () => JSON.stringify(data), json: async () => data }) as Response;
function matches(row: Row, query: Row): boolean {
    return Object.entries(query).every(([key, value]) => {
        if (value && typeof value === 'object') {
            return '$in' in value ? value.$in.includes(row[key]) : row[key] !== value.$ne;
        }
        return row[key] === value;
    });
}

beforeEach(() => {
    collections.clear();
    failEdges = false;
    requests = [];
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        if (init.signal?.aborted) {
            const error = new Error('aborted');
            error.name = 'AbortError';
            throw error;
        }
        const url = new URL(String(input), 'https://lab.test');
        const method = init.method ?? 'GET';
        requests.push({ path: url.pathname, method, query: url.searchParams.get('query'), fields: url.searchParams.get('fields') });
        const kv = url.pathname.match(/\/storage\/collections\/data\/([^/]+)(.*)$/);
        if (kv) {
            const [, collection, suffix] = kv;
            const rows = collections.get(collection) ?? new Map<string, Row>();
            collections.set(collection, rows);
            const key = decodeURIComponent(suffix.slice(1));
            if (method === 'POST') {
                const body = JSON.parse(String(init.body));
                if (suffix === '/batch_save') {
                    const invalidKey = (value: unknown): boolean => {
                        if (Array.isArray(value)) { return value.some(invalidKey); }
                        return Boolean(value && typeof value === 'object' &&
                            Object.entries(value).some(([field, item]) => /\.|^\$/.test(field) || invalidKey(item)));
                    };
                    if (invalidKey(body)) { return reply({ error: 'Invalid KV batch field name' }, 400); }
                    if (collection === 'ch_edges' && failEdges) {
                        failEdges = false;
                        throw new Error('KV write interrupted');
                    }
                    body.forEach((record: Row) => rows.set(record._key, record));
                } else if (suffix) {
                    // Splunk KV updates replace rather than merge the document.
                    rows.set(key, { ...body, _key: key });
                } else {
                    if (rows.has(body._key)) {
                        return reply({}, 409);
                    }
                    rows.set(body._key, body);
                }
                return reply({}, 201);
            }
            const query = JSON.parse(url.searchParams.get('query') ?? '{}');
            if (method === 'DELETE') {
                if (suffix) {
                    rows.delete(key);
                } else {
                    rows.forEach((row, rowKey) => {
                        if (matches(row, query)) {
                            rows.delete(rowKey);
                        }
                    });
                }
                return reply(null, 204);
            }
            if (suffix) {
                return rows.has(key) ? reply(rows.get(key)) : reply({}, 404);
            }
            const sorted = Array.from(rows.values())
                .filter((row) => matches(row, query))
                .sort((a, b) =>
                    url.searchParams.get('sort')?.includes('started_at')
                        ? String(b.started_at).localeCompare(a.started_at)
                        : String(a._key).localeCompare(b._key),
                );
            const skip = Number(url.searchParams.get('skip') ?? 0);
            return reply(sorted.slice(skip, skip + Number(url.searchParams.get('limit') ?? 1000)));
        }
        if (method === 'POST' && url.pathname.endsWith('/search/jobs')) {
            expect(String(init.body)).toContain('exec_mode=oneshot');
            return reply({ results: [] }, 201);
        }
        if (method !== 'GET') {
            throw new Error(`Customer resource mutation: ${url.pathname}`);
        }
        const app = {
            name: 'example',
            acl: { app: 'example', owner: 'nobody', sharing: 'app' },
            content: { disabled: false },
        };
        let entries: Row[] = [];
        if (url.pathname.endsWith('/apps/local')) {
            entries = [app];
        }
        if (url.pathname.endsWith('/saved/searches')) {
            entries = [
                {
                    ...app,
                    name: 'Daily',
                    content: { disabled: false, search: '| makeresults', is_scheduled: false, 'dispatch.earliest_time': '-24h' },
                },
                {
                    ...app,
                    name: 'Private',
                    acl: { app: 'example', owner: 'secret-owner', sharing: 'user' },
                    content: { search: '| makeresults' },
                },
            ];
        }
        if (url.pathname.endsWith('/authentication/users')) {
            entries = [{ name: 'operator', content: {} }];
        }
        return reply({ entry: entries, paging: { total: entries.length } });
    }) as jest.Mock;
});

test('interrupted persistence and cancellation preserve the complete baseline; bounded scans cannot replace it', async () => {
    const first = await splunkInventoryClient.runFullScan();
    const baseline = first.scan.scanId;
    expect(first.objects).toHaveLength(2);
    expect(first.objects.some((item) => item.sharing === 'user')).toBe(false);
    expect(first.scan.edgeCount).toBe(1);

    failEdges = true;
    await expect(splunkInventoryClient.runFullScan()).rejects.toThrow('previous snapshot');
    const afterFailure = await splunkInventoryClient.getLatestSnapshot();
    expect(afterFailure?.scan.scanId).toBe(baseline);
    expect(afterFailure?.objects).toEqual(first.objects);

    await expect(
        splunkInventoryClient.runFullScan((progress) => {
            if (progress.stage === 'Collecting dashboards') {
                splunkInventoryClient.cancelScan?.();
            }
        }),
    ).rejects.toThrow('cancelled');
    expect((await splunkInventoryClient.getLatestSnapshot())?.scan.scanId).toBe(baseline);

    const bounded = await splunkInventoryClient.runBoundedScan();
    expect(bounded.scan.scanId).toBe(baseline);
    expect(bounded.scan.retainedBaseline).toBe(true);
    expect(bounded.latestCheck?.scanType).toBe('bounded');
    expect(bounded.objects).toEqual(first.objects);
    expect(
        requests
            .filter((request) => request.method !== 'GET')
            .every((request) =>
                request.path.includes(
                    '/servicesNS/nobody/content_hygiene/storage/collections/data/',
                ),
            ),
    ).toBe(true);
    expect(JSON.stringify(Array.from(collections.get('ch_objects')!.values()))).not.toContain(
        'secret-owner',
    );
});

test('reads reject a corrupted published snapshot and summary pages skip graph and owner downloads', async () => {
    const first = await splunkInventoryClient.runFullScan();
    requests = [];
    const overview = await splunkInventoryClient.getLatestSnapshot('overview');
    expect(overview?.scan.edgeCount).toBe(first.edges.length);
    expect(overview?.edges).toHaveLength(0);
    expect(requests.some((request) => /ch_edges|ch_owners/.test(request.path))).toBe(false);
    expect(requests.find((request) => /ch_objects$/.test(request.path))?.fields)
        .toBe('source:0,configuration_fingerprint:0,review_evidence:0');
    requests = [];
    await splunkInventoryClient.getLatestSnapshot('review-library');
    expect(requests.find((request) => /ch_objects$/.test(request.path))?.fields)
        .toBe('source:0,configuration_fingerprint:0');
    collections.get('ch_objects')!.delete(Array.from(collections.get('ch_objects')!.keys())[0]);
    await expect(splunkInventoryClient.getLatestSnapshot()).rejects.toThrow(
        'integrity verification',
    );
});

test('retention after cancellation and telemetry never issues an empty deletion filter', async () => {
    const first = await splunkInventoryClient.runFullScan();
    const storedBefore = JSON.stringify(Array.from(collections.get('ch_objects')!.values()));
    collections
        .get('ch_scan_runs')!
        .set('scan-malformed', { _key: 'scan-malformed', status: 'cancelled' });
    collections
        .get('ch_scan_runs')!
        .set('scan-superseded', {
            _key: 'scan-superseded',
            scan_id: 'scan-superseded',
            scan_type: 'full',
            status: 'succeeded',
            started_at: '2020-01-01T00:00:00Z',
        });
    await expect(
        splunkInventoryClient.runFullScan((progress) => {
            if (progress.stage === 'Collecting dashboards') {splunkInventoryClient.cancelScan?.();}
        }),
    ).rejects.toThrow('cancelled');
    const cancelled = Array.from(collections.get('ch_scan_runs')!.values()).find(
        (record) => record.status === 'cancelled' && record.scan_id,
    );
    expect(cancelled).toMatchObject({ scan_type: 'full', snapshot_version: 2 });
    const after = await splunkInventoryClient.runUsageScan(30);
    expect(after.scan.scanId).toBe(first.scan.scanId);
    expect(after.objects).toHaveLength(first.objects.length);
    const storedAfter = Array.from(collections.get('ch_objects')!.values()).filter(
        (record) => record.scan_id === first.scan.scanId,
    );
    expect(JSON.stringify(storedAfter)).toBe(storedBefore);
    const bulkDeletes = requests.filter((request) => request.method === 'DELETE' && request.query);
    expect(bulkDeletes.length).toBeGreaterThanOrEqual(5);
    expect(bulkDeletes.every((request) => /^scan-/.test(JSON.parse(request.query!).scan_id))).toBe(
        true,
    );
});
