import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ContentHygieneApp } from '../ContentHygieneApp';
import {
    InventoryClient,
    InventorySnapshot,
    ReviewClient,
    ReviewRecord,
    ScanSummary,
} from '../types';

const liveScan: ScanSummary = {
    scanId: 'scan-live-test',
    scanType: 'incremental',
    status: 'succeeded',
    startedAt: '2026-07-24T17:00:00Z',
    completedAt: '2026-07-24T17:00:04Z',
    objectCount: 2,
    edgeCount: 1,
    findingCount: 1,
    candidateCount: 1,
    warningCount: 0,
    warnings: [],
    errors: [],
    collectorCounts: {
        saved_searches: 1,
        dashboards: 1,
        owners: 1,
    },
    collectorTotals: {
        saved_searches: 1,
        dashboards: 1,
        owners: 1,
    },
    analysisStatus: 'complete',
    dataSource: 'live',
};

const liveSnapshot: InventorySnapshot = {
    scan: liveScan,
    usage: null,
    objects: [
        {
            objectId: 'saved_search::search::daily_error_review',
            canonicalName: 'daily_error_review',
            name: 'Daily Error Review',
            objectType: 'Saved Search',
            app: 'search',
            owner: 'analyst',
            sharing: 'app',
            enabled: true,
            scheduled: false,
            updated: '2026-07-24T15:00:00Z',
            lastUsed: '2026-07-24T16:00:00Z',
            usageEvidence: null,
            healthStatus: 'active',
            abandonmentConfidence: 8,
            removalImpact: 78,
            inboundReferences: 1,
            outboundReferences: 0,
            protected: false,
            evidence: ['Executed in the latest usage window'],
            suggestedAction: 'Keep and monitor',
        },
        {
            objectId: 'dashboard::search::retired_host_report',
            canonicalName: 'retired_host_report',
            name: 'Retired Host Report',
            objectType: 'Dashboard',
            app: 'search',
            owner: null,
            sharing: 'user',
            enabled: false,
            scheduled: null,
            updated: '2025-01-01T00:00:00Z',
            lastUsed: '2025-12-05T14:20:00Z',
            usageEvidence: null,
            healthStatus: 'dormant',
            abandonmentConfidence: 82,
            removalImpact: 22,
            inboundReferences: 0,
            outboundReferences: 1,
            protected: false,
            evidence: ['No observed views in the configured evidence window'],
            suggestedAction: 'Request owner review',
        },
    ],
    edges: [
        {
            edgeId: 'edge-live-test',
            sourceId: 'dashboard::search::retired_host_report',
            targetId: 'saved_search::search::daily_error_review',
            relation: 'references',
            confidence: 'high',
            evidence: 'Structured saved-search reference',
            sourceLocation: 'eai:data.search.ref',
            resolved: true,
        },
    ],
    findings: [
        {
            findingId: 'finding-live-test',
            objectId: 'dashboard::search::retired_host_report',
            findingType: 'cleanup_candidate',
            abandonmentConfidence: 82,
            removalImpact: 22,
            reasons: ['No observed views in the configured evidence window'],
            suggestedAction: 'Request owner review',
            createdAt: '2026-07-24T17:00:04Z',
        },
    ],
    owners: [
        {
            owner: 'analyst',
            status: 'active',
            objectCount: 1,
            activeCount: 1,
            reviewCount: 0,
            unownedCount: 0,
        },
        {
            owner: 'Unowned',
            status: 'missing',
            objectCount: 1,
            activeCount: 0,
            reviewCount: 1,
            unownedCount: 1,
        },
    ],
};

