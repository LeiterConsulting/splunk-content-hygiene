import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplunkThemeProvider } from '@splunk/themes';
import { ReviewLibraryPage } from '../pages/ReviewLibraryPage';
import { DependencyPage } from '../pages/DependencyPage';
import { ReviewFreshnessPanel } from '../components/ReviewFreshnessPanel';
import { attachReviewEvidence, configurationFingerprint } from '../services/reviewEvidence';
import { InventorySnapshot, ReviewInput, ReviewRecord } from '../types';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';

jest.mock('../utils/downloadCsv', () => ({ downloadCsv: jest.fn() }));
jest.mock('../utils/downloadJson', () => ({ downloadJson: jest.fn() }));

async function data(): Promise<{ snapshot: InventorySnapshot; reviewed: ReviewRecord }> {
    const objects = await attachReviewEvidence(
        [
            {
                objectId: 'macro::example::reviewed',
                canonicalName: 'reviewed',
                name: 'Reviewed macro',
                objectType: 'Macro',
                app: 'example',
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
                    { definition: 'index=example' },
                    {},
                ),
            },
        ],
        [],
        {
            scanId: 'scan-current',
            observedAt: '2026-07-28T11:00:00Z',
            principal: 'operator',
            roles: [],
            mode: 'full',
            collectionComplete: true,
            analysisComplete: true,
            collectors: {},
        },
    );
    return {
        snapshot: {
            objects,
            edges: [],
            findings: [],
            owners: [],
            usage: null,
            scan: {
                scanId: 'scan-current',
                scanType: 'full',
                status: 'succeeded',
                startedAt: '2026-07-28T11:00:00Z',
                completedAt: '2026-07-28T11:00:00Z',
                objectCount: 1,
                edgeCount: 0,
                findingCount: 0,
                candidateCount: 0,
                warningCount: 0,
                warnings: [],
                errors: [],
                collectorCounts: {},
                collectorTotals: {},
                analysisStatus: 'complete',
                dataSource: 'live',
            },
        },
        reviewed: {
            objectId: objects[0].objectId,
            objectName: objects[0].name,
            canonicalName: objects[0].canonicalName,
            objectType: 'Macro',
            app: 'example',
            owner: 'analyst',
            healthStatusAtReview: 'unknown',
            usageCoverageAtReview: null,
            usageLastObservedAtReview: null,
            usageObservationCountAtReview: null,
            usageRunIdAtReview: null,
            stage: 'retain',
            note: 'Keep the original decision',
            assignedTo: 'team',
            scanId: 'scan-original',
            createdAt: '2026-07-27T00:00:00Z',
            updatedAt: '2026-07-27T00:00:00Z',
            updatedBy: 'reviewer',
        },
    };
}
beforeEach(() => window.history.replaceState(null, '', '/'));

test('loading inventory does not flash missing-object or review-validity conclusions', async () => {
    const { reviewed } = await data();
    render(<SplunkThemeProvider family="enterprise" colorScheme="light">
        <ReviewLibraryPage snapshot={null} reviews={[reviewed]} isLoading loadError={null}
            canWriteReviews onSaveReview={jest.fn()} onDeleteReview={jest.fn()} />
    </SplunkThemeProvider>);
    expect(screen.getByText('Loading review evidence…')).toBeInTheDocument();
    expect(screen.queryByText('Not present')).not.toBeInTheDocument();
    expect(screen.queryByText(/no longer observed/)).not.toBeInTheDocument();
});

