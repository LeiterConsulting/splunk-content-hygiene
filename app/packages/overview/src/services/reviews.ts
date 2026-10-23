/* eslint-disable no-underscore-dangle -- Splunk KV Store defines the _key protocol field. */
import { username, splunkdPath } from '@splunk/splunk-utils/config';
import { createRESTURL } from '@splunk/splunk-utils/url';
import { splunkRequest, SplunkRequestError as ReviewRequestError } from './rest';

import {
    HealthStatus,
    ReviewClient,
    ReviewInput,
    ReviewRecord,
    ReviewStage,
    UsageCoverage,
    ReviewHistoryPage,
} from '../types';
import { parseReviewBaseline } from './reviewEvidence';
import {
    canonicalReviewId, legacyRevisionId, prepareRevision, hydrateReview,
    RawReview, ReviewRevision, ReviewRevisionHeader, selectRevisionHeads, validateRevision,
    validateHeader,
} from './reviewLedger';

export { canonicalReviewId } from './reviewLedger';

const APP_ID = 'content_hygiene';
const COLLECTION = 'ch_reviews';
const REVISIONS = 'ch_review_revisions';
const PAGE_SIZE = 1000;

type JsonRecord = Record<string, unknown>;

interface KvReviewRecord extends JsonRecord {
    _key: string;
    object_id: string;
    object_name: string;
    canonical_name: string;
    object_type: string;
    app: string;
    owner: string | null;
    health_status_at_review: string;
    usage_coverage_at_review?: string | null;
    usage_last_observed_at_review?: string | null;
    usage_observation_count_at_review?: number | null;
    usage_run_id_at_review?: string | null;
    stage: string;
    note: string;
    assigned_to: string | null;
    scan_id: string;
    created_at: string;
    updated_at: string;
    updated_by: string;
}

export const reviewStageOptions: Array<{
    value: ReviewStage;
    label: string;
    description: string;
}> = [
    {
        value: 'triage',
        label: 'Triage',
        description: 'Saved for initial review and prioritization.',
    },
    {
        value: 'investigating',
        label: 'Investigating',
        description: 'Dependency, usage, and ownership evidence is under review.',
    },
    {
        value: 'awaiting_owner',
        label: 'Awaiting owner',
        description: 'An owner or subject-matter expert must confirm intent.',
    },
    {
        value: 'confirmed_eligible',
        label: 'Confirmed eligible',
        description: 'Review evidence supports eligibility for a future cleanup process.',
    },
    {
        value: 'retain',
        label: 'Retain',
        description: 'The object was reviewed and should remain in place.',
    },
    {
        value: 'blocked',
        label: 'Blocked',
        description: 'A dependency, policy, or missing evidence blocks a decision.',
    },
];

const reviewStages = new Set<ReviewStage>(reviewStageOptions.map(({ value }) => value));

const healthStatuses = new Set<HealthStatus>([
    'active',
    'dormant',
    'orphaned',
    'broken',
    'unowned',
    'protected',
    'unknown',
]);

function stringValue(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
    const parsed = Number(value);
    return value === null || value === undefined || value === '' || !Number.isFinite(parsed)
        ? null
        : parsed;
}

function usageCoverageValue(value: unknown): UsageCoverage | null {
    return value === 'complete' || value === 'partial' || value === 'unavailable' ? value : null;
}

function collectionUrl(suffix = '', collection = COLLECTION): string {
    return createRESTURL(`storage/collections/data/${collection}${suffix}`, {
        owner: 'nobody',
        app: APP_ID,
    });
}

function withQuery(url: string, query: Record<string, string | number>): string {
    const search = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => search.set(key, String(value)));
    return `${url}?${search.toString()}`;
}

const requestJson = splunkRequest;

function isReviewStage(value: string): value is ReviewStage {
    return reviewStages.has(value as ReviewStage);
}

function isHealthStatus(value: string): value is HealthStatus {
    return healthStatuses.has(value as HealthStatus);
}

