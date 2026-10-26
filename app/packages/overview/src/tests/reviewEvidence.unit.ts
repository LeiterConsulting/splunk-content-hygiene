import {
    attachReviewEvidence as attachEvidence,
    compareReviewEvidence,
    configurationFingerprint,
    evidenceDigest,
    parseReviewBaseline,
    REVIEW_RELATIONSHIP_LIMIT,
    ReviewEvidenceScope,
} from '../services/reviewEvidence';
import { analyzeRemovalImpact } from '../services/removalImpact';
import { ContentObject, DependencyEdge, ReviewRecord, ScanSummary } from '../types';

const scope: ReviewEvidenceScope = {
    scanId: 'scan-a',
    observedAt: '2026-07-28T11:00:00Z',
    principal: 'operator',
    roles: ['hygiene_operator', 'user'],
    mode: 'full',
    collectionComplete: true,
    analysisComplete: true,
    collectors: { macros: true, dashboards: true },
};
const scan: ScanSummary = {
    scanId: scope.scanId,
    scanType: 'full',
    status: 'succeeded',
    startedAt: scope.observedAt,
    completedAt: scope.observedAt,
    objectCount: 2,
    edgeCount: 1,
    findingCount: 0,
    candidateCount: 0,
    warningCount: 0,
    warnings: [],
    errors: [],
    collectorCounts: {},
    collectorTotals: {},
    analysisStatus: 'complete',
    dataSource: 'live',
};

test('fingerprints do not depend on host locale collation', () => {
    const expected = evidenceDigest({ z: { Z: 1, a: 2 }, A: 3 });
    const spy = jest.spyOn(String.prototype, 'localeCompare').mockImplementation(() => {
        throw new Error('Locale collation must not decide fingerprint order');
    });
    try { expect(evidenceDigest({ A: 3, z: { a: 2, Z: 1 } })).toBe(expected); }
    finally { spy.mockRestore(); }
});

test('scan errors cannot establish a Current review', async () => {
    const [current] = await attachReviewEvidence([object()], [], scope);
    const result = compareReviewEvidence(review(current), current, { ...scan, errors: ['Collector failed'] }, Date.parse(scope.observedAt));
    expect(result.status).not.toBe('current');
    expect(result.limitations.join(' ')).toMatch(/reported errors/);
});

test('a normalization policy upgrade is not labeled as a definite configuration edit', async () => {
    const [current] = await attachReviewEvidence([object()], [], scope);
    const saved = review(current);
    saved.evidenceBaseline!.evidence = { ...saved.evidenceBaseline!.evidence,
        configuration: { ...saved.evidenceBaseline!.evidence.configuration, version: 1, digest: '0'.repeat(64) } };
    const result = compareReviewEvidence(saved, current, scan, Date.parse(scope.observedAt));
    expect(result.status).not.toBe('current');
    expect(result.reasons.join(' ')).not.toMatch(/Configuration changed/);
    expect(result.limitations.join(' ')).toMatch(/normalization changed/);
});
// This fixture declares a complete catalog and includes the actual parent app;
// tests of missing/partial catalogs below explicitly remove that guarantee.
async function attachReviewEvidence(objects: ContentObject[], edges: DependencyEdge[], input: ReviewEvidenceScope): Promise<ContentObject[]> {
    const parent = { ...object('app::search'), objectType: 'App', canonicalName: 'search' };
    const collectors = Object.fromEntries(['apps', 'macros', 'dashboards', 'lookup_definitions', 'lookup_files',
        'saved_searches', 'data_models', 'indexes', 'sourcetypes', 'event_types', 'tag_bindings'].map((name) => [name, input.collectionComplete]));
    const result = await attachEvidence([...objects, parent], edges, { ...input, coverageContext: {
        collectors, privateObjects: [], identityKnown: true,
        gaps: input.analysisComplete ? [] : [{ sourceId: objects[0].objectId, app: 'search',
            targets: 'all', message: 'Declared parser fixture gap', sourceLocation: 'search' }],
    } });
    return result.slice(0, objects.length);
}
function object(id = 'macro::search::a', definition = 'index=example'): ContentObject {
    return {
        objectId: id,
        canonicalName: id,
        name: id,
        objectType: 'Macro',
        app: 'search',
        owner: 'analyst',
        sharing: 'app',
        enabled: true,
        scheduled: false,
        updated: null,
        lastUsed: null,
        usageEvidence: null,
        healthStatus: 'unknown',
        abandonmentConfidence: null,
        removalImpact: 0,
        inboundReferences: 0,
        outboundReferences: 0,
        protected: false,
        evidence: [],
        suggestedAction: 'Review',
        configurationFingerprint: configurationFingerprint(
            { definition },
            {
                app: 'search',
                owner: 'analyst',
                sharing: 'app',
                perms: { read: ['user'], write: ['admin'] },
            },
        ),
    };
}
function edge(sourceId: string, targetId: string): DependencyEdge {
    return {
        edgeId: `${sourceId}->${targetId}`,
        sourceId,
        targetId,
        relation: 'uses_macro',
        confidence: 'high',
        evidence: 'Literal macro reference',
        sourceLocation: 'definition',
        resolved: true,
    };
}
function review(current: ContentObject): ReviewRecord {
    return {
        objectId: current.objectId,
        objectName: current.name,
        canonicalName: current.canonicalName,
        objectType: current.objectType,
        app: current.app,
        owner: current.owner,
        healthStatusAtReview: current.healthStatus,
        usageCoverageAtReview: null,
        usageLastObservedAtReview: null,
        usageObservationCountAtReview: null,
        usageRunIdAtReview: null,
        stage: 'confirmed_eligible',
        note: 'Owner confirmed; keep this decision.',
        assignedTo: 'team',
        scanId: scope.scanId,
        createdAt: scope.observedAt,
        updatedAt: scope.observedAt,
        updatedBy: 'reviewer',
        evidenceBaseline: {
            capturedAt: scope.observedAt,
            capturedBy: 'reviewer',
            evidence: current.reviewEvidence!,
        },
    };
}

