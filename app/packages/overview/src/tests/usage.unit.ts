import {
    CollectedUsageSource,
    applyUsageEvidence,
    buildUsageEvidence,
    sourceCoverageForWindow,
} from '../services/usage';
import {
    ContentFinding,
    ContentObject,
    UsageEvidence,
    UsageSourceSummary,
} from '../types';

const inventoryScanId = 'scan-inventory-current';
const usageRunId = 'scan-usage-current';
const windowStart = '2026-04-29T12:00:00.000Z';
const windowEnd = '2026-07-28T12:00:00.000Z';

function contentObject(
    objectId: string,
    canonicalName: string,
    objectType: string,
    overrides: Partial<ContentObject> = {}
): ContentObject {
    return {
        objectId,
        canonicalName,
        name: canonicalName,
        objectType,
        app: 'search',
        owner: 'analyst',
        sharing: 'app',
        enabled: true,
        scheduled: false,
        updated: '2026-04-01T12:00:00.000Z',
        lastUsed: null,
        healthStatus: 'unknown',
        abandonmentConfidence: 30,
        removalImpact: 10,
        inboundReferences: 0,
        outboundReferences: 0,
        protected: false,
        evidence: ['Inventory evidence'],
        suggestedAction: 'Collect usage evidence',
        ...overrides,
        usageEvidence: overrides.usageEvidence ?? null,
    };
}

function sourceSummary(
    overrides: Partial<UsageSourceSummary> = {}
): UsageSourceSummary {
    return {
        sourceId: 'search_audit',
        label: 'Splunk search audit',
        activityKind: 'saved_search_execution',
        coverage: 'complete',
        coverageStart: windowStart,
        coverageEnd: windowEnd,
        sourceEventCount: 1200,
        activityRecordCount: 1,
        matchedObjectCount: 0,
        truncated: false,
        warning: null,
        ...overrides,
    };
}

function evidence(
    overrides: Partial<UsageEvidence> = {}
): UsageEvidence {
    return {
        usageRunId,
        inventoryScanId,
        sourceId: 'search_audit',
        sourceLabel: 'Splunk search audit',
        activityKind: 'saved_search_execution',
        windowDays: 90,
        windowStart,
        windowEnd,
        coverage: 'complete',
        coverageStart: windowStart,
        coverageEnd: windowEnd,
        sourceEventCount: 1200,
        observationCount: 0,
        successfulCount: 0,
        failedCount: 0,
        skippedCount: 0,
        lastObserved: null,
        evidence: ['Measured from Splunk telemetry'],
        ...overrides,
    };
}

test('requires source records to span both ends of the requested window', () => {
    expect(
        sourceCoverageForWindow(
            100,
            '2026-04-29T13:00:00.000Z',
            '2026-07-28T11:30:00.000Z',
            windowStart,
            windowEnd
        )
    ).toBe('complete');
    expect(
        sourceCoverageForWindow(
            100,
            '2026-06-01T00:00:00.000Z',
            windowEnd,
            windowStart,
            windowEnd
        )
    ).toBe('partial');
    expect(
        sourceCoverageForWindow(
            0,
            null,
            null,
            windowStart,
            windowEnd
        )
    ).toBe('unavailable');
});

test('matches attributable activity without persisting actor lists', () => {
    const savedSearch = contentObject(
        'saved_search::search::daily_review',
        'daily_review',
        'Saved Search'
    );
    const dashboard = contentObject(
        'dashboard::search::operations',
        'operations',
        'Dashboard'
    );
    const sources: CollectedUsageSource[] = [
        {
            summary: sourceSummary(),
            activities: [
                {
                    app: 'search',
                    name: 'daily_review',
                    user: 'reviewer',
                    observationCount: 14,
                    successfulCount: 12,
                    failedCount: 2,
                    skippedCount: 0,
                    lastObserved: '2026-07-27T10:00:00.000Z',
                },
            ],
        },
        {
            summary: sourceSummary({
                sourceId: 'dashboard_access',
                label: 'Splunk Web access log',
                activityKind: 'dashboard_view',
                activityRecordCount: 0,
            }),
            activities: [],
        },
    ];

    const built = buildUsageEvidence(
        [savedSearch, dashboard],
        usageRunId,
        inventoryScanId,
        90,
        windowStart,
        windowEnd,
        sources
    );

    expect(built.records).toHaveLength(2);
    expect(
        built.records.find(({ objectId }) => objectId === savedSearch.objectId)
            ?.usage
    ).toMatchObject({
        observationCount: 14,
        successfulCount: 12,
        failedCount: 2,
        lastObserved: '2026-07-27T10:00:00.000Z',
    });
    expect(
        built.records.find(({ objectId }) => objectId === dashboard.objectId)
            ?.usage
    ).toMatchObject({
        coverage: 'complete',
        observationCount: 0,
    });
    expect(JSON.stringify(built.records)).not.toContain('reviewer');
    expect(built.sources[0].matchedObjectCount).toBe(1);
});