const usageSnapshot: InventorySnapshot = {
    ...liveSnapshot,
    usage: {
        runId: 'scan-usage-live',
        inventoryScanId: liveScan.scanId,
        status: 'succeeded',
        startedAt: '2026-04-25T17:00:00Z',
        completedAt: '2026-07-24T17:10:00Z',
        windowDays: 90,
        windowStart: '2026-04-25T17:00:00Z',
        windowEnd: '2026-07-24T17:00:00Z',
        coverage: 'complete',
        eligibleObjectCount: 2,
        fullyCoveredObjectCount: 2,
        observedObjectCount: 1,
        warningCount: 0,
        warnings: [],
        sources: [
            {
                sourceId: 'search_audit',
                label: 'Splunk search audit',
                activityKind: 'saved_search_execution',
                coverage: 'complete',
                coverageStart: '2026-04-25T17:00:00Z',
                coverageEnd: '2026-07-24T17:00:00Z',
                sourceEventCount: 300,
                activityRecordCount: 1,
                matchedObjectCount: 1,
                truncated: false,
                warning: null,
            },
            {
                sourceId: 'dashboard_access',
                label: 'Splunk Web access log',
                activityKind: 'dashboard_view',
                coverage: 'complete',
                coverageStart: '2026-04-25T17:00:00Z',
                coverageEnd: '2026-07-24T17:00:00Z',
                sourceEventCount: 500,
                activityRecordCount: 0,
                matchedObjectCount: 0,
                truncated: false,
                warning: null,
            },
        ],
        matchesCurrentInventory: true,
    },
    objects: liveSnapshot.objects.map((contentObject) => {
        const observed = contentObject.objectType === 'Saved Search';
        return {
            ...contentObject,
            lastUsed: observed ? '2026-07-24T16:00:00Z' : null,
            usageEvidence: {
                usageRunId: 'scan-usage-live',
                inventoryScanId: liveScan.scanId,
                sourceId: observed ? 'search_audit' : 'dashboard_access',
                sourceLabel: observed
                    ? 'Splunk search audit'
                    : 'Splunk Web access log',
                activityKind: observed
                    ? ('saved_search_execution' as const)
                    : ('dashboard_view' as const),
                windowDays: 90,
                windowStart: '2026-04-25T17:00:00Z',
                windowEnd: '2026-07-24T17:00:00Z',
                coverage: 'complete' as const,
                coverageStart: '2026-04-25T17:00:00Z',
                coverageEnd: '2026-07-24T17:00:00Z',
                sourceEventCount: observed ? 300 : 500,
                observationCount: observed ? 12 : 0,
                successfulCount: observed ? 11 : 0,
                failedCount: observed ? 1 : 0,
                skippedCount: 0,
                lastObserved: observed ? '2026-07-24T16:00:00Z' : null,
                evidence: [
                    observed
                        ? 'Observed 12 saved-search executions'
                        : 'No dashboard access was observed during the complete 90-day source window',
                ],
            },
        };
    }),
};

function inventoryByAppSnapshot(): InventorySnapshot {
    const appNames = [
        'alpha_tools',
        'bravo',
        'charlie',
        'delta',
        'echo',
        'foxtrot',
        'golf',
        'hotel',
        'india',
        'juliet',
        'kilo',
        'zeta',
    ];
    const objects = appNames.map((app, index) => ({
        objectId: `dashboard::${app}::overview`,
        canonicalName: 'overview',
        name: `${app} overview`,
        objectType: 'Dashboard',
        app,
        owner: 'analyst',
        sharing: 'app',
        enabled: true,
        scheduled: null,
        updated: '2026-07-24T15:00:00Z',
        lastUsed: '2026-07-24T16:00:00Z',
        usageEvidence: null,
        healthStatus: index === 0 ? ('dormant' as const) : ('active' as const),
        abandonmentConfidence: index === 0 ? 70 : 5,
        removalImpact: 10,
        inboundReferences: 0,
        outboundReferences: 0,
        protected: false,
        evidence: ['Live inventory test evidence'],
        suggestedAction: index === 0 ? 'Review' : 'Keep',
    }));
    objects.push({
        ...objects[objects.length - 1],
        objectId: 'saved_search::zeta::daily_review',
        canonicalName: 'daily_review',
        name: 'zeta daily review',
        objectType: 'Saved Search',
    });

    return {
        scan: {
            ...liveScan,
            scanId: 'scan-live-apps',
            objectCount: objects.length,
            edgeCount: 0,
            findingCount: 0,
            candidateCount: 0,
        },
        usage: null,
        objects,
        edges: [],
        findings: [],
        owners: [],
    };
}

function clientWithSnapshot(snapshot = liveSnapshot): InventoryClient {
    return {
        isAvailable: () => true,
        getLatestSnapshot: async () => snapshot,
        runBoundedScan: async () => snapshot,
        runFullScan: async () => snapshot,
        runUsageScan: async () => snapshot,
    };
}