test('uses standard SHA-256 and normalizes JSON property and ACL role ordering', () => {
    // JSON string "abc", independently checked against Node crypto in the known-vector test below.
    expect(evidenceDigest({ a: 1, b: 2 })).toBe(evidenceDigest({ b: 2, a: 1 }));
    const left = configurationFingerprint(
        { 'eai:data': '{"a":1,"b":2}', search: 'index=test', next_scheduled_time: 'today' },
        { owner: 'a', perms: { read: ['user', 'admin'] } },
    );
    const right = configurationFingerprint(
        { search: 'index=test', 'eai:data': '{ "b":2, "a":1 }', next_scheduled_time: 'tomorrow' },
        { perms: { read: ['admin', 'user'] }, owner: 'a' },
    );
    expect(left).toEqual(right);
    expect(JSON.stringify(left)).not.toContain('index=test');
    const { createHash } = jest.requireActual<typeof import('crypto')>('crypto');
    expect(evidenceDigest('abc')).toBe(
        createHash('sha256').update(JSON.stringify('abc')).digest('hex'),
    );
});

test('stores dotted and dollar configuration names as values, never invalid KV document keys', () => {
    const fingerprint = configurationFingerprint({ 'dispatch.earliest_time': '-24h', '$name': 'value' }, {});
    const check = (value: unknown): void => {
        if (Array.isArray(value)) { value.forEach(check); }
        else if (value && typeof value === 'object') {
            Object.entries(value).forEach(([key, item]) => {
                expect(key).not.toMatch(/\.|^\$/); check(item);
            });
        }
    };
    check(fingerprint);
    expect(fingerprint.fields.map((field) => field.name)).toContain('dispatch.earliest_time');
});

test('normalizes macro boolean representation across the legacy and supported config handlers', () => {
    expect(configurationFingerprint({ definition: 'index=test', iseval: false }, {}))
        .toEqual(configurationFingerprint({ definition: 'index=test', iseval: '0' }, {}));
    expect(configurationFingerprint({ definition: 'index=test', iseval: true }, {}))
        .toEqual(configurationFingerprint({ definition: 'index=test', iseval: 1 }, {}));
});

test('ignores only data-model editor calculation IDs while preserving functional changes and other object IDs', () => {
    const model = (id: string, expression = 'field+1') => ({ description: JSON.stringify({
        objects: [{ objectName: 'Events', calculations: [{ calculationID: id, calculationType: 'Eval', expression,
            outputFields: [{ fieldName: 'calculated' }] }] }],
    }) });
    const first = configurationFingerprint(model('generated-a'), {}, 'data_models');
    expect(configurationFingerprint(model('generated-b'), {}, 'data_models')).toEqual(first);
    expect(configurationFingerprint(model('generated-b', 'field+2'), {}, 'data_models').digest).not.toBe(first.digest);
    expect(configurationFingerprint(model('generated-a'), {}, 'dashboards').digest)
        .not.toBe(configurationFingerprint(model('generated-b'), {}, 'dashboards').digest);
});

