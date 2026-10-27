/* eslint-disable no-underscore-dangle -- App-local immutable KV protocol. */
import { listAppPolicies, saveAppPolicy } from '../services/appPolicyClient';
import { appPolicyKey } from '../services/appPolicies';
import { splunkRequest } from '../services/rest';
import { appPolicyFixture } from './appPolicyFixtures';
import { now } from './milestoneFixtures';

jest.mock('../services/rest', () => ({ splunkRequest: jest.fn() }));
jest.mock('@splunk/splunk-utils/url', () => ({ createRESTURL: (path: string) => `/servicesNS/nobody/content_hygiene/${path}` }));
const request = jest.mocked(splunkRequest);
let rows: Record<string, any>[];
let loseReply: boolean;
beforeEach(() => {
    rows = []; loseReply = false; request.mockReset();
    request.mockImplementation(async (path, init) => {
        const url = new URL(String(path), 'http://splunk.invalid');
        if (url.pathname.endsWith('/content_hygiene/review_revisions')) {
            if (init?.method !== 'POST') { return { coordinator: 1, standalone: true, app_policies: 1 }; }
            const envelope = JSON.parse(String(init.body));
            expect(envelope.kind).toBe('app_policy');
            const { proposal } = envelope;
            if (rows.some(row => row._key === proposal._key)) { throw new Error('Another operator saved first'); }
            rows.push({ ...proposal, created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(), updated_by: 'authenticated-operator' });
            if (loseReply) { throw new Error('Lost response after insert'); }
            return { _key: proposal._key };
        }
        expect(!init?.method || init.method === 'GET').toBe(true);
        expect(url.pathname).toBe('/servicesNS/nobody/content_hygiene/storage/collections/data/ch_app_policy_revisions');
        const after = JSON.parse(url.searchParams.get('query') ?? '{}')._key?.$gt ?? '';
        return rows.filter(row => row._key > after).sort((a, b) => a._key.localeCompare(b._key)).slice(0, 500);
    });
});
test.each([false, true])('accepted save read-back without unsafe retry, lost response %s', async lost => {
    const { app, data } = appPolicyFixture(); loseReply = lost;
    const result = await saveAppPolicy({ app, scanId: data.scan.scanId, state: 'active', note: 'Retain future shared objects', expected: null });
    expect(result.verified).toBe(true); expect(result.heads[0].updated_by).toBe('authenticated-operator');
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(rows).toHaveLength(1);
});
test('stale save preserves accepted history and requires explicit draft comparison', async () => {
    const { app, data, policy } = appPolicyFixture(); rows = [{ ...policy }];
    await expect(saveAppPolicy({ app, scanId: data.scan.scanId, state: 'active', note: 'Stale text', expected: null })).rejects.toThrow('Your draft is preserved');
    expect(rows).toEqual([policy]);
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
test('old coordinator readiness never submits a policy payload', async () => {
    const { app, data } = appPolicyFixture(); request.mockResolvedValue({ coordinator: 1, standalone: true });
    await expect(saveAppPolicy({ app, scanId: data.scan.scanId, state: 'active', note: '', expected: null })).rejects.toThrow('no policy write was attempted');
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
test('reversible disable still works when the app is no longer in inventory', async () => {
    const { app, data, policy } = appPolicyFixture(); rows = [{ ...policy }];
    const result = await saveAppPolicy({ app: { ...app, configurationFingerprint: undefined }, scanId: 'newer-unrelated-scan', state: 'disabled', note: 'Disable missing app policy', expected: policy });
    expect(result.heads[0]).toMatchObject({ state: 'disabled', app_fingerprint: policy.app_fingerprint, scan_id: data.scan.scanId });
});
test('keyset pagination reads every revision and repeats a consistent complete pass', async () => {
    const { policy } = appPolicyFixture();
    rows = Array.from({ length: 501 }, (_, index) => ({ ...policy, _key: appPolicyKey('example', index + 1), revision_number: index + 1,
        parent_revision: index ? appPolicyKey('example', index) : null }));
    const result = await listAppPolicies();
    expect(result.verified).toBe(true); expect(result.revisions).toHaveLength(501);
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls.every(([path]) => !String(path).includes('skip='))).toBe(true);
});
test('continually changing journal cannot be presented as a verified empty policy set', async () => {
    const { policy } = appPolicyFixture();
    request.mockImplementation(async () => [{ ...policy, note: String(Math.random()) }]);
    await expect(listAppPolicies()).rejects.toThrow('changed during pagination');
    expect(request).toHaveBeenCalledTimes(3);
});
test('permission denial is not empty policy state', async () => {
    request.mockRejectedValue(new Error('403 denied'));
    await expect(listAppPolicies()).rejects.toThrow('403 denied');
});
