import React from 'react';
import {
    ButtonRow,
    Card,
    CardBody,
    CardHeader,
    CardTitle,
    CompositionBar,
    CompositionRow,
    CompositionSegment,
    EmptyState,
    Legend,
    LegendItem,
    MetricGrid,
    RowButton,
    StyledButton,
    Table,
    TableScroller,
    TwoColumnGrid,
} from '../AppStyles';
import { PageHeader } from '../components/PageHeader';
import { ReviewStageBadge } from '../components/ReviewStageBadge';
import { StatusBadge } from '../components/StatusBadge';
import { SummaryMetric } from '../components/SummaryMetric';
import {
    AppComposition,
    ContentObject,
    InventorySnapshot,
    ReviewRecord,
} from '../types';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { navigateToView } from '../utils/navigation';

const numberFormatter = new Intl.NumberFormat('en-US');
const candidateFindingTypes = new Set([
    'cleanup_candidate',
    'broken_reference',
    'unowned',
    'needs_review',
    'repair_required',
]);

interface OverviewPageProps {
    snapshot: InventorySnapshot | null;
    isLoading: boolean;
    reviews: ReviewRecord[];
}

function percentage(count: number, total: number): number {
    return total === 0 ? 0 : Math.round((count / total) * 100);
}

function buildAppComposition(objects: ContentObject[]): AppComposition[] {
    const byApp = new Map<string, ContentObject[]>();
    objects.forEach((contentObject) => {
        const appObjects = byApp.get(contentObject.app) ?? [];
        appObjects.push(contentObject);
        byApp.set(contentObject.app, appObjects);
    });

    return Array.from(byApp.entries())
        .map(([app, appObjects]) => {
            const total = appObjects.length;
            const statusCount = (statuses: ContentObject['healthStatus'][]): number =>
                appObjects.filter((contentObject) =>
                    statuses.includes(contentObject.healthStatus)
                ).length;
            return {
                app,
                objectCount: total,
                activePercent: percentage(statusCount(['active']), total),
                reviewPercent: percentage(
                    statusCount(['dormant', 'unowned']),
                    total
                ),
                concernPercent: percentage(
                    statusCount(['orphaned', 'broken']),
                    total
                ),
                protectedPercent: percentage(statusCount(['protected']), total),
                unknownPercent: percentage(statusCount(['unknown']), total),
            };
        })
        .sort(
            (left, right) =>
                right.objectCount - left.objectCount ||
                left.app.localeCompare(right.app)
        );
}