test('a new scan ID, timestamps, object order and edge order do not invalidate a review', async () => {
    const a = object();
    const b = object('macro::search::b');
    const c = object('macro::search::c');
    const edges = [edge(a.objectId, b.objectId), edge(c.objectId, a.objectId)];
    const first = await attachReviewEvidence([a, b, c], edges, scope);
    const saved = review(first[0]);
    const original = JSON.stringify(saved);
    const second = await attachReviewEvidence([c, b, a], [...edges].reverse(), {
        ...scope,
        scanId: 'scan-b',
        observedAt: '2026-07-28T11:30:00Z',
        roles: [...scope.roles].reverse(),
    });
    const comparison = compareReviewEvidence(saved, second[2], { ...scan, scanId: 'scan-b' });
    expect(comparison.status).toBe('current');
    expect(comparison.relationships).toEqual([]);
    expect(JSON.stringify(saved)).toBe(original);
});

test('identifies configuration fields, permission changes and new/lost consumers without changing decisions', async () => {
    const a = object();
    const b = object('macro::search::b');
    const c = object('macro::search::c');
    const initial = await attachReviewEvidence([a, b, c], [edge(b.objectId, a.objectId)], scope);
    const saved = review(initial[0]);
    const changed = {
        ...object(a.objectId, 'index=changed'),
        owner: 'new-owner',
        sharing: 'global',
    };
    const current = await attachReviewEvidence(
        [changed, b, c],
        [edge(c.objectId, a.objectId)],
        scope,
    );
    const comparison = compareReviewEvidence(saved, current[0], scan);
    expect(comparison.status).toBe('needs_review');
    expect(comparison.reasons.join(' ')).toContain('definition');
    expect(comparison.reasons.join(' ')).toContain('Owner, sharing');
    expect(comparison.relationships.map((item) => item.kind).sort()).toEqual([
        'new',
        'no_longer_observed',
    ]);
    expect(saved.stage).toBe('confirmed_eligible');
    expect(saved.note).toBe('Owner confirmed; keep this decision.');
});

test('detects adjacent-object definition changes even if the relationship is unchanged', async () => {
    const a = object();
    const b = object('macro::search::b');
    const edges = [edge(b.objectId, a.objectId)];
    const before = await attachReviewEvidence([a, b], edges, scope);
    const after = await attachReviewEvidence(
        [a, object(b.objectId, 'index=another')],
        edges,
        scope,
    );
    const result = compareReviewEvidence(review(before[0]), after[0], scan);
    expect(result.status).toBe('needs_review');
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0].kind).toBe('changed');
});

test('detects confidence and source evidence changes', async () => {
    const a = object();
    const b = object('macro::search::b');
    const originalEdge = edge(b.objectId, a.objectId);
    const before = await attachReviewEvidence([a, b], [originalEdge], scope);
    const after = await attachReviewEvidence(
        [a, b],
        [{ ...originalEdge, confidence: 'low', evidence: 'New evidence' }],
        scope,
    );
    const result = compareReviewEvidence(review(before[0]), after[0], scan);
    expect(result.relationships[0]).toMatchObject({
        kind: 'changed',
        before: { confidence: 'high' },
        after: { confidence: 'low' },
    });
});

test('legacy, malformed, mismatched and unsupported baselines cannot be verified', async () => {
    const [a] = await attachReviewEvidence([object()], [], scope);
    const saved = review(a);
    expect(compareReviewEvidence({ ...saved, evidenceBaseline: null }, a, scan).status).toBe(
        'cannot_verify',
    );
    expect(compareReviewEvidence(saved, { ...a, reviewEvidence: undefined }, scan).status).toBe(
        'cannot_verify',
    );
    expect(compareReviewEvidence(saved, a, { ...scan, scanId: 'different' }).status).toBe(
        'cannot_verify',
    );
    expect(parseReviewBaseline({ ...saved.evidenceBaseline, evidence: { version: 2 } })).toBeNull();
    expect(
        parseReviewBaseline({
            ...saved.evidenceBaseline,
            evidence: { ...a.reviewEvidence, relationships: [null] },
        }),
    ).toBeNull();
    expect(compareReviewEvidence(null, a, scan).status).toBe('unreviewed');
});

test('no longer observed is not interpreted as deleted or confirmed eligible', async () => {
    const [a] = await attachReviewEvidence([object()], [], scope);
    const result = compareReviewEvidence(review(a), undefined, scan);
    expect(result.status).toBe('cannot_verify');
    expect(result.reasons.join(' ')).toContain('removal is not proven');
});

test('unavailable inventory is never treated as evidence that an object disappeared', async () => {
    const [a] = await attachReviewEvidence([object()], [], scope);
    const result = compareReviewEvidence(review(a), undefined, null);
    expect(result.status).toBe('cannot_verify');
    expect(result.reasons.join(' ')).toContain('absence cannot be determined');
    expect(result.reasons.join(' ')).not.toContain('no longer observed');
});

