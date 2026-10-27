/* eslint-disable no-underscore-dangle -- Splunk KV Store defines the _key protocol field. */
import { splunkInventoryClient } from '../services/inventory';
import { field as declaredField } from './fieldFixtures';

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
let failAutomatic = false;
let automaticEntries: Row[] = [];
let eventTypeEntries: Row[] = [];
let tagEntries: Row[] = [];
let failKnowledge = false;
let fieldEntries: Record<string, Row[]> = {};
let failFields = false;
let fieldPaging: 'normal' | 'repeat' | 'missing_total' | 'shrinking_total' = 'normal';
let tagPaging: 'normal' | 'repeat' | 'missing_total' | 'shrinking_total' = 'normal';
let sourceSearch = '| makeresults';
let requests: Array<{ path: string; method: string; query?: string | null; fields?: string | null; offset?: string | null }> = [];
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
    failAutomatic = false;
    automaticEntries = [];
    eventTypeEntries = [];
    tagEntries = [];
    failKnowledge = false;
    fieldEntries = {};
    failFields = false;
    fieldPaging = 'normal';
    tagPaging = 'normal';
    sourceSearch = '| makeresults';
    requests = [];
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        if (init.signal?.aborted) {
            const error = new Error('aborted');
            error.name = 'AbortError';
            throw error;
        }
        const url = new URL(String(input), 'https://lab.test');
        const method = init.method ?? 'GET';
        requests.push({ path: url.pathname, method, query: url.searchParams.get('query'), fields: url.searchParams.get('fields'), offset: url.searchParams.get('offset') });
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
        const fieldEndpoint = ['data/props/extractions', 'data/props/fieldaliases', 'data/props/calcfields', 'data/transforms/extractions'].find(endpoint => url.pathname.endsWith(`/${endpoint}`));
        if (fieldEndpoint) {
            if (failFields) { return reply({}, 403); }
            const rows = fieldEntries[fieldEndpoint] ?? [];
            const offset = fieldPaging === 'repeat' ? 0 : Number(url.searchParams.get('offset') ?? 0); const count = Number(url.searchParams.get('count') ?? 200);
            return reply({ entry: rows.slice(offset, offset + count),
                ...(fieldPaging === 'missing_total' ? {} : { paging: { total: fieldPaging === 'shrinking_total' && offset > 0 ? rows.length - 1 : rows.length } }) });
        }
        if (url.pathname.endsWith('/saved/eventtypes') || url.pathname.endsWith('/configs/conf-tags')) {
            if (failKnowledge) { return reply({}, 403); }
            const tags = url.pathname.endsWith('/configs/conf-tags');
            const rows = tags ? tagEntries : eventTypeEntries;
            const offset = tags && tagPaging === 'repeat' ? 0 : Number(url.searchParams.get('offset') ?? 0);
            const count = Number(url.searchParams.get('count') ?? 200);
            return reply({ entry: rows.slice(offset, offset + count),
                ...(tags && tagPaging === 'missing_total' ? {} : { paging: { total: tags && tagPaging === 'shrinking_total' && offset > 0 ? rows.length - 1 : rows.length } }) });
        }
        if (url.pathname.endsWith('/data/props/lookups')) {
            if (failAutomatic) { return reply({}, 403); }
            const offset = Number(url.searchParams.get('offset') ?? 0);
            const count = Number(url.searchParams.get('count') ?? 200);
            return reply({ entry: automaticEntries.slice(offset, offset + count), paging: { total: automaticEntries.length } });
        }
        if (url.pathname.endsWith('/apps/local')) {
            entries = [app];
        }
        if (url.pathname.endsWith('/saved/searches')) {
            entries = [
                {
                    ...app,
                    name: 'Daily',
                    content: { disabled: false, search: sourceSearch, is_scheduled: false, 'dispatch.earliest_time': '-24h' },
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

test('native field catalogs persist compact facts and exact edge provenance with GET-only customer requests', async () => {
    const transform = declaredField('field_transforms', 'extract_actor', 'actor::$1');
    const report = declaredField('field_extractions', 'REPORT-actor', 'extract_actor extract_actor');
    const alias = declaredField('field_aliases', 'FIELDALIAS-actor', 'actor ASNEW principal');
    const calc = declaredField('calculated_fields', 'EVAL-normalized', 'coalesce(principal,"private_literal_must_not_be_cached")');
    fieldEntries = { 'data/transforms/extractions': [transform.entry], 'data/props/extractions': [report.entry],
        'data/props/fieldaliases': [alias.entry], 'data/props/calcfields': [calc.entry] };
    sourceSearch = 'sourcetype=example:events';
    const original = { _key: 'original', object_id: 'original', stage: 'retain', note: 'Unchanged original review' };
    collections.set('ch_reviews', new Map([['original', original]]));
    const result = await splunkInventoryClient.runFullScan();
    expect(result.scan.collectorCounts).toMatchObject({ field_extractions: 1, field_aliases: 1, calculated_fields: 1, field_transforms: 1 });
    expect(result.objects.find(row => row.objectType === 'Calculated Field')?.fieldLineage).toMatchObject({ inputs: ['principal'], outputs: ['normalized'], syntax: 'declared' });
    const edge = result.edges.find(row => row.relation === 'may_use_field_transform');
    expect(edge?.fieldProvenance).toMatchObject({ transformPositions: [1, 2], contextApps: ['example'] });
    const storedEdge = [...collections.get('ch_edges')!.values()].find(row => row.relation === 'may_use_field_transform');
    expect(storedEdge).toMatchObject({ field_provenance: edge?.fieldProvenance });
    const stored = JSON.stringify([...collections.get('ch_objects')!.values()]);
    expect(stored).not.toContain('private_literal_must_not_be_cached');
    expect(stored).not.toContain('coalesce(');
    expect(stored).not.toContain('actor::$1');
    expect(result.objects.find(row => row.objectType === 'Calculated Field')?.reviewEvidence?.coverage?.policy).toBe('shared-static-v4');
    expect([...collections.get('ch_reviews')!.values()]).toEqual([original]);
    expect(requests.filter(row => row.method !== 'GET').every(row => row.path.includes('/storage/collections/data/') && !/\/ch_review/.test(row.path))).toBe(true);
});

test.each(['inline', 'transform'] as const)('%s output provenance survives collection, KV publication and cache reload without review writes', async operation => {
    const extraction = declaredField('field_extractions', operation === 'inline' ? 'EXTRACT-actor' : 'REPORT-actor',
        operation === 'inline' ? '(prefix)(?<actor>synthetic-secret-pattern)' : 'extract_actor');
    const transform = declaredField('field_transforms', 'extract_actor', '', 'example', 'app', 'example:events', { REGEX: '(prefix)(?<actor>synthetic-secret-pattern)' });
    const alias = declaredField('field_aliases', 'FIELDALIAS-actor', 'actor ASNEW principal');
    fieldEntries = { 'data/transforms/extractions': operation === 'transform' ? [transform.entry] : [],
        'data/props/extractions': [extraction.entry], 'data/props/fieldaliases': [alias.entry], 'data/props/calcfields': [] };
    const original = { _key: 'original', object_id: 'original', stage: 'retain', note: 'Original note', evidence_baseline: { version: 1 } };
    const journal = { _key: 'revision', object_id: 'original', revision_id: 'revision', note: 'Original revision' };
    collections.set('ch_reviews', new Map([['original', original]]));
    collections.set('ch_review_revisions', new Map([['revision', journal]]));
    const result = await splunkInventoryClient.runFullScan();
    const origin = result.objects.find(row => row.objectId === (operation === 'inline' ? extraction : transform).item.objectId);
    // Fixture display IDs differ from native IDs; match the exact native name/type.
    const nativeOrigin = origin ?? result.objects.find(row => row.canonicalName === (operation === 'inline' ? extraction : transform).entry.name)!;
    expect(nativeOrigin.fieldLineage?.outputProvenance).toMatchObject({ method: operation === 'inline' ? 'inline_named_captures' : 'transform_named_captures',
        declarations: [{ field: 'actor', capture: 2, offset: 8 }] });
    const edge = result.edges.find(row => row.relation === 'may_read_extracted_field')!;
    expect(edge.fieldProvenance?.outputDeclarations).toMatchObject([{ field: 'actor', objectId: nativeOrigin.objectId, capture: 2, offset: 8 }]);
    expect([...collections.get('ch_edges')!.values()].find(row => row.relation === edge.relation)).toMatchObject({ field_provenance: edge.fieldProvenance });
    expect(result.scan.collectorVersions).toMatchObject({ field_lineage: '1.2.0', dependency_analysis: '1.5.0' });
    const cached = await splunkInventoryClient.getLatestSnapshot();
    expect(cached?.objects.find(row => row.objectId === nativeOrigin.objectId)?.fieldLineage).toEqual(nativeOrigin.fieldLineage);
    expect(cached?.edges.find(row => row.edgeId === edge.edgeId)?.fieldProvenance).toEqual(edge.fieldProvenance);
    expect(JSON.stringify([...collections.get('ch_objects')!.values()])).not.toContain('synthetic-secret-pattern');
    expect([...collections.get('ch_reviews')!.values()]).toEqual([original]);
    expect([...collections.get('ch_review_revisions')!.values()]).toEqual([journal]);
    expect(requests.filter(row => row.method !== 'GET').every(row => row.path.includes('/storage/collections/data/') && !/\/ch_review/.test(row.path))).toBe(true);
});

test('field native pagination separates shared records and excluded private entries and a denial retains the full baseline', async () => {
    fieldEntries['data/props/fieldaliases'] = Array.from({ length: 201 }, (_unused, index) => {
        const definition = declaredField('field_aliases', `FIELDALIAS-example-${index}`, 'actor.name ASNEW principal');
        return { ...definition.entry, acl: { ...definition.entry.acl, sharing: index === 200 ? 'user' : 'app' } };
    });
    const result = await splunkInventoryClient.runFullScan();
    expect(result.scan.collectorCounts.field_aliases).toBe(200);
    expect(result.scan.collectorTotals.field_aliases).toBe(201);
    expect(result.scan.collectorNativeCounts?.field_aliases).toBe(201);
    expect(requests.filter(row => row.path.endsWith('/data/props/fieldaliases')).map(row => row.offset)).toEqual(['0', '200']);
    expect(JSON.stringify([...collections.get('ch_objects')!.values()])).not.toContain('FIELDALIAS-example-200');
    failFields = true;
    const partial = await splunkInventoryClient.runFullScan();
    expect(partial.scan.scanId).toBe(result.scan.scanId);
    expect(partial.scan.retainedBaseline).toBe(true);
    expect(partial.latestCheck?.warnings.join(' ')).toContain('Field aliases (props)');
});

test('an excluded private transform with an unavailable app cannot establish a shared REPORT binding', async () => {
    const transform = declaredField('field_transforms', 'extract_actor', 'actor::$1');
    const report = declaredField('field_extractions', 'REPORT-actor', 'extract_actor');
    const privateRow = { ...transform.entry, acl: { ...transform.entry.acl, app: '', sharing: 'user' } };
    fieldEntries = { 'data/transforms/extractions': [transform.entry, privateRow], 'data/props/extractions': [report.entry] };
    const result = await splunkInventoryClient.runFullScan();
    expect(result.edges.find(row => row.relation === 'may_use_field_transform')).toMatchObject({ resolved: false, confidence: 'unknown' });
    expect(result.objects.find(row => row.objectType === 'Field Extraction')?.healthStatus).not.toBe('broken');
    expect(result.scan.warnings.join(' ')).toContain('private object(s) excluded');
});

test.each(['missing_total', 'repeat', 'shrinking_total'] as const)('strict field paging cannot replace a verified baseline: %s', async mode => {
    const first = await splunkInventoryClient.runFullScan();
    fieldEntries['data/props/fieldaliases'] = Array.from({ length: 201 }, (_value, index) => declaredField('field_aliases', `FIELDALIAS-${index}`, 'actor AS principal').entry);
    fieldPaging = mode;
    const result = await splunkInventoryClient.runFullScan();
    expect(result.scan.scanId).toBe(first.scan.scanId);
    expect(result.scan.retainedBaseline).toBe(true);
    expect(result.latestCheck?.warnings.join(' ')).toContain('Field aliases (props)');
    expect(result.latestCheck?.analysisStatus).toBe('partial');
});

test('native automatic lookup collection paginates, excludes private identities and retains only declared field names/mappings, not raw declarations', async () => {
    automaticEntries = Array.from({ length: 201 }, (_, index) => ({
        name: `events : LOOKUP-example-${index}`,
        acl: { app: 'example', owner: 'nobody', sharing: index === 200 ? 'user' : 'app' },
        content: { stanza: 'events', attribute: `LOOKUP-example-${index}`, transform: 'owners', type: 'LOOKUP', value: 'owners key OUTPUT declared_output_name', 'lookup.field.output.0': 'owner' },
    }));
    const result = await splunkInventoryClient.runFullScan();
    expect(result.scan.collectorCounts.automatic_lookups).toBe(200);
    expect(result.scan.collectorTotals.automatic_lookups).toBe(201);
    expect(requests.filter((row) => row.path.endsWith('/data/props/lookups')).map((row) => row.offset)).toEqual(['0', '200']);
    const automatic = result.objects.filter((row) => row.objectType === 'Automatic Lookup');
    expect(automatic).toHaveLength(200);
    expect(automatic[0].configurationFingerprint).toMatchObject({ version: 2, digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(result.edges.filter((row) => row.relation === 'uses_lookup')).toHaveLength(200);
    const stored = JSON.stringify(Array.from(collections.get('ch_objects')!.values()));
    expect(stored).not.toContain('owners key OUTPUT declared_output_name');
    expect(automatic[0].fieldLineage).toMatchObject({ outputs: ['declared_output_name'], lookupMapping: { outputMode: 'OUTPUT', outputs: [{ lookupField: 'declared_output_name', eventField: 'declared_output_name' }] } });
    expect(stored).not.toContain('LOOKUP-example-200');
    expect(requests.filter((row) => row.method !== 'GET').every((row) => row.path.includes('/storage/collections/data/'))).toBe(true);
});

test('a failed automatic lookup collector cannot replace a complete published baseline', async () => {
    const first = await splunkInventoryClient.runFullScan();
    failAutomatic = true;
    const partial = await splunkInventoryClient.runFullScan();
    expect(partial.scan.scanId).toBe(first.scan.scanId);
    expect(partial.scan.retainedBaseline).toBe(true);
    expect(partial.latestCheck?.warnings.join(' ')).toContain('Automatic lookup rules (props)');
    expect(partial.latestCheck?.analysisStatus).toBe('partial');
});

test('native event-type/tag scans preserve reviews, separate stanza/object counts and keep customer content GET-only', async () => {
    const acl = { app: 'example', owner: 'nobody', sharing: 'app', perms: { read: ['user'], write: ['admin'] } };
    eventTypeEntries = [
        { name: 'Purchase', acl, content: { search: 'sourcetype=events sensitive_source_payload=example', disabled: '0' } },
        { name: 'private-sensitive-event-type', acl: { ...acl, sharing: 'user' }, content: { search: '*', disabled: '0' } },
    ];
    tagEntries = [
        { name: 'eventtype=Purchase', acl, content: { disabled: '0', commerce: 'enabled', retired: 'disabled' } },
        { name: 'eventtype=private-sensitive-event-type', acl: { ...acl, sharing: 'user' }, content: { disabled: '0', privateTag: 'enabled' } },
    ];
    sourceSearch = 'eventtype=Purchase tag=commerce';
    const legacy = { _key: 'original', stage: 'retain', note: 'Preserve this decision' };
    const journal = { _key: 'revision', revision_id: 'original', stage: 'retain', note: 'Preserve history' };
    collections.set('ch_reviews', new Map([['original', legacy]]));
    collections.set('ch_review_revisions', new Map([['revision', journal]]));
    const before = JSON.stringify([legacy, journal]);
    const result = await splunkInventoryClient.runFullScan();
    expect(result.scan.collectorCounts).toMatchObject({ event_types: 1, tag_bindings: 2 });
    expect(result.scan.collectorNativeCounts).toMatchObject({ event_types: 2, tag_bindings: 2 });
    expect(result.scan.collectorTotals).toMatchObject({ event_types: 2, tag_bindings: 2 });
    const event = result.objects.find(row => row.objectType === 'Event Type')!;
    const tags = result.objects.filter(row => row.objectType === 'Tag Binding');
    expect(event.objectId).toBe('event_type::example::Purchase');
    expect(tags).toHaveLength(2);
    expect(result.edges).toEqual(expect.arrayContaining([
        expect.objectContaining({ relation: 'matches_event_type', targetId: event.objectId, resolved: true }),
        expect.objectContaining({ relation: 'matches_tag', targetId: tags.find(row => row.enabled === true)!.objectId, resolved: true }),
        expect.objectContaining({ relation: 'tags_event_type', targetId: event.objectId, resolved: true }),
        expect.objectContaining({ relation: 'may_tag_event_type', targetId: event.objectId, resolved: true }),
    ]));
    const persisted = JSON.stringify([...collections.get('ch_objects')!.values()]);
    expect(persisted).not.toContain('private-sensitive');
    expect(persisted).not.toContain('sensitive_source_payload');
    expect(JSON.stringify([collections.get('ch_reviews')!.get('original'), collections.get('ch_review_revisions')!.get('revision')])).toBe(before);
    expect(requests.filter(row => row.path.endsWith('/saved/eventtypes') || row.path.endsWith('/configs/conf-tags')).every(row => row.method === 'GET')).toBe(true);
    expect(requests.some(row => row.path.endsWith('/search/jobs'))).toBe(false);
    expect(requests.filter(row => row.method !== 'GET').every(row => row.path.includes('/storage/collections/data/'))).toBe(true);
});

test.each(['missing_total', 'repeat', 'shrinking_total'] as const)('unqualified native tag paging cannot replace a verified baseline: %s', async (mode) => {
    const first = await splunkInventoryClient.runFullScan();
    tagEntries = Array.from({ length: 201 }, (_value, index) => ({ name: `host=example${index}`,
        acl: { app: 'example', owner: 'nobody', sharing: 'app' }, content: { disabled: '0', exampleTag: 'enabled' } }));
    tagPaging = mode;
    const result = await splunkInventoryClient.runFullScan();
    expect(result.scan.scanId).toBe(first.scan.scanId);
    expect(result.scan.retainedBaseline).toBe(true);
    expect(result.latestCheck?.warnings.join(' ')).toMatch(/Tag binding stanzas/);
    expect(result.latestCheck?.analysisStatus).toBe('partial');
});

test('an unavailable new catalog retains the old baseline, while semantic gaps alone do not hide newly collected objects', async () => {
    const first = await splunkInventoryClient.runFullScan();
    failKnowledge = true;
    const failed = await splunkInventoryClient.runFullScan();
    expect(failed.scan.scanId).toBe(first.scan.scanId);
    failKnowledge = false;
    eventTypeEntries = [{ name: 'builtin', acl: { app: 'system', owner: 'nobody', sharing: 'system' }, content: { disabled: '0', search: '*' } }];
    tagEntries = [{ name: 'eventtype=Example%20Encoded', acl: { app: 'example', owner: 'nobody', sharing: 'app' },
        content: { disabled: '0', exampleTag: 'enabled' } }];
    const semantic = await splunkInventoryClient.runFullScan();
    expect(semantic.scan.scanId).not.toBe(first.scan.scanId);
    expect(semantic.objects.some(row => row.objectType === 'Tag Binding')).toBe(true);
    expect(semantic.scan.analysisStatus).toBe('partial');
    expect(semantic.edges.some(row => row.relation === 'tags_event_type')).toBe(false);
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
    requests = [];
    const report = await splunkInventoryClient.getLatestSnapshot('in-use-content');
    expect(report?.edges).toHaveLength(first.edges.length);
    expect(requests.some((request) => /ch_edges$/.test(request.path))).toBe(true);
    expect(requests.some((request) => /ch_owners$/.test(request.path))).toBe(false);
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
