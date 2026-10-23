import { splunkReviewClient, reviewRecordFromKv } from '../services/reviews';
import { splunkRequest } from '../services/rest';
import { attachReviewEvidence, configurationFingerprint } from '../services/reviewEvidence';
import { ContentObject, ReviewInput } from '../types';

jest.mock('../services/rest', () => ({ splunkRequest: jest.fn() }));
jest.mock('@splunk/splunk-utils/config', () => ({ username: 'reviewer', splunkdPath: '/splunkd' }));
jest.mock('@splunk/splunk-utils/url', () => ({
    createRESTURL: (path: string) => `/servicesNS/nobody/content_hygiene/${path}`,
}));

const source: ContentObject = {
    objectId: 'macro::example::a',
    canonicalName: 'a',
    name: 'A',
    objectType: 'Macro',
    app: 'example',
    owner: 'owner-now',
    sharing: 'app',
    enabled: true,
    scheduled: false,
    updated: null,
    lastUsed: null,
    usageEvidence: null,
    healthStatus: 'unknown',
    abandonmentConfidence: null,
    removalImpact: null,
    inboundReferences: 0,
    outboundReferences: 0,
    protected: false,
    evidence: [],
    suggestedAction: 'Review',
    configurationFingerprint: configurationFingerprint({ definition: 'index=example' }, {}),
};
const original = {
    _key: 'original-review-key',
    object_id: source.objectId,
    object_name: source.name,
    canonical_name: source.canonicalName,
    object_type: source.objectType,
    app: source.app,
    owner: 'owner-at-review',
    health_status_at_review: 'dormant',
    stage: 'retain',
    note: 'Original rationale',
    assigned_to: 'team',
    usage_coverage_at_review: 'complete',
    usage_observation_count_at_review: 0,
    usage_last_observed_at_review: null,
    usage_run_id_at_review: 'original-usage',
    scan_id: 'original-scan',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T01:00:00Z',
    updated_by: 'original-reviewer',
};
const input: ReviewInput = {
    object: source,
    stage: 'retain',
    note: original.note,
    assignedTo: original.assigned_to,
    scanId: 'current-scan',
    expectedUpdatedAt: original.updated_at,
};
const request = jest.mocked(splunkRequest);
let write: Record<string, any>;
beforeEach(() => {
    write = {};
    request.mockReset();
    request.mockImplementation(async (_path, init) => {
        if (init?.method === 'POST') {
            write = JSON.parse(String(init.body));
            return {};
        }
        return [original];
    });
});

test('legacy note edits preserve the original at-review facts and never silently capture evidence', async () => {
    const saved = await splunkReviewClient.upsertReview({ ...input, note: 'Extended rationale' });
    expect(saved.stage).toBe('retain');
    expect(saved.note).toBe('Extended rationale');
    expect(saved.scanId).toBe('original-scan');
    expect(saved.healthStatusAtReview).toBe('dormant');
    expect(saved.usageRunIdAtReview).toBe('original-usage');
    expect(saved.evidenceBaseline).toBeNull();
    expect(write).not.toHaveProperty('_key');
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(
        request.mock.calls.every(([path]) =>
            String(path).includes('/content_hygiene/storage/collections/data/ch_reviews'),
        ),
    ).toBe(true);
});

test('explicit reaffirmation preserves a prior baseline in durable history and does not change a decision', async () => {
    const [current] = await attachReviewEvidence([source], [], {
        scanId: 'current-scan',
        observedAt: '2026-07-28T11:00:00Z',
        principal: 'operator',
        roles: [],
        mode: 'full',
        collectionComplete: true,
        analysisComplete: true,
        collectors: {},
    });
    const baseline = {
        capturedAt: '2026-07-01T00:00:00Z',
        capturedBy: 'original-reviewer',
        evidence: current.reviewEvidence!,
    };
    request.mockImplementation(async (_path, init) => {
        if (init?.method === 'POST') {
            write = JSON.parse(String(init.body));
            return {};
        }
        return [{ ...original, evidence_baseline: baseline }];
    });
    const saved = await splunkReviewClient.upsertReview({
        ...input,
        captureEvidence: true,
        evidence: current.reviewEvidence,
    });
    expect(saved.stage).toBe(original.stage);
    expect(saved.note).toBe(original.note);
    expect(saved.scanId).toBe(original.scan_id);
    expect(saved.createdAt).toBe(original.created_at);
    expect(saved.evidenceBaseline?.capturedBy).toBe('reviewer');
    expect(saved.evidenceHistory).toEqual([baseline]);
});

test('note-only saves retain even an unsupported evidence baseline without overwriting it', async () => {
    const future = { capturedAt: '2026-07-01', capturedBy: 'reviewer', evidence: { version: 99 } };
    request.mockImplementation(async (_path, init) => {
        if (init?.method === 'POST') {
            write = JSON.parse(String(init.body));
            return {};
        }
        return [{ ...original, evidence_baseline: future, evidence_history: [future] }];
    });
    await splunkReviewClient.upsertReview(input);
    expect(write.evidence_baseline).toEqual(future);
    expect(write.evidence_history).toEqual([future]);
    expect(
        reviewRecordFromKv({ ...original, evidence_baseline: future }).evidenceBaseline,
    ).toBeNull();
});

test('rejects stale edits, stale new-record forms, and mismatched evidence without writes', async () => {
    await expect(
        splunkReviewClient.upsertReview({ ...input, expectedUpdatedAt: 'outdated' }),
    ).rejects.toThrow('another session');
    await expect(
        splunkReviewClient.upsertReview({ ...input, expectedUpdatedAt: null }),
    ).rejects.toThrow('another session');
    await expect(
        splunkReviewClient.upsertReview({ ...input, captureEvidence: true }),
    ).rejects.toThrow('current inventory fingerprint');
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