test('maps same-name private activity only to its matching owner namespace', () => {
    const analyst = contentObject(
        'saved_search::search::user:analyst::daily_review',
        'daily_review',
        'Saved Search',
        { owner: 'analyst', sharing: 'user' }
    );
    const reviewer = contentObject(
        'saved_search::search::user:reviewer::daily_review',
        'daily_review',
        'Saved Search',
        { owner: 'reviewer', sharing: 'user' }
    );
    const built = buildUsageEvidence(
        [analyst, reviewer],
        usageRunId,
        inventoryScanId,
        90,
        windowStart,
        windowEnd,
        [
            {
                summary: sourceSummary(),
                activities: [
                    {
                        app: 'search',
                        name: 'daily_review',
                        user: 'reviewer',
                        observationCount: 3,
                        successfulCount: 3,
                        failedCount: 0,
                        skippedCount: 0,
                        lastObserved: '2026-07-20T12:00:00.000Z',
                    },
                ],
            },
        ]
    );

    expect(
        built.records.find(({ objectId }) => objectId === analyst.objectId)
            ?.usage.observationCount
    ).toBe(0);
    expect(
        built.records.find(({ objectId }) => objectId === reviewer.objectId)
            ?.usage.observationCount
    ).toBe(3);
});

test('observed activity removes a conservative dormant finding', () => {
    const object = contentObject(
        'saved_search::search::daily_review',
        'daily_review',
        'Saved Search',
        {
            healthStatus: 'dormant',
            abandonmentConfidence: 70,
        }
    );
    const finding: ContentFinding = {
        findingId: 'static-needs-review',
        objectId: object.objectId,
        findingType: 'needs_review',
        abandonmentConfidence: 70,
        removalImpact: 10,
        reasons: ['Usage telemetry is unavailable'],
        suggestedAction: 'Review',
        createdAt: windowEnd,
    };
    const applied = applyUsageEvidence(
        [object],
        [finding],
        [
            {
                objectId: object.objectId,
                usage: evidence({
                    observationCount: 8,
                    successfulCount: 8,
                    lastObserved: '2026-07-27T12:00:00.000Z',
                }),
            },
        ],
        inventoryScanId
    );

    expect(applied.objects[0]).toMatchObject({
        healthStatus: 'active',
        abandonmentConfidence: 5,
        lastUsed: '2026-07-27T12:00:00.000Z',
    });
    expect(applied.findings).toHaveLength(0);
});

test('zero observations change classification only for a complete current window', () => {
    const object = contentObject(
        'dashboard::search::operations',
        'operations',
        'Dashboard'
    );
    const complete = applyUsageEvidence(
        [object],
        [],
        [
            {
                objectId: object.objectId,
                usage: evidence({
                    sourceId: 'dashboard_access',
                    sourceLabel: 'Splunk Web access log',
                    activityKind: 'dashboard_view',
                }),
            },
        ],
        inventoryScanId
    );
    expect(complete.objects[0].healthStatus).toBe('dormant');
    expect(complete.objects[0].abandonmentConfidence).toBe(65);
    expect(complete.findings[0]).toMatchObject({
        findingType: 'needs_review',
        objectId: object.objectId,
    });

    const partial = applyUsageEvidence(
        [object],
        [],
        [
            {
                objectId: object.objectId,
                usage: evidence({
                    coverage: 'partial',
                    sourceId: 'dashboard_access',
                    sourceLabel: 'Splunk Web access log',
                    activityKind: 'dashboard_view',
                }),
            },
        ],
        inventoryScanId
    );
    expect(partial.objects[0].healthStatus).toBe('unknown');
    expect(partial.findings).toHaveLength(0);
});

test('evidence from an earlier inventory remains visible but does not rescore', () => {
    const object = contentObject(
        'dashboard::search::operations',
        'operations',
        'Dashboard'
    );
    const applied = applyUsageEvidence(
        [object],
        [],
        [
            {
                objectId: object.objectId,
                usage: evidence({
                    inventoryScanId: 'scan-inventory-earlier',
                }),
            },
        ],
        inventoryScanId
    );

    expect(applied.objects[0].healthStatus).toBe('unknown');
    expect(applied.objects[0].usageEvidence).not.toBeNull();
    expect(applied.objects[0].evidence.join(' ')).toContain(
        'predates the current object snapshot'
    );
    expect(applied.findings).toHaveLength(0);
});
