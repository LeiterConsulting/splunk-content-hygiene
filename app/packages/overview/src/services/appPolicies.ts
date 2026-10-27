/* eslint-disable no-underscore-dangle -- Append-only KV revision protocol. */
import { ContentObject, InventorySnapshot, ReviewRecord } from '../types';
import { evidenceDigest } from './evidenceDigest';

export type AppPolicyState = 'active' | 'disabled' | 'archived';
export interface AppPolicyRevision {
    version: 1;
    _key: string;
    app_id: string;
    app_object_id: string;
    revision_number: number;
    parent_revision: string | null;
    state: AppPolicyState;
    note: string;
    scope: 'shared_exact_app_current_and_future';
    scan_id: string;
    app_fingerprint: string;
    request_id: string;
    created_at: string;
    updated_at: string;
    updated_by: string;
}
export interface AppPolicyStore {
    revisions: AppPolicyRevision[];
    heads: AppPolicyRevision[];
    verified: boolean;
    error: string | null;
}
export interface AppPolicyInput {
    app: ContentObject;
    scanId: string;
    state: AppPolicyState;
    note: string;
    expected: AppPolicyRevision | null;
}
export interface PolicyProtection {
    status: 'retained' | 'scope_unverified' | 'store_unverified' | 'none';
    blocksCleanup: boolean;
    policy: AppPolicyRevision | null;
    conflict: boolean;
    detail: string;
}
export function previewAppPolicy(snapshot: InventorySnapshot | null, app: string, reviews: ReviewRecord[], reviewsVerified: boolean): {
    objects: ContentObject[]; eligibilityIds: string[]; decisionsVerified: boolean;
} {
    const objects = snapshot?.objects.filter(row => row.app === app && ['app', 'global'].includes(row.sharing ?? '')) ?? [];
    const ids = new Set(objects.map(row => row.objectId));
    const decisions = reviews.filter(row => !row.removed && ids.has(row.objectId));
    return { objects, eligibilityIds: decisions.filter(row => row.stage === 'confirmed_eligible').map(row => row.objectId),
        decisionsVerified: reviewsVerified && !decisions.some(row => row.persistenceIssue) };
}
export const APP_POLICY_LIMIT = 10000;
export const appPolicyKey = (app: string, revision: number): string => `app-policy-r1-${evidenceDigest([app, revision])}`;
export const appPolicyIdentity = (app: string): string => `app::${app}::${app}`;
const appName = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const stamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));