test.each(['light', 'dark'] as const)(
    'legacy review stays Retain and requires explicit evidence capture in %s mode',
    async (colorScheme) => {
        const { snapshot, reviewed } = await data();
        const user = userEvent.setup();
        const onSave = jest.fn(async (input: ReviewInput): Promise<ReviewRecord> => ({
            ...reviewed,
            note: input.note,
            stage: input.stage,
        }));
        render(
            <SplunkThemeProvider family="enterprise" colorScheme={colorScheme}>
                <ReviewLibraryPage
                    snapshot={snapshot}
                    reviews={[reviewed]}
                    isLoading={false}
                    loadError={null}
                    canWriteReviews
                    onSaveReview={onSave}
                    onDeleteReview={jest.fn()}
                />
            </SplunkThemeProvider>,
        );
        await user.click(screen.getByRole('button', { name: 'Reviewed macro' }));
        const details = screen.getByRole('complementary', {
            name: 'Review details for Reviewed macro',
        });
        expect(within(details).getAllByText('Cannot verify')[0]).toBeVisible();
        await user.click(screen.getByRole('tab', { name: 'Review decision' }));
        expect(within(details).getByRole('textbox', { name: 'Investigation note' })).toHaveValue(
            reviewed.note,
        );
        await user.click(screen.getByRole('button', { name: 'Capture review evidence' }));
        await waitFor(() =>
            expect(onSave).toHaveBeenCalledWith(
                expect.objectContaining({
                    stage: 'retain',
                    note: reviewed.note,
                    captureEvidence: true,
                    expectedUpdatedAt: reviewed.updatedAt,
                }),
            ),
        );
        await user.type(
            within(details).getByRole('textbox', { name: 'Investigation note' }),
            ' - more context',
        );
        expect(screen.getByRole('button', { name: 'Capture review evidence' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: 'Update review record' }));
        await waitFor(() =>
            expect(onSave).toHaveBeenLastCalledWith(
                expect.objectContaining({ stage: 'retain', captureEvidence: false }),
            ),
        );
    },
);

test('Explorer exposes independent changes and full-impact tabs, including legacy evidence gaps', async () => {
    const { snapshot, reviewed } = await data();
    const user = userEvent.setup();
    render(
        <SplunkThemeProvider family="enterprise" colorScheme="light">
            <DependencyPage
                snapshot={snapshot}
                reviews={[reviewed]}
                isLoading={false}
                canWriteReviews={false}
                onSaveReview={jest.fn()}
                onDeleteReview={jest.fn()}
            />
        </SplunkThemeProvider>,
    );
    await user.click(screen.getByRole('tab', { name: 'Changes since review' }));
    const changes = screen.getByRole('region', { name: 'Changes since review' });
    expect(within(changes).getByText('Cannot verify')).toBeInTheDocument();
    expect(within(changes).getByText(/no supported evidence baseline/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Removal impact' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Review decision' }));
    expect(screen.getByRole('button', { name: 'Capture review evidence' })).toBeDisabled();
});

test('relationship-change exports retain every matching row beyond the visible page and drill into the selected object', async () => {
    const user = userEvent.setup();
    const onDrillTo = jest.fn();
    const relationships = Array.from({ length: 25 }, (_, i) => ({
        kind: 'new' as const,
        before: null,
        after: {
            key: `relationship-${i}`,
            direction: 'inbound' as const,
            objectId: `macro::example::${i}`,
            name: `Consumer ${i}`,
            relation: 'uses_macro',
            confidence: 'high' as const,
            resolved: true,
            sourceLocation: 'definition',
            evidenceDigest: 'digest',
            neighborDigest: 'neighbor',
        },
    }));
    render(
        <SplunkThemeProvider family="enterprise" colorScheme="dark">
            <ReviewFreshnessPanel
                objectId="macro::example::center"
                comparison={{
                    status: 'needs_review',
                    reasons: ['New relationships'],
                    limitations: [],
                    relationships,
                    comparedScanId: 'scan-current',
                    baseline: null,
                    current: null,
                    diffTruncated: false,
                }}
                canDrillTo={() => true}
                onDrillTo={onDrillTo}
            />
        </SplunkThemeProvider>,
    );
    expect(screen.getAllByRole('button', { name: 'Investigate object' })).toHaveLength(10);
    await user.click(screen.getAllByRole('button', { name: 'Investigate object' })[0]);
    expect(onDrillTo).toHaveBeenCalledWith('macro::example::0');
    await user.click(screen.getByRole('button', { name: 'Export filtered changes CSV' }));
    const { calls } = jest.mocked(downloadCsv).mock;
    expect(calls[calls.length - 1][2]).toHaveLength(25);
    await user.click(screen.getByRole('button', { name: 'Export review evidence JSON' }));
    expect(downloadJson).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ relationships }),
    );
});
