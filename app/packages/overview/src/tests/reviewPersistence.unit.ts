/* eslint-disable no-underscore-dangle -- Splunk KV Store defines the _key protocol field. */
import { splunkReviewClient, reviewRecordFromKv, ReviewConflictError } from '../services/reviews';
import { splunkRequest, SplunkRequestError } from '../services/rest';
import { attachReviewEvidence, configurationFingerprint } from '../services/reviewEvidence';
import { evidenceFromReference, legacyRevisionId, prepareRevision, revisionKey, selectRevisionHeads, validateRevision } from '../services/reviewLedger';
import { ContentObject, ReviewInput } from '../types';

jest.mock('../services/rest', () => ({
    splunkRequest: jest.fn(),
    SplunkRequestError: class extends Error {
        status: number;

        constructor(status: number, message: string) { super(message); this.status = status; }
    },
}));
jest.mock('@splunk/splunk-utils/config', () => ({ username: 'reviewer', splunkdPath: '/splunkd' }));
jest.mock('@splunk/splunk-utils/url', () => ({
    createRESTURL: (path: string) => `/servicesNS/nobody/content_hygiene/${path}`,
}));

const source: ContentObject = {
    objectId: 'macro::example::a', canonicalName: 'a', name: 'A', objectType: 'Macro', app: 'example',
    owner: 'owner-now', sharing: 'app', enabled: true, scheduled: false, updated: null,
    lastUsed: null, usageEvidence: null, healthStatus: 'unknown', abandonmentConfidence: null,
    removalImpact: null, inboundReferences: 0, outboundReferences: 0, protected: false,
    evidence: [], suggestedAction: 'Review',
    configurationFingerprint: configurationFingerprint({ definition: 'index=example' }, {}),
};
const original = {
    _key: 'original-review-key', object_id: source.objectId, object_name: source.name,
    canonical_name: source.canonicalName, object_type: source.objectType, app: source.app,
    owner: 'owner-at-review', health_status_at_review: 'dormant', stage: 'retain',
    note: 'Original rationale', assigned_to: 'team', usage_coverage_at_review: 'complete',
    usage_observation_count_at_review: 0, usage_last_observed_at_review: null,
    usage_run_id_at_review: 'original-usage', scan_id: 'original-scan',
    created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T01:00:00Z', updated_by: 'original-reviewer',
};
const input: ReviewInput = {
    object: source, stage: 'retain', note: original.note, assignedTo: original.assigned_to,
    scanId: 'current-scan', expectedRevisionId: legacyRevisionId(original),
    expectedUpdatedAt: original.updated_at,
};
const request = jest.mocked(splunkRequest);
type Row = Record<string, any>;
let legacy: Row[];
let revisions: Map<string, Row>;
let loseReply = false;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

function matches(row: Row, query: Row): boolean {
    return Object.entries(query).every(([key, value]) => {
        if (key === '$and') { return value.every((part: Row) => matches(row, part)); }
        if (value && typeof value === 'object') {
            return Object.entries(value).every(([op, expected]) => {
                if (op === '$in') { return (expected as unknown[]).includes(row[key]); }
                if (op === '$gt') { return row[key] > expected!; }
                if (op === '$lt') { return row[key] < expected!; }
                throw new Error(`Unexpected test operator ${op}`);
            });
        }
        return row[key] === value;
    });
}

beforeEach(() => {
    legacy = [clone(original)]; revisions = new Map(); loseReply = false; request.mockReset();
    request.mockImplementation(async (path, init) => {
        const url = new URL(String(path), 'https://splunk.invalid');
        const collection = url.pathname.includes('/ch_review_revisions') ? 'revisions' : 'legacy';
        if (init?.method === 'POST') {
            expect(url.pathname.endsWith('/content_hygiene/review_revisions')).toBe(true);
            const row = JSON.parse(String(init.body));
            if (revisions.has(row._key)) { throw new SplunkRequestError(409, 'Duplicate key'); }
            revisions.set(row._key, { ...clone(row), _user: 'nobody' });
            if (loseReply) { loseReply = false; throw new Error('Lost response after insert'); }
            return { _key: row._key };
        }
        expect(!init?.method || init.method === 'GET').toBe(true);
        const key = url.pathname.match(/\/ch_review_revisions\/([^/]+)$/)?.[1];
        if (key) {
            if (!revisions.has(decodeURIComponent(key))) { throw new SplunkRequestError(404, 'Not found'); }
            return clone(revisions.get(decodeURIComponent(key)));
        }
        const query = JSON.parse(url.searchParams.get('query') ?? '{}');
        let rows = (collection === 'legacy' ? legacy : [...revisions.values()]).filter((row) => matches(row, query));
        const sort = url.searchParams.get('sort');
        rows = rows.sort(sort === 'revision_number:-1'
            ? (a, b) => b.revision_number - a.revision_number
            : (a, b) => a._key.localeCompare(b._key));
        return clone(rows.slice(0, Number(url.searchParams.get('limit') ?? 1000)));
    });
});