export function reviewRecordFromKv(record: KvReviewRecord): ReviewRecord {
    const stage = stringValue(record.stage, 'triage');
    const healthStatus = stringValue(record.health_status_at_review, 'unknown');
    return {
        objectId: canonicalReviewId(stringValue(record.object_id)),
        objectName: stringValue(record.object_name),
        canonicalName: stringValue(record.canonical_name, stringValue(record.object_name)),
        objectType: stringValue(record.object_type, 'Unknown'),
        app: stringValue(record.app, 'unknown'),
        owner: stringValue(record.owner) || null,
        healthStatusAtReview: isHealthStatus(healthStatus) ? healthStatus : 'unknown',
        usageCoverageAtReview: usageCoverageValue(record.usage_coverage_at_review),
        usageLastObservedAtReview: stringValue(record.usage_last_observed_at_review) || null,
        usageObservationCountAtReview: nullableNumber(record.usage_observation_count_at_review),
        usageRunIdAtReview: stringValue(record.usage_run_id_at_review) || null,
        stage: isReviewStage(stage) ? stage : 'triage',
        note: stringValue(record.note),
        assignedTo: stringValue(record.assigned_to) || null,
        scanId: stringValue(record.scan_id),
        createdAt: stringValue(record.created_at),
        updatedAt: stringValue(record.updated_at),
        updatedBy: stringValue(record.updated_by, 'unknown'),
        evidenceBaseline: parseReviewBaseline(record.evidence_baseline),
        evidenceHistory: Array.isArray(record.evidence_history)
            ? record.evidence_history.map(parseReviewBaseline)
                .filter((item): item is NonNullable<typeof item> => item !== null) : [],
        ...(!isReviewStage(stage) ? { persistenceIssue: `Stored stage "${stage}" is unsupported. The original record is preserved; its decision must not be interpreted or overwritten.` } : {}),
    };
}

async function getReviewRecord(objectId: string): Promise<KvReviewRecord | null> {
    const canonical = canonicalReviewId(objectId);
    const identities = [
        ...new Set([
            canonical,
            canonical.replace(/^saved_search::/, 'report::'),
            canonical.replace(/^saved_search::/, 'alert::'),
        ]),
    ];
    const records = await requestJson<KvReviewRecord[]>(
        withQuery(collectionUrl(), {
            query: JSON.stringify({ object_id: { $in: identities } }),
            limit: 4,
        }),
    );
    if (records.length > 1) {
        throw new Error(
            'Multiple legacy reviews match this saved search. Resolve the duplicate app-local records before updating its decision.',
        );
    }
    return records[0] ?? null;
}

export class ReviewConflictError extends Error {
    constructor(message = 'Another session changed this review. Your draft is preserved. Reload the saved review and reconcile before saving again.') {
        super(message);
        this.name = 'ReviewConflictError';
    }
}

const HEADER_FIELDS = '_key,version,object_id,revision_number,parent_revision,origin_digest,operation,updated_at,updated_by';

async function queryAll<T>(collection: string, query: JsonRecord = {}, fields?: string): Promise<T[]> {
    const rows: T[] = [];
    let after = '';
    /* eslint-disable no-await-in-loop -- Keyset pages are stable when another reviewer appends a revision. */
    while (true) {
        const selection = after ? { $and: [query, { _key: { $gt: after } }] } : query;
        const page = await requestJson<Array<T & { _key: string }>>(withQuery(collectionUrl('', collection), {
            query: JSON.stringify(selection), sort: '_key:1', limit: PAGE_SIZE,
            ...(fields ? { fields } : {}),
        }));
        rows.push(...page);
        if (page.length < PAGE_SIZE) { break; }
        const next = page[page.length - 1]._key;
        if (!next || next <= after) { throw new Error('Review pagination did not advance safely.'); }
        after = next;
    }
    /* eslint-enable no-await-in-loop */
    return rows;
}

async function loadDocuments(keys: string[], cache = new Map<string, ReviewRevision>()): Promise<Map<string, ReviewRevision>> {
    const missing = [...new Set(keys)].filter((key) => !cache.has(key));
    // Bounded URLs and concurrency avoid one request per review or an oversized
    // GET query. Historical evidence is fetched once per shared revision.
    for (let start = 0; start < missing.length; start += 200) {
        const groups = Array.from({ length: Math.ceil(Math.min(200, missing.length - start) / 50) },
            (_, index) => missing.slice(start + index * 50, start + (index + 1) * 50));
        // eslint-disable-next-line no-await-in-loop
        const pages = await Promise.all(groups.map((group) => requestJson<ReviewRevision[]>(
            withQuery(collectionUrl('', REVISIONS), { query: JSON.stringify({ _key: { $in: group } }), limit: group.length }),
        )));
        pages.flat().forEach((row) => { validateRevision(row); cache.set(row._key, row); });
    }
    if (keys.some((key) => !cache.has(key))) { throw new Error('A saved review revision is unavailable. Restore review storage before changing decisions.'); }
    return cache;
}

interface ReviewState {
    review: ReviewRecord | null;
    raw: RawReview | null;
    legacy: KvReviewRecord | null;
    head: ReviewRevision | null;
    documents: Map<string, ReviewRevision>;
}