/** Strict projection: malformed/duplicate/gapped history never grants retention. */
export function readAppPolicy(value: unknown): AppPolicyRevision | null {
    const row = value as AppPolicyRevision | undefined;
    if (!row || row.version !== 1 || !appName(row.app_id) || row.app_object_id !== appPolicyIdentity(row.app_id) ||
        !Number.isSafeInteger(row.revision_number) || row.revision_number < 1 || row.revision_number > APP_POLICY_LIMIT ||
        row._key !== appPolicyKey(row.app_id, row.revision_number) || row.parent_revision !== (row.revision_number === 1 ? null : appPolicyKey(row.app_id, row.revision_number - 1)) ||
        !['active', 'disabled', 'archived'].includes(row.state) || row.scope !== 'shared_exact_app_current_and_future' ||
        typeof row.note !== 'string' || row.note.length > 4000 || !hash(row.app_fingerprint) ||
        typeof row.scan_id !== 'string' || !row.scan_id || row.scan_id.length > 256 ||
        typeof row.request_id !== 'string' || !row.request_id || row.request_id.length > 128 ||
        !stamp(row.created_at) || !stamp(row.updated_at) || Date.parse(row.updated_at) < Date.parse(row.created_at) ||
        typeof row.updated_by !== 'string' || !row.updated_by || row.updated_by.length > 256) { return null; }
    return { version: 1, _key: row._key, app_id: row.app_id, app_object_id: row.app_object_id,
        revision_number: row.revision_number, parent_revision: row.parent_revision, state: row.state, note: row.note,
        scope: row.scope, scan_id: row.scan_id, app_fingerprint: row.app_fingerprint, request_id: row.request_id,
        created_at: row.created_at, updated_at: row.updated_at, updated_by: row.updated_by };
}
export function appPolicyStore(values: unknown[]): AppPolicyStore {
    const invalid = (): AppPolicyStore => ({ revisions: [], heads: [], verified: false,
        error: 'App retention policy history is invalid, incomplete or exceeds capacity. Preserve the journal; do not infer that content is unprotected.' });
    if (values.length > APP_POLICY_LIMIT) { return invalid(); }
    const revisions = values.map(readAppPolicy);
    if (revisions.some(row => !row)) { return invalid(); }
    const groups = new Map<string, AppPolicyRevision[]>();
    (revisions as AppPolicyRevision[]).forEach(row => { const list = groups.get(row.app_id) ?? []; list.push(row); groups.set(row.app_id, list); });
    const ordered = [...groups.values()].map(list => list.sort((a, b) => a.revision_number - b.revision_number));
    if (ordered.some(list => list.some((row, index) => row.revision_number !== index + 1 || row.created_at !== list[0].created_at ||
        index > 0 && Date.parse(row.updated_at) < Date.parse(list[index - 1].updated_at)))) { return invalid(); }
    const heads = ordered.map(list => list[list.length - 1]);
    return { revisions: revisions as AppPolicyRevision[], heads: heads.sort((a, b) => a.app_id.localeCompare(b.app_id)), verified: true, error: null };
}
export function appPolicyFingerprint(app: ContentObject | undefined): string | null {
    const fingerprint = app?.reviewEvidence?.configuration ?? app?.configurationFingerprint;
    return fingerprint?.version === 2 && fingerprint.accessComplete === true && hash(fingerprint.digest) && hash(fingerprint.accessDigest)
        ? evidenceDigest({ configuration: fingerprint.digest, access: fingerprint.accessDigest }) : null;
}
/** Protection is independent of health, activity and the saved individual decision. */
export function policyProtection(object: ContentObject, objects: ReadonlyMap<string, ContentObject>, store: AppPolicyStore,
    review?: ReviewRecord | null): PolicyProtection {
    const none: PolicyProtection = { status: 'none', blocksCleanup: false, policy: null, conflict: false, detail: 'No active exact-app retention policy applies.' };
    if (!store.verified) { return { ...none, status: 'store_unverified', blocksCleanup: true,
        detail: 'App retention policies could not be verified. Absence of policy protection cannot be established.' }; }
    const policy = store.heads.find(row => row.app_id === object.app && row.state === 'active');
    if (!policy || !['app', 'global'].includes(object.sharing ?? '') || /^Unresolved\b/.test(object.objectType)) { return none; }
    const app = objects.get(policy.app_object_id);
    const verified = app?.objectType === 'App' && app.app === policy.app_id && app.canonicalName === policy.app_id &&
        appPolicyFingerprint(app) === policy.app_fingerprint;
    const conflict = !review?.removed && review?.stage === 'confirmed_eligible';
    return { status: verified ? 'retained' : 'scope_unverified', blocksCleanup: true, policy, conflict,
        detail: `${verified ? 'Retained by an active exact-app policy, including future shared objects.' : 'An active policy names this app, but its current app identity/configuration cannot be verified; reconfirm its scope before cleanup.'} ${conflict ? 'The individual Confirmed eligible decision is preserved but conflicts with policy retention. Resolve the policy explicitly.' : 'Individual decisions, notes, assignees and evidence baselines are unchanged.'} This is not observed activity or complete dependency coverage.` };
}
/** Index the heads once; investigation pages should not scan policy history per row. */
export function buildPolicyProtection(snapshot: InventorySnapshot | null, store: AppPolicyStore, reviews: ReviewRecord[] = []): Map<string, PolicyProtection> {
    if (!snapshot) { return new Map(); }
    const objects = new Map(snapshot.objects.map(row => [row.objectId, row]));
    const reviewMap = new Map(reviews.map(row => [row.objectId, row]));
    const byApp = new Map(store.heads.map(row => [row.app_id, row]));
    return new Map(snapshot.objects.map(row => [row.objectId,
        policyProtection(row, objects, { ...store, heads: byApp.has(row.app) ? [byApp.get(row.app)!] : [] }, reviewMap.get(row.objectId))]));
}
