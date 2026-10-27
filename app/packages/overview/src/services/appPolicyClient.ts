/* eslint-disable no-underscore-dangle, no-await-in-loop -- Keyset reads and append-only KV identities. */
import { createRESTURL } from '@splunk/splunk-utils/url';
import { splunkRequest } from './rest';
import { APP_POLICY_LIMIT, AppPolicyInput, AppPolicyRevision, AppPolicyStore, appPolicyFingerprint, appPolicyIdentity, appPolicyKey, appPolicyStore } from './appPolicies';
import { evidenceDigest } from './evidenceDigest';

const collection = (): string => createRESTURL('storage/collections/data/ch_app_policy_revisions', { owner: 'nobody', app: 'content_hygiene' });
export const EMPTY_POLICY_STORE = appPolicyStore([]);
async function readJournal(): Promise<AppPolicyStore> {
    const all: unknown[] = [];
    let after = '';
    while (all.length <= APP_POLICY_LIMIT) {
        const params = new URLSearchParams({ limit: '500', sort: '_key:1', ...(after ? { query: JSON.stringify({ _key: { $gt: after } }) } : {}) });
        const page = await splunkRequest<AppPolicyRevision[]>(`${collection()}?${params}`);
        const start = after;
        if (!Array.isArray(page) || page.length > 500 || page.some((row, index) => !row || typeof row._key !== 'string' || row._key <= start || index > 0 && row._key <= page[index - 1]._key)) {
            throw new Error('App retention policy pagination could not be verified.');
        }
        all.push(...page);
        if (page.length < 500) { return appPolicyStore(all); }
        after = page[page.length - 1]._key;
    }
    throw new Error('App retention policy journal capacity reached. Preserve and export its history before further changes.');
}
export async function listAppPolicies(): Promise<AppPolicyStore> {
    let previous = await readJournal();
    if (!previous.verified) { return previous; }
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = await readJournal();
        if (!current.verified || evidenceDigest(previous.revisions) === evidenceDigest(current.revisions)) { return current; }
        previous = current;
    }
    throw new Error('App retention policy history changed during pagination. Reload it before relying on policy scope.');
}
export async function saveAppPolicy(input: AppPolicyInput): Promise<AppPolicyStore> {
    const fingerprint = input.state === 'active' ? appPolicyFingerprint(input.app) : input.expected?.app_fingerprint;
    if (input.app.objectType !== 'App' || input.app.objectId !== appPolicyIdentity(input.app.app) || !fingerprint) {
        throw new Error('A current app identity and complete configuration/ACL fingerprint are required. Run a complete scan.');
    }
    const endpoint = createRESTURL('content_hygiene/review_revisions', { owner: 'nobody', app: 'content_hygiene' });
    const readiness = await splunkRequest<{ app_policies?: number; standalone?: boolean }>(endpoint);
    if (readiness.app_policies !== 1 || readiness.standalone !== true) {
        throw new Error('The installed app-policy coordinator is not active. Ask the administrator to activate the upgraded app runtime; no policy write was attempted. Existing review decisions are unchanged.');
    }
    const number = (input.expected?.revision_number ?? 0) + 1;
    // getRandomValues also works on Splunk Web's permitted HTTP lab origins;
    // randomUUID is secure-context-only in browsers.
    const requestId = [...globalThis.crypto.getRandomValues(new Uint32Array(4))].map(part => part.toString(16)).join('-');
    const proposal = { version: 1, _key: appPolicyKey(input.app.app, number), app_id: input.app.app,
        app_object_id: input.app.objectId, revision_number: number, parent_revision: input.expected?._key ?? null,
        state: input.state, note: input.note, scope: 'shared_exact_app_current_and_future', scan_id: input.state === 'active' ? input.scanId : input.expected!.scan_id,
        app_fingerprint: fingerprint, request_id: requestId };
    let failure: unknown;
    try {
        await splunkRequest(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'app_policy', proposal }),
        }, [200, 201]);
    } catch (error) { failure = error; }
    // No automatic POST retry, including a lost response. Accept only an exact
    // attributable saved request; otherwise preserve the draft and require reload.
    try {
        const latest = await listAppPolicies();
        const accepted = latest.revisions.find(row => row._key === proposal._key && row.request_id === requestId);
        if (latest.verified && accepted && accepted.state === proposal.state && accepted.note === proposal.note &&
            accepted.parent_revision === proposal.parent_revision && accepted.app_fingerprint === proposal.app_fingerprint && accepted.scan_id === proposal.scan_id) { return latest; }
    } catch { /* Keep the original error below, never report an unverified save. */ }
    throw new Error(`${failure instanceof Error ? failure.message : 'The policy save could not be confirmed.'} Your draft is preserved. Reload policy history and compare before retrying; no existing decision was replaced.`);
}