function projectedState(legacy: KvReviewRecord | null, head: ReviewRevision | null,
    documents: Map<string, ReviewRevision>): ReviewState {
    const raw = head ? hydrateReview(head, documents) : legacy;
    const review = raw ? reviewRecordFromKv(raw as KvReviewRecord) : null;
    if (review) {
        review.revisionId = head?._key ?? legacyRevisionId(legacy!);
        review.revisionNumber = head?.revision_number ?? 0;
        review.removed = head?.operation === 'remove';
        if (head && head.origin_digest !== (legacy ? legacyRevisionId(legacy) : null)) {
            review.persistenceIssue = 'The original legacy review was changed outside this revision history. Both versions are retained; an administrator must reconcile the app-local records before further edits.';
        }
    }
    return { review, raw, legacy, head, documents };
}

async function hydrateHeads(heads: Map<string, ReviewRevisionHeader>): Promise<Map<string, ReviewRevision>> {
    const documents = await loadDocuments([...heads.values()].map((row) => row._key));
    const refs = [...documents.values()].flatMap((row) => [row.baseline_ref, ...row.history_refs])
        .filter((ref): ref is NonNullable<typeof ref> => ref !== null).map((ref) => ref.revision);
    return loadDocuments(refs, documents);
}

async function loadState(objectId: string): Promise<ReviewState> {
    const id = canonicalReviewId(objectId);
    const [legacy, headers] = await Promise.all([
        getReviewRecord(id), queryAll<ReviewRevisionHeader>(REVISIONS, { object_id: id }, HEADER_FIELDS),
    ]);
    const heads = selectRevisionHeads(headers);
    const documents = await hydrateHeads(heads);
    const header = heads.get(id);
    return projectedState(legacy, header ? documents.get(header._key)! : null, documents);
}