function mutableReviewClient(): {
    client: ReviewClient;
    records: ReviewRecord[];
} {
    const records: ReviewRecord[] = [];
    const client: ReviewClient = {
        isAvailable: () => true,
        listReviews: async () => [...records],
        upsertReview: async (input) => {
            const now = '2026-07-24T18:00:00Z';
            const existing = records.find((record) => record.objectId === input.object.objectId);
            const saved: ReviewRecord = {
                objectId: input.object.objectId,
                objectName: input.object.name,
                canonicalName: input.object.canonicalName,
                objectType: input.object.objectType,
                app: input.object.app,
                owner: input.object.owner,
                healthStatusAtReview: input.object.healthStatus,
                usageCoverageAtReview:
                    input.object.usageEvidence?.coverage ?? null,
                usageLastObservedAtReview:
                    input.object.usageEvidence?.lastObserved ?? null,
                usageObservationCountAtReview:
                    input.object.usageEvidence?.observationCount ?? null,
                usageRunIdAtReview:
                    input.object.usageEvidence?.usageRunId ?? null,
                stage: input.stage,
                note: input.note,
                assignedTo: input.assignedTo,
                scanId: input.scanId,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
                updatedBy: 'test-user',
            };
            records.splice(
                0,
                records.length,
                ...records.filter((record) => record.objectId !== saved.objectId),
                saved,
            );
            return saved;
        },
        deleteReview: async (objectId) => {
            const index = records.findIndex((record) => record.objectId === objectId);
            if (index >= 0) {
                records.splice(index, 1);
            }
        },
    };
    return { client, records };
}

test('renders an evidence-backed live overview without unsafe claims', async () => {
    render(<ContentHygieneApp page="overview" inventoryClient={clientWithSnapshot()} />);

    expect(screen.getByRole('heading', { name: 'Environment Overview' })).toBeInTheDocument();
    expect(await screen.findByText('Live inventory cache ready')).toBeInTheDocument();
    expect(screen.getByText('Retired Host Report')).toBeInTheDocument();
    expect(screen.queryByText(/safe to delete/i)).not.toBeInTheDocument();
});

test('sorts, paginates, searches, and expands live inventory by app', async () => {
    const user = userEvent.setup();
    render(
        <ContentHygieneApp
            page="overview"
            inventoryClient={clientWithSnapshot(inventoryByAppSnapshot())}
        />,
    );

    await screen.findByText('Live inventory cache ready');
    const pagination = screen.getByRole('navigation', {
        name: 'Live inventory by app pagination',
    });
    expect(pagination).toHaveTextContent('1–10 of 12 apps · Page 1 of 2');
    expect(screen.getAllByTitle(/^View cleanup candidates for /)[0]).toHaveTextContent('zeta');

    await user.click(within(pagination).getByRole('button', { name: 'Next' }));
    expect(pagination).toHaveTextContent('11–12 of 12 apps · Page 2 of 2');
    expect(screen.getByTitle('View cleanup candidates for juliet')).toBeInTheDocument();
    expect(screen.getByTitle('View cleanup candidates for kilo')).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'app');
    expect(pagination).toHaveTextContent('1–10 of 12 apps · Page 1 of 2');
    expect(screen.getAllByTitle(/^View cleanup candidates for /)[0]).toHaveTextContent(
        'alpha_tools',
    );

    await user.click(screen.getByRole('button', { name: 'Sort direction: A–Z' }));
    expect(screen.getAllByTitle(/^View cleanup candidates for /)[0]).toHaveTextContent('zeta');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Rows' }), '5');
    expect(pagination).toHaveTextContent('1–5 of 12 apps · Page 1 of 3');

    const appSearch = screen.getByRole('searchbox', { name: 'Find app' });
    await user.type(appSearch, 'alpha tools');
    expect(pagination).toHaveTextContent('1–1 of 1 apps · Page 1 of 1');
    expect(screen.queryByTitle('View cleanup candidates for zeta')).not.toBeInTheDocument();

    await user.click(
        screen.getByRole('button', {
            name: /Show health breakdown for alpha_tools:/,
        }),
    );
    const breakdown = screen.getByRole('region', {
        name: 'Health breakdown for alpha_tools',
    });
    expect(within(breakdown).getByText('Needs review')).toBeInTheDocument();
    expect(within(breakdown).getByText('1 (100%)')).toBeInTheDocument();
    expect(
        within(breakdown).getByRole('button', {
            name: 'View app candidates',
        }),
    ).toBeInTheDocument();
});