export function OverviewPage({
    snapshot,
    isLoading,
    reviews,
}: OverviewPageProps): React.ReactElement {
    const objects = snapshot?.objects ?? [];
    const findings = snapshot?.findings ?? [];
    const fullAppComposition = buildAppComposition(objects);
    const appComposition = fullAppComposition.slice(0, 10);
    const reviewByObject = new Map(
        reviews.map((review) => [review.objectId, review])
    );
    const candidateIds = new Set(
        findings
            .filter((finding) => candidateFindingTypes.has(finding.findingType))
            .map((finding) => finding.objectId)
    );
    const findingByObject = new Map(
        findings.map((finding) => [finding.objectId, finding])
    );
    const reviewTargets = objects
        .filter(
            (contentObject) =>
                candidateIds.has(contentObject.objectId) ||
                ['dormant', 'orphaned', 'broken', 'unowned'].includes(
                    contentObject.healthStatus
                )
        )
        .sort(
            (left, right) =>
                (findingByObject.get(right.objectId)?.abandonmentConfidence ??
                    right.abandonmentConfidence ??
                    -1) -
                (findingByObject.get(left.objectId)?.abandonmentConfidence ??
                    left.abandonmentConfidence ??
                    -1)
        )
        .slice(0, 5);
    const protectedCount = objects.filter(
        (contentObject) => contentObject.protected
    ).length;
    const unknownCount = objects.filter(
        (contentObject) => contentObject.healthStatus === 'unknown'
    ).length;
    const ownershipGapCount = objects.filter(
        (contentObject) =>
            contentObject.owner === null &&
            contentObject.sharing === 'user'
    ).length;

    return (
        <>
            <PageHeader
                title="Environment Overview"
                subtitle="Understand what was collected from Splunk, what has been analyzed, and where evidence is still missing."
                actions={
                    <ButtonRow>
                        <StyledButton
                            type="button"
                            onClick={() =>
                                downloadCsv(
                                    'content-hygiene-environment-summary.csv',
                                    [
                                        'App',
                                        'Objects',
                                        'Active percent',
                                        'Needs review percent',
                                        'Concern percent',
                                        'Protected percent',
                                        'Unknown percent',
                                    ],
                                    fullAppComposition.map((app) => [
                                        app.app,
                                        app.objectCount,
                                        app.activePercent,
                                        app.reviewPercent,
                                        app.concernPercent,
                                        app.protectedPercent,
                                        app.unknownPercent,
                                    ])
                                )
                            }
                            disabled={!snapshot}
                        >
                            Export summary CSV
                        </StyledButton>
                        <StyledButton
                            type="button"
                            onClick={() =>
                                downloadJson(
                                    'content-hygiene-environment-summary.json',
                                    {
                                        exportedAt: new Date().toISOString(),
                                        scan: snapshot?.scan ?? null,
                                        summary: {
                                            objectCount: objects.length,
                                            relationshipCount:
                                                snapshot?.edges.length ?? 0,
                                            findingCount: findings.length,
                                            ownershipGapCount,
                                            protectedCount,
                                            unknownCount,
                                            reviewLibraryCount: reviews.length,
                                        },
                                        appComposition: fullAppComposition,
                                        reviews,
                                    }
                                )
                            }
                            disabled={!snapshot}
                        >
                            Export summary JSON
                        </StyledButton>
                        <StyledButton
                            type="button"
                            onClick={() => navigateToView('reviews')}
                        >
                            Review library
                        </StyledButton>
                        <StyledButton
                            type="button"
                            $primary
                            onClick={() => navigateToView('candidates')}
                        >
                            Review candidates
                        </StyledButton>
                    </ButtonRow>
                }
            />

            <MetricGrid aria-label="Environment summary">
                <SummaryMetric
                    label="Cached objects"
                    value={snapshot ? numberFormatter.format(objects.length) : '—'}
                    hint="Live objects in the latest scan snapshot"
                />
                <SummaryMetric
                    label="Analysis findings"
                    value={snapshot ? numberFormatter.format(findings.length) : '—'}
                    hint="Conclusions backed by cached analysis evidence"
                    accent="warning"
                />
                <SummaryMetric
                    label="Relationships"
                    value={
                        snapshot
                            ? numberFormatter.format(snapshot.edges.length)
                            : '—'
                    }
                    hint="Directional dependency edges found by analysis"
                    accent="info"
                />
                <SummaryMetric
                    label="Ownership gaps"
                    value={
                        snapshot ? numberFormatter.format(ownershipGapCount) : '—'
                    }
                    hint="User-scoped objects without a resolvable owner"
                    accent="info"
                />
                <SummaryMetric
                    label="Review library"
                    value={numberFormatter.format(reviews.length)}
                    hint="App-local investigation and confirmation records"
                    accent="info"
                />
                <SummaryMetric
                    label="Awaiting analysis"
                    value={snapshot ? numberFormatter.format(unknownCount) : '—'}
                    hint={`${numberFormatter.format(protectedCount)} protected objects are excluded from cleanup review`}
                    accent="positive"
                />
            </MetricGrid>

            <TwoColumnGrid>
                <Card>
                    <CardHeader>
                        <CardTitle>Live inventory by app</CardTitle>
                        <Legend aria-label="Health legend">
                            <LegendItem $status="active">Active</LegendItem>
                            <LegendItem $status="dormant">Needs review</LegendItem>
                            <LegendItem $status="orphaned">Concern</LegendItem>
                            <LegendItem $status="protected">Protected</LegendItem>
                            <LegendItem $status="unknown">Unknown</LegendItem>
                        </Legend>
                    </CardHeader>
                    {appComposition.length === 0 ? (
                        <EmptyState>
                            <div>
                                <strong>
                                    {isLoading
                                        ? 'Loading live inventory…'
                                        : 'No live inventory is cached'}
                                </strong>
                                <p>
                                    Run a bounded live scan from Settings to populate
                                    this view.
                                </p>
                            </div>
                        </EmptyState>
                    ) : (
                        <CardBody>
                            {appComposition.map((app) => (
                                <CompositionRow key={app.app}>
                                    <RowButton
                                        type="button"
                                        onClick={() =>
                                            navigateToView('candidates', {
                                                app: app.app,
                                            })
                                        }
                                    >
                                        {app.app}
                                    </RowButton>
                                    <CompositionBar
                                        role="img"
                                        aria-label={`${app.app}: ${app.activePercent}% active, ${app.reviewPercent}% needs review, ${app.concernPercent}% concern, ${app.protectedPercent}% protected, ${app.unknownPercent}% unknown`}
                                    >
                                        <CompositionSegment
                                            $percent={app.activePercent}
                                            $status="active"
                                        />
                                        <CompositionSegment
                                            $percent={app.reviewPercent}
                                            $status="dormant"
                                        />
                                        <CompositionSegment
                                            $percent={app.concernPercent}
                                            $status="orphaned"
                                        />
                                        <CompositionSegment
                                            $percent={app.protectedPercent}
                                            $status="protected"
                                        />
                                        <CompositionSegment
                                            $percent={app.unknownPercent}
                                            $status="unknown"
                                        />
                                    </CompositionBar>
                                    <span>
                                        {numberFormatter.format(app.objectCount)}
                                    </span>
                                </CompositionRow>
                            ))}
                        </CardBody>
                    )}
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Evidence-backed review targets</CardTitle>
                        <StyledButton
                            type="button"
                            onClick={() => navigateToView('candidates')}
                        >
                            View all
                        </StyledButton>
                    </CardHeader>
                    {reviewTargets.length === 0 ? (
                        <EmptyState>
                            <div>
                                <strong>No live cleanup findings are cached</strong>
                                <p>
                                    {snapshot?.scan.analysisStatus === 'pending'
                                        ? 'Inventory exists, but dependency and usage analysis is still pending.'
                                        : 'The latest analysis did not produce cleanup candidates.'}
                                </p>
                            </div>
                        </EmptyState>
                    ) : (
                        <TableScroller>
                            <Table>
                                <thead>
                                    <tr>
                                        <th scope="col">Object</th>
                                        <th scope="col">Status</th>
                                        <th scope="col">Confidence</th>
                                        <th scope="col">Review</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {reviewTargets.map((contentObject) => (
                                        <tr key={contentObject.objectId}>
                                            <td>
                                                <RowButton
                                                    type="button"
                                                    onClick={() =>
                                                        navigateToView(
                                                            'candidates',
                                                            {
                                                                object: contentObject.objectId,
                                                            }
                                                        )
                                                    }
                                                >
                                                    {contentObject.name}
                                                </RowButton>
                                                <div>{contentObject.app}</div>
                                            </td>
                                            <td>
                                                <StatusBadge
                                                    status={
                                                        contentObject.healthStatus
                                                    }
                                                />
                                            </td>
                                            <td>
                                                {findingByObject.get(
                                                    contentObject.objectId
                                                )?.abandonmentConfidence ??
                                                    contentObject.abandonmentConfidence ??
                                                    'Unknown'}
                                            </td>
                                            <td>
                                                {reviewByObject.has(
                                                    contentObject.objectId
                                                ) ? (
                                                    <ReviewStageBadge
                                                        stage={
                                                            reviewByObject.get(
                                                                contentObject.objectId
                                                            )!.stage
                                                        }
                                                    />
                                                ) : (
                                                    '—'
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        </TableScroller>
                    )}
                </Card>
            </TwoColumnGrid>
        </>
    );
}
