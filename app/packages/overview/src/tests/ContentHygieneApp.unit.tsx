import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
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

function clientWithSnapshot(snapshot = liveSnapshot): InventoryClient {
    return {
        isAvailable: () => true,
        getLatestSnapshot: async () => snapshot,
        runBoundedScan: async () => snapshot,
        runFullScan: async () => snapshot,
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