test('filters live candidates and shows recorded finding evidence', async () => {
    const user = userEvent.setup();
    render(<ContentHygieneApp page="cleanup-candidates" inventoryClient={clientWithSnapshot()} />);

    await screen.findByText('Live inventory cache ready');
    const search = screen.getByRole('searchbox', { name: 'Search' });
    await user.type(search, 'retired host');

    expect(screen.getByRole('button', { name: 'Retired Host Report' })).toBeInTheDocument();
    expect(
        screen.getByText('No observed views in the configured evidence window'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /disable/i })).not.toBeInTheDocument();
});

test('keeps abandonment confidence and removal impact separate', async () => {
    render(<ContentHygieneApp page="dependency-explorer" inventoryClient={clientWithSnapshot()} />);

    expect(await screen.findByText('Live inventory cache ready')).toBeInTheDocument();
    expect(screen.getByText('Abandonment confidence')).toBeInTheDocument();
    expect(screen.getByText('Removal impact')).toBeInTheDocument();
    expect(screen.queryByText(/^Risk score$/i)).not.toBeInTheDocument();
});

test('explains removal blast radius and recommends a non-destructive sequence', async () => {
    render(<ContentHygieneApp page="dependency-explorer" inventoryClient={clientWithSnapshot()} />);

    await screen.findByText('Live inventory cache ready');
    expect(screen.getByRole('heading', { name: 'Impact of removal' })).toBeInTheDocument();
    expect(
        screen.getByText('Address 1 known direct dependent before considering removal.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Direct dependents')).toBeInTheDocument();
    expect(screen.getByText('Known dependencies require remediation.')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Likely outcome' })).toBeInTheDocument();
    expect(
        screen.getByRole('heading', { name: 'Recommended removal sequence' }),
    ).toBeInTheDocument();
    expect(
        screen.getByText(/supported Splunk administration or deployment process/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export impact CSV' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Export impact JSON' })).toBeEnabled();
    expect(
        screen.queryByRole('button', { name: /remove selected|delete selected/i }),
    ).not.toBeInTheDocument();
});

test('shows an honest empty state when no live snapshot exists', () => {
    const unavailableClient: InventoryClient = {
        isAvailable: () => false,
        getLatestSnapshot: async () => null,
        runBoundedScan: async () => liveSnapshot,
        runFullScan: async () => liveSnapshot,
        runUsageScan: async () => liveSnapshot,
    };
    render(<ContentHygieneApp page="overview" inventoryClient={unavailableClient} />);

    expect(screen.getByText('No live inventory cached')).toBeInTheDocument();
    expect(screen.getByText('No live inventory is cached')).toBeInTheDocument();
    expect(screen.queryByText(/demo data/i)).not.toBeInTheDocument();
});

test('runs a bounded live inventory from Settings and exposes its provenance', async () => {
    const user = userEvent.setup();
    const inventoryClient: InventoryClient = {
        isAvailable: () => true,
        getLatestSnapshot: async () => {
            throw new Error('Initial snapshot failed');
        },
        runBoundedScan: async (onProgress) => {
            onProgress?.({
                completedCollectors: 6,
                totalCollectors: 6,
                stage: 'Loading live inventory',
            });
            return liveSnapshot;
        },
        runFullScan: async () => liveSnapshot,
        runUsageScan: async () => liveSnapshot,
    };

    render(<ContentHygieneApp page="settings" inventoryClient={inventoryClient} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Initial snapshot failed');
    await user.click(screen.getByRole('button', { name: 'Run bounded live scan' }));

    expect(await screen.findByText('scan-live-test')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getAllByText('Live Splunk data')).toHaveLength(2);
    expect(screen.getByText('Live inventory cache ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run complete live scan' })).toBeEnabled();
});