async function listReviews(): Promise<ReviewRecord[]> {
    const [legacyRows, headers] = await Promise.all([
        queryAll<KvReviewRecord>(COLLECTION), queryAll<ReviewRevisionHeader>(REVISIONS, {}, HEADER_FIELDS),
    ]);
    const grouped = new Map<string, KvReviewRecord[]>();
    legacyRows.forEach((row) => {
        const id = canonicalReviewId(row.object_id);
        grouped.set(id, [...(grouped.get(id) ?? []), row]);
    });
    const heads = selectRevisionHeads(headers);
    const documents = await hydrateHeads(heads);
    const ids = [...new Set([...grouped.keys(), ...heads.keys()])];
    return ids.map((id) => {
        const originals = grouped.get(id) ?? [];
        const header = heads.get(id);
        const state = projectedState(originals[0] ?? null,
            header ? documents.get(header._key)! : null, documents);
        const review = state.review!;
        if (originals.length > 1) {
            review.persistenceIssue = 'Multiple legacy reviews match this identity. Original decisions are preserved; reconcile the app-local duplicates before editing.';
        }
        return review;
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function checkExpected(state: ReviewState, expected: string | null | undefined): void {
    if (expected === undefined) {
        throw new ReviewConflictError('This editor has no revision identity. Reload the upgraded app before changing a review.');
    }
    if (state.review?.persistenceIssue) { throw new ReviewConflictError(state.review.persistenceIssue); }
    if ((state.review?.revisionId ?? null) !== expected) { throw new ReviewConflictError(); }
}

async function insertRevision(revision: ReviewRevision): Promise<ReviewRevision> {
    validateRevision(revision);
    let writeError: unknown;
    try {
        // The standalone server coordinator serializes and rechecks the parent.
        // KV duplicate-key rejection alone is not an atomic concurrency guarantee.
        await requestJson<unknown>(createRESTURL('content_hygiene/review_revisions', {
            owner: 'nobody', app: APP_ID,
        }), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(revision),
        }, [200, 201]);
    } catch (error) { writeError = error; }
    let stored: ReviewRevision;
    try {
        stored = await requestJson<ReviewRevision>(collectionUrl(`/${encodeURIComponent(revision._key)}`, REVISIONS));
    } catch {
        if (writeError instanceof ReviewRequestError && writeError.status === 409) { throw new ReviewConflictError(); }
        if (writeError instanceof ReviewRequestError && [400, 401, 403, 404].includes(writeError.status)) {
            throw new Error(`Review revision was rejected (HTTP ${writeError.status}). Verify the hygiene role, installed review coordinator, revision collection and KV permissions. No decision was replaced.`);
        }
        throw new Error('The save could not be confirmed. Your draft is preserved. Reload the saved review before retrying; no write was automatically replayed.');
    }
    validateRevision(stored);
    if (stored.request_id !== revision.request_id) { throw new ReviewConflictError(); }
    return stored;
}

function requestIdentity(): string {
    return [...globalThis.crypto.getRandomValues(new Uint32Array(4))].map((part) => part.toString(16)).join('-');
}

async function upsertReview(input: ReviewInput): Promise<ReviewRecord> {
    const state = await loadState(input.object.objectId);
    checkExpected(state, input.expectedRevisionId);
    if (input.expectedUpdatedAt !== undefined && (state.review?.updatedAt ?? null) !== input.expectedUpdatedAt) {
        throw new ReviewConflictError();
    }
    if (input.captureEvidence && (!input.evidence || input.evidence.objectId !== canonicalReviewId(input.object.objectId) ||
        input.evidence.scanId !== input.scanId || !parseReviewBaseline({ capturedAt: new Date().toISOString(),
            capturedBy: username || 'unknown', evidence: input.evidence }))) {
        throw new Error('A current inventory fingerprint is required to capture review evidence. Run a complete scan first.');
    }
    if (input.captureEvidence && state.review && (input.stage !== state.review.stage ||
        input.note.trim() !== state.review.note.trim() || (input.assignedTo?.trim() || null) !== state.review.assignedTo)) {
        throw new Error('Save decision, note or assignee edits first. Explicit reaffirmation never changes those values at the same time.');
    }
    const now = new Date().toISOString();
    const existing = state.raw;
    const record: RawReview = {
        ...(existing ?? {}), object_id: canonicalReviewId(input.object.objectId),
        object_name: existing?.object_name ?? input.object.name,
        canonical_name: existing?.canonical_name ?? input.object.canonicalName,
        object_type: existing?.object_type ?? input.object.objectType,
        app: existing?.app ?? input.object.app,
        owner: existing ? existing.owner : input.object.owner,
        health_status_at_review: existing ? existing.health_status_at_review ?? 'unknown' : input.object.healthStatus,
        usage_coverage_at_review: existing ? existing.usage_coverage_at_review : input.object.usageEvidence?.coverage ?? null,
        usage_last_observed_at_review: existing ? existing.usage_last_observed_at_review : input.object.usageEvidence?.lastObserved ?? null,
        usage_observation_count_at_review: existing ? existing.usage_observation_count_at_review : input.object.usageEvidence?.observationCount ?? null,
        usage_run_id_at_review: existing ? existing.usage_run_id_at_review : input.object.usageEvidence?.usageRunId ?? null,
        stage: input.stage, note: input.note.trim().slice(0, 4000), assigned_to: input.assignedTo?.trim().slice(0, 256) || null,
        scan_id: existing ? existing.scan_id ?? '' : input.scanId, created_at: existing?.created_at ?? now,
        updated_at: now, updated_by: username || 'unknown',
    };
    const revision = prepareRevision({ objectId: input.object.objectId, previous: state.head,
        legacy: state.legacy, record, now, actor: username || 'unknown', requestId: requestIdentity(),
        ...(input.captureEvidence ? { capture: { capturedAt: now, capturedBy: username || 'unknown',
            evidence: input.evidence, usageAtCapture: input.object.usageEvidence } } : {}),
    });
    const stored = await insertRevision(revision);
    state.documents.set(stored._key, stored);
    return projectedState(state.legacy, stored, state.documents).review!;
}

async function deleteReview(objectId: string, expectedRevisionId?: string | null): Promise<void> {
    const state = await loadState(objectId);
    checkExpected(state, expectedRevisionId);
    if (!state.raw || state.review?.removed) { return; }
    await insertRevision(prepareRevision({ objectId, previous: state.head, legacy: state.legacy,
        record: state.raw, remove: true, now: new Date().toISOString(),
        actor: username || 'unknown', requestId: requestIdentity(),
    }));
}

async function listHistory(objectId: string, before?: number): Promise<ReviewHistoryPage> {
    const rows = await requestJson<Array<ReviewRevision & { _user?: string }>>(withQuery(collectionUrl('', REVISIONS), {
        query: JSON.stringify({ object_id: canonicalReviewId(objectId), ...(before ? { revision_number: { $lt: before } } : {}) }),
        sort: 'revision_number:-1', limit: 21, fields: `${HEADER_FIELDS},record,baseline_ref,_user`,
    }));
    rows.forEach(validateHeader);
    const page = rows.slice(0, 20);
    return { entries: page.map((row) => ({
        revisionId: row._key, revisionNumber: row.revision_number, operation: row.operation,
        stage: String(row.record.stage ?? ''), note: String(row.record.note ?? ''),
        assignedTo: typeof row.record.assigned_to === 'string' ? row.record.assigned_to : null,
        // _user is the KV namespace (nobody), not the authenticated reviewer.
        updatedAt: row.updated_at, updatedBy: row.updated_by,
        capturedEvidence: row.baseline_ref?.revision === row._key && row.baseline_ref.slot === 'capture',
    })), nextBefore: rows.length > 20 ? page[page.length - 1].revision_number : null };
}

export const splunkReviewClient: ReviewClient = {
    isAvailable: () => Boolean(splunkdPath), listReviews, upsertReview, deleteReview,
    getReview: async (id) => (await loadState(id)).review, listHistory,
};