test('a legacy note edit appends a revision and leaves the original decision byte-identical', async () => {
    const saved = await splunkReviewClient.upsertReview({ ...input, note: 'Extended rationale' });
    expect(legacy).toEqual([original]);
    expect(saved).toMatchObject({ stage: 'retain', note: 'Extended rationale', scanId: 'original-scan',
        healthStatusAtReview: 'dormant', usageRunIdAtReview: 'original-usage', revisionNumber: 1 });
    expect(saved.evidenceBaseline).toBeNull();
    expect(revisions.size).toBe(1);
    expect(revisions.get(saved.revisionId!)?.origin_record).toEqual(original);
});

test('simultaneous note edits admit one successor and reject the loser without overwrites', async () => {
    const outcomes = await Promise.allSettled([
        splunkReviewClient.upsertReview({ ...input, note: 'Reviewer A' }),
        splunkReviewClient.upsertReview({ ...input, note: 'Reviewer B' }),
    ]);
    expect(outcomes.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((row) => row.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ReviewConflictError);
    expect(revisions.size).toBe(1);
    expect(legacy).toEqual([original]);
    expect((await splunkReviewClient.listReviews())[0].note).toMatch(/^Reviewer [AB]$/);
});

test('simultaneous initial creates also admit one decision', async () => {
    legacy = [];
    const create = { ...input, expectedRevisionId: null, expectedUpdatedAt: null };
    const outcomes = await Promise.allSettled([
        splunkReviewClient.upsertReview({ ...create, note: 'A' }),
        splunkReviewClient.upsertReview({ ...create, note: 'B' }),
    ]);
    expect(outcomes.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(revisions.size).toBe(1);
});

test('a lost insert response is verified by request identity, never replayed', async () => {
    loseReply = true;
    const saved = await splunkReviewClient.upsertReview(input);
    expect(saved.revisionNumber).toBe(1);
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

test('save versus remove races cannot silently remove a newer saved decision', async () => {
    const outcomes = await Promise.allSettled([
        splunkReviewClient.upsertReview({ ...input, note: 'New review evidence' }),
        splunkReviewClient.deleteReview(source.objectId, input.expectedRevisionId),
    ]);
    expect(outcomes.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(revisions.size).toBe(1);
    expect(legacy).toEqual([original]);
});

test('removal is a revision tombstone, restoration preserves original facts and both history entries', async () => {
    await splunkReviewClient.deleteReview(source.objectId, input.expectedRevisionId);
    const archived = (await splunkReviewClient.listReviews())[0];
    expect(archived.removed).toBe(true);
    expect(archived.note).toBe(original.note);
    const restored = await splunkReviewClient.upsertReview({ ...input,
        expectedRevisionId: archived.revisionId, expectedUpdatedAt: archived.updatedAt,
    });
    expect(restored.removed).toBe(false);
    expect(restored.createdAt).toBe(original.created_at);
    expect(restored.stage).toBe('retain');
    const history = await splunkReviewClient.listHistory!(source.objectId);
    expect(history.entries.map((row) => row.operation)).toEqual(['save', 'remove']);
    expect(history.entries[0].updatedBy).toBe('reviewer');
    expect(restored.updatedBy).toBe('reviewer');
    expect(legacy).toEqual([original]);
});

test('reaffirmation references one immutable capture; ordinary notes do not duplicate or reset it', async () => {
    const [current] = await attachReviewEvidence([source], [], {
        scanId: 'current-scan', observedAt: '2026-07-28T11:00:00Z', principal: 'operator', roles: [],
        mode: 'full', collectionComplete: true, analysisComplete: true, collectors: {},
    });
    const first = await splunkReviewClient.upsertReview({ ...input, captureEvidence: true, evidence: current.reviewEvidence });
    const second = await splunkReviewClient.upsertReview({ ...input, note: 'More details',
        expectedRevisionId: first.revisionId, expectedUpdatedAt: first.updatedAt });
    expect(second.evidenceBaseline).toEqual(first.evidenceBaseline);
    expect(revisions.get(second.revisionId!)?.capture).toBeUndefined();
    expect(revisions.get(second.revisionId!)?.baseline_ref.revision).toBe(first.revisionId);
    const third = await splunkReviewClient.upsertReview({ ...input, captureEvidence: true, evidence: current.reviewEvidence,
        note: second.note, expectedRevisionId: second.revisionId, expectedUpdatedAt: second.updatedAt });
    expect(third.evidenceHistory).toEqual([first.evidenceBaseline]);
    expect(third.scanId).toBe(original.scan_id);
    expect(legacy).toEqual([original]);
});

test('unsupported original evidence is retained, not silently replaced on a note save', async () => {
    const future = { capturedAt: '2026-07-01', capturedBy: 'reviewer', evidence: { version: 99 } };
    legacy[0].evidence_baseline = future;
    const saved = await splunkReviewClient.upsertReview({ ...input, expectedRevisionId: legacyRevisionId(legacy[0]) });
    expect(saved.evidenceBaseline).toBeNull();
    expect(revisions.get(saved.revisionId!)?.origin_record.evidence_baseline).toEqual(future);
    expect(legacy[0].evidence_baseline).toEqual(future);
    expect(reviewRecordFromKv(legacy[0] as any).evidenceBaseline).toBeNull();
});

test('reaffirmation cannot simultaneously change the decision or note', async () => {
    const [current] = await attachReviewEvidence([source], [], {
        scanId: 'current-scan', observedAt: '2026-07-28T11:00:00Z', principal: 'operator', roles: [],
        mode: 'full', collectionComplete: true, analysisComplete: true, collectors: {},
    });
    await expect(splunkReviewClient.upsertReview({ ...input, captureEvidence: true,
        evidence: current.reviewEvidence, note: 'Changed during reaffirmation' })).rejects.toThrow('Save decision');
    expect(revisions.size).toBe(0);
});

test('a missing capture is a broken journal, not a silently empty baseline', () => {
    const revision = prepareRevision({ objectId: source.objectId, previous: null, legacy: null,
        record: original, now: '2026-10-23', actor: 'A', requestId: 'A' });
    expect(() => evidenceFromReference({ revision: revision._key, number: 1, slot: 'capture' },
        new Map([[revision._key, revision]]))).toThrow(/capture is missing/);
});

test('stale editors, missing identities and mismatched captures make no writes', async () => {
    await expect(splunkReviewClient.upsertReview({ ...input, expectedRevisionId: 'outdated' })).rejects.toBeInstanceOf(ReviewConflictError);
    await expect(splunkReviewClient.upsertReview({ ...input, expectedRevisionId: undefined })).rejects.toBeInstanceOf(ReviewConflictError);
    await expect(splunkReviewClient.deleteReview(source.objectId, null)).rejects.toBeInstanceOf(ReviewConflictError);
    await expect(splunkReviewClient.upsertReview({ ...input, captureEvidence: true })).rejects.toThrow('current inventory fingerprint');
    expect(revisions.size).toBe(0);
});

test('an old client changing the frozen legacy source blocks edits without losing either version', async () => {
    const saved = await splunkReviewClient.upsertReview(input);
    legacy[0].note = 'A later old-client decision';
    const latest = (await splunkReviewClient.listReviews())[0];
    expect(latest.note).toBe(original.note);
    expect(latest.persistenceIssue).toMatch(/outside/);
    await expect(splunkReviewClient.upsertReview({ ...input, expectedRevisionId: saved.revisionId,
        expectedUpdatedAt: saved.updatedAt })).rejects.toBeInstanceOf(ReviewConflictError);
    expect(revisions.size).toBe(1);
});

test('a missing revision or cross-object evidence reference fails closed', async () => {
    const first = await splunkReviewClient.upsertReview(input);
    const second = await splunkReviewClient.upsertReview({ ...input, expectedRevisionId: first.revisionId,
        expectedUpdatedAt: first.updatedAt });
    const head = revisions.get(second.revisionId!)!;
    expect(() => selectRevisionHeads([head])).toThrow(/missing/);
    expect(() => validateRevision({ ...head,
        baseline_ref: { revision: revisionKey('another', 1), number: 1, slot: 'capture' } })).toThrow(/lineage/);
});

test('revision identity and ordering are independent of client clock skew', () => {
    const first = prepareRevision({ objectId: source.objectId, previous: null, legacy: original,
        record: original, now: '2030-01-01', actor: 'A', requestId: 'A' });
    const second = prepareRevision({ objectId: source.objectId, previous: first, legacy: original,
        record: original, now: '2020-01-01', actor: 'B', requestId: 'B' });
    expect(selectRevisionHeads([second, first]).get(source.objectId)?._key).toBe(second._key);
});