test('partial coverage, old evidence and retained baselines cannot establish Current', async () => {
    const [a] = await attachReviewEvidence([object()], [], { ...scope, analysisComplete: false });
    expect(
        compareReviewEvidence(review(a), a, {
            ...scan,
            status: 'partial',
            analysisStatus: 'partial',
        }).status,
    ).toBe('cannot_verify');
    const [full] = await attachReviewEvidence([object()], [], scope);
    expect(
        compareReviewEvidence(review(full), full, { ...scan, retainedBaseline: true }).status,
    ).toBe('cannot_verify');
    expect(
        compareReviewEvidence(review(full), full, { ...scan, completedAt: '2026-07-01T00:00:00Z' })
            .status,
    ).toBe('cannot_verify');
});

test('coverage and identity changes are explainable even when known relationships are stable', async () => {
    const [before] = await attachReviewEvidence([object()], [], scope);
    const [after] = await attachReviewEvidence([object()], [], {
        ...scope,
        principal: 'another-operator',
        collectionComplete: false,
    });
    const result = compareReviewEvidence(review(before), after, { ...scan, status: 'partial' });
    expect(result.status).toBe('needs_review');
    expect(result.reasons.join(' ')).toContain('scanning identity/roles');
    expect(result.limitations.length).toBeGreaterThan(0);
});

test('large neighborhoods keep a full digest, bounded manifests, and never invent exact additions/losses from truncated lists', async () => {
    const a = object();
    const neighbors = Array.from({ length: REVIEW_RELATIONSHIP_LIMIT + 5 }, (_, i) =>
        object(`macro::search::neighbor-${i}`),
    );
    const edges = neighbors.map((item) => edge(item.objectId, a.objectId));
    const before = await attachReviewEvidence([a, ...neighbors], edges, scope);
    const after = await attachReviewEvidence([a, ...neighbors], edges.slice(1), scope);
    expect(before[0].reviewEvidence?.relationships).toHaveLength(REVIEW_RELATIONSHIP_LIMIT);
    expect(before[0].reviewEvidence?.relationshipCount).toBe(REVIEW_RELATIONSHIP_LIMIT + 5);
    const result = compareReviewEvidence(review(before[0]), after[0], scan);
    expect(result.status).toBe('needs_review');
    expect(result.diffTruncated).toBe(true);
    expect(result.relationships.every((row) => row.kind === 'changed')).toBe(true);
});

test('stale confirmations cannot satisfy removal planning even with zero dependents', async () => {
    const [a] = await attachReviewEvidence([object()], [], scope);
    const saved = review(a);
    const ready = analyzeRemovalImpact(a, [a], [], [saved], scan);
    expect(ready.readiness).toBe('eligible_for_change_planning');
    const [changed] = await attachReviewEvidence(
        [object(a.objectId, 'changed definition')],
        [],
        scope,
    );
    expect(analyzeRemovalImpact(changed, [changed], [], [saved], scan).readiness).toBe(
        'confirmation_required',
    );
    expect(
        analyzeRemovalImpact(a, [a], [], [{ ...saved, evidenceBaseline: null }], scan).readiness,
    ).toBe('confirmation_required');
});

test('new attributable usage reopens evidence review and historical usage cannot establish Current', async () => {
    const [a] = await attachReviewEvidence([
        { ...object('saved_search::search::a'), objectType: 'Saved Search', inventoryScanId: scope.scanId },
    ], [], scope);
    const usage = {
        usageRunId: 'usage-a', inventoryScanId: scope.scanId, sourceId: 'search_audit',
        sourceLabel: 'Search audit', activityKind: 'saved_search_execution' as const,
        windowDays: 90 as const, windowStart: '2026-04-29T11:00:00Z', windowEnd: scope.observedAt,
        coverage: 'complete' as const, coverageStart: '2026-04-29T11:00:00Z', coverageEnd: scope.observedAt,
        sourceEventCount: 100, observationCount: 0, successfulCount: 0, failedCount: 0, skippedCount: 0,
        lastObserved: null, evidence: [],
    };
    const saved = review(a);
    saved.evidenceBaseline!.usageAtCapture = usage;
    const observed = { ...a, usageEvidence: { ...usage, observationCount: 1, lastObserved: '2026-07-28T11:30:00Z', windowEnd: '2026-07-28T12:00:00Z' } };
    expect(compareReviewEvidence(saved, observed, scan).reasons.join(' ')).toContain('Attributable usage');
    expect(compareReviewEvidence(saved, observed, scan).status).toBe('needs_review');
    const historical = { ...a, usageEvidence: { ...usage, inventoryScanId: 'older-scan' } };
    expect(compareReviewEvidence(saved, historical, scan).status).toBe('cannot_verify');
});