test('collects a selected usage window and displays source provenance', async () => {
    const user = userEvent.setup();
    const runUsageScan = jest.fn(async () => usageSnapshot);
    const inventoryClient: InventoryClient = {
        ...clientWithSnapshot(),
        runUsageScan,
    };

    render(<ContentHygieneApp page="settings" inventoryClient={inventoryClient} />);
    await screen.findByText('scan-live-test');
    await user.selectOptions(
        screen.getByRole('combobox', { name: 'Usage observation window' }),
        '180',
    );
    await user.click(screen.getByRole('button', { name: 'Collect usage evidence' }));

    expect(runUsageScan).toHaveBeenCalledWith(180, expect.any(Function));
    expect(await screen.findByText('scan-usage-live')).toBeInTheDocument();
    expect(screen.getByText(/Splunk search audit: complete/)).toBeInTheDocument();
    expect(screen.getByText(/Raw user SPL and actor lists are not persisted/)).toBeInTheDocument();
});

test('filters candidates by defensible usage-evidence state', async () => {
    const user = userEvent.setup();
    render(
        <ContentHygieneApp
            page="cleanup-candidates"
            inventoryClient={clientWithSnapshot(usageSnapshot)}
        />,
    );

    await screen.findByText('Live inventory cache ready');
    await user.selectOptions(
        screen.getByRole('combobox', { name: 'Usage evidence' }),
        'no_observations_complete',
    );

    expect(screen.getAllByText('Retired Host Report')).toHaveLength(2);
    expect(
        screen.getByText(/No attributable activity was observed in the complete source window/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Daily Error Review')).not.toBeInTheDocument();
});

test('persists candidate confirmation workflow records in the app-local review library', async () => {
    const user = userEvent.setup();
    const reviews = mutableReviewClient();
    render(
        <ContentHygieneApp
            page="cleanup-candidates"
            inventoryClient={clientWithSnapshot()}
            reviewClient={reviews.client}
        />,
    );

    await screen.findByText('Live inventory cache ready');
    await user.selectOptions(screen.getByLabelText('Confirmation stage'), 'investigating');
    await user.type(screen.getByRole('textbox', { name: 'Assigned reviewer' }), 'platform-team');
    await user.type(
        screen.getByRole('textbox', { name: 'Investigation note' }),
        'Confirm the dashboard reference with its owner.',
    );
    await user.click(screen.getByRole('button', { name: 'Add to review library' }));

    expect(
        await screen.findByText('Review record saved to the app-local library.'),
    ).toBeInTheDocument();
    expect(reviews.records).toHaveLength(1);
    expect(reviews.records[0]).toMatchObject({
        objectName: 'Retired Host Report',
        stage: 'investigating',
        assignedTo: 'platform-team',
    });

    cleanup();
    render(
        <ContentHygieneApp
            page="review-library"
            inventoryClient={clientWithSnapshot()}
            reviewClient={reviews.client}
        />,
    );

    expect(await screen.findByRole('heading', { name: 'Review Library' })).toBeInTheDocument();
    expect(await screen.findByText('platform-team')).toBeInTheDocument();
    expect(
        screen.getByDisplayValue('Confirm the dashboard reference with its owner.'),
    ).toBeInTheDocument();
});

test('broadens center scope when drilling to a related object outside the review group', async () => {
    const user = userEvent.setup();
    const reviews = mutableReviewClient();
    reviews.records.push({
        objectId: 'dashboard::search::retired_host_report',
        objectName: 'Retired Host Report',
        canonicalName: 'retired_host_report',
        objectType: 'Dashboard',
        app: 'search',
        owner: null,
        healthStatusAtReview: 'dormant',
        usageCoverageAtReview: null,
        usageLastObservedAtReview: null,
        usageObservationCountAtReview: null,
        usageRunIdAtReview: null,
        stage: 'investigating',
        note: 'Dependency review',
        assignedTo: 'platform-team',
        scanId: liveScan.scanId,
        createdAt: '2026-07-24T17:00:00Z',
        updatedAt: '2026-07-24T18:00:00Z',
        updatedBy: 'test-user',
    });

    render(
        <ContentHygieneApp
            page="dependency-explorer"
            inventoryClient={clientWithSnapshot()}
            reviewClient={reviews.client}
        />,
    );

    await screen.findByText('Live inventory cache ready');
    const centerGroup = screen.getByRole('combobox', {
        name: 'Center group',
    });
    await user.selectOptions(centerGroup, 'investigating');
    await user.click(screen.getByRole('button', { name: 'Drill in' }));

    expect(centerGroup).toHaveValue('all');
    expect(
        screen.getByRole('heading', { name: 'Daily Error Review', level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Dependency drill path' })).toHaveTextContent(
        'Retired Host Report',
    );
});
