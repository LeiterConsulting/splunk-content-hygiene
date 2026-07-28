import React, { useState } from 'react';
import {
    ButtonRow,
    Card,
    CardBody,
    CardHeader,
    CardTitle,
    CompositionBar,
    CompositionControl,
    CompositionControls,
    CompositionDetails,
    CompositionDetailsHeader,
    CompositionMetricGrid,
    CompositionPagination,
    CompositionRow,
    CompositionSegment,
    CompositionSummary,
    EmptyState,
    Input,
    Legend,
    LegendItem,
    MetricGrid,
    RowButton,
    Select,
    StyledButton,
    Table,
    TableScroller,
    TwoColumnGrid,
} from '../AppStyles';
import { PageHeader } from '../components/PageHeader';
import { ReviewStageBadge } from '../components/ReviewStageBadge';
import { StatusBadge } from '../components/StatusBadge';
import { SummaryMetric } from '../components/SummaryMetric';
import { AppComposition, ContentObject, InventorySnapshot, ReviewRecord } from '../types';
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
const appPageSizeOptions = [5, 10, 25];

type AppSortKey =
    | 'app'
    | 'objectCount'
    | 'activePercent'
    | 'reviewPercent'
    | 'concernPercent'
    | 'protectedPercent'
    | 'unknownPercent';
type SortDirection = 'asc' | 'desc';

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
                appObjects.filter((contentObject) => statuses.includes(contentObject.healthStatus))
                    .length;
            const activeCount = statusCount(['active']);
            const reviewCount = statusCount(['dormant', 'unowned']);
            const concernCount = statusCount(['orphaned', 'broken']);
            const protectedCount = statusCount(['protected']);
            const unknownCount = statusCount(['unknown']);
            return {
                app,
                objectCount: total,
                activeCount,
                reviewCount,
                concernCount,
                protectedCount,
                unknownCount,
                activePercent: percentage(activeCount, total),
                reviewPercent: percentage(reviewCount, total),
                concernPercent: percentage(concernCount, total),
                protectedPercent: percentage(protectedCount, total),
                unknownPercent: percentage(unknownCount, total),
            };
        })
        .sort(
            (left, right) =>
                right.objectCount - left.objectCount || left.app.localeCompare(right.app),
        );
}

function sortAppComposition(
    rows: AppComposition[],
    sortKey: AppSortKey,
    direction: SortDirection,
): AppComposition[] {
    const directionMultiplier = direction === 'asc' ? 1 : -1;
    return [...rows].sort((left, right) => {
        const comparison =
            sortKey === 'app'
                ? left.app.localeCompare(right.app, undefined, {
                      numeric: true,
                      sensitivity: 'base',
                  })
                : appSortValue(left, sortKey) - appSortValue(right, sortKey);
        return (
            comparison * directionMultiplier ||
            left.app.localeCompare(right.app, undefined, {
                numeric: true,
                sensitivity: 'base',
            })
        );
    });
}

function appSortValue(app: AppComposition, sortKey: Exclude<AppSortKey, 'app'>): number {
    if (sortKey === 'objectCount') {
        return app.objectCount;
    }
    const statusCount = {
        activePercent: app.activeCount,
        reviewPercent: app.reviewCount,
        concernPercent: app.concernCount,
        protectedPercent: app.protectedCount,
        unknownPercent: app.unknownCount,
    }[sortKey];
    return app.objectCount === 0 ? 0 : statusCount / app.objectCount;
}

function normalizeAppSearch(value: string): string {
    return value.toLowerCase().replace(/[_-]+/g, ' ');
}

function sortDirectionLabel(sortKey: AppSortKey, direction: SortDirection): string {
    if (sortKey === 'app') {
        return direction === 'asc' ? 'A–Z' : 'Z–A';
    }
    return direction === 'asc' ? 'Low to high' : 'High to low';
}

export function OverviewPage({
    snapshot,
    isLoading,
    reviews,
}: OverviewPageProps): React.ReactElement {
    const [appQuery, setAppQuery] = useState('');
    const [appSortKey, setAppSortKey] = useState<AppSortKey>('objectCount');
    const [appSortDirection, setAppSortDirection] = useState<SortDirection>('desc');
    const [appPageSize, setAppPageSize] = useState(10);
    const [appPage, setAppPage] = useState(0);
    const [selectedAppName, setSelectedAppName] = useState<string | null>(null);
    const objects = snapshot?.objects ?? [];
    const findings = snapshot?.findings ?? [];
    const fullAppComposition = buildAppComposition(objects);
    const normalizedAppQuery = normalizeAppSearch(appQuery.trim());
    const filteredAppComposition = fullAppComposition.filter((app) =>
        normalizeAppSearch(app.app).includes(normalizedAppQuery),
    );
    const sortedAppComposition = sortAppComposition(
        filteredAppComposition,
        appSortKey,
        appSortDirection,
    );
    const appTotalPages = Math.max(1, Math.ceil(sortedAppComposition.length / appPageSize));
    const currentAppPage = Math.min(appPage, appTotalPages - 1);
    const appPageStart = currentAppPage * appPageSize;
    const appComposition = sortedAppComposition.slice(appPageStart, appPageStart + appPageSize);
    const selectedApp = filteredAppComposition.find((app) => app.app === selectedAppName) ?? null;
    const reviewByObject = new Map(reviews.map((review) => [review.objectId, review]));
    const candidateIds = new Set(
        findings
            .filter((finding) => candidateFindingTypes.has(finding.findingType))
            .map((finding) => finding.objectId),
    );
    const findingByObject = new Map(findings.map((finding) => [finding.objectId, finding]));
    const reviewTargets = objects
        .filter(
            (contentObject) =>
                candidateIds.has(contentObject.objectId) ||
                ['dormant', 'orphaned', 'broken', 'unowned'].includes(contentObject.healthStatus),
        )
        .sort(
            (left, right) =>
                (findingByObject.get(right.objectId)?.abandonmentConfidence ??
                    right.abandonmentConfidence ??
                    -1) -
                (findingByObject.get(left.objectId)?.abandonmentConfidence ??
                    left.abandonmentConfidence ??
                    -1),
        )
        .slice(0, 5);
    const protectedCount = objects.filter((contentObject) => contentObject.protected).length;
    const unknownCount = objects.filter(
        (contentObject) => contentObject.healthStatus === 'unknown',
    ).length;
    const ownershipGapCount = objects.filter(
        (contentObject) => contentObject.owner === null && contentObject.sharing === 'user',
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
                                    ]),
                                )
                            }
                            disabled={!snapshot}
                        >
                            Export summary CSV
                        </StyledButton>
                        <StyledButton
                            type="button"
                            onClick={() =>
                                downloadJson('content-hygiene-environment-summary.json', {
                                    exportedAt: new Date().toISOString(),
                                    scan: snapshot?.scan ?? null,
                                    usage: snapshot?.usage ?? null,
                                    summary: {
                                        objectCount: objects.length,
                                        relationshipCount: snapshot?.edges.length ?? 0,
                                        findingCount: findings.length,
                                        ownershipGapCount,
                                        protectedCount,
                                        unknownCount,
                                        reviewLibraryCount: reviews.length,
                                    },
                                    appComposition: fullAppComposition,
                                    reviews,
                                })
                            }
                            disabled={!snapshot}
                        >
                            Export summary JSON
                        </StyledButton>
                        <StyledButton type="button" onClick={() => navigateToView('reviews')}>
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
                    value={snapshot ? numberFormatter.format(snapshot.edges.length) : '—'}
                    hint="Directional dependency edges found by analysis"
                    accent="info"
                />
                <SummaryMetric
                    label="Ownership gaps"
                    value={snapshot ? numberFormatter.format(ownershipGapCount) : '—'}
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
                    label="Usage evidence"
                    value={
                        snapshot?.usage
                            ? `${numberFormatter.format(
                                  snapshot.usage.observedObjectCount,
                              )}/${numberFormatter.format(
                                  snapshot.usage.eligibleObjectCount,
                              )}`
                            : 'Not measured'
                    }
                    hint={
                        snapshot?.usage
                            ? `${snapshot.usage.coverage} ${snapshot.usage.windowDays}-day source window; observed/eligible objects`
                            : 'Collect a bounded usage window from Settings'
                    }
                    accent={snapshot?.usage?.coverage === 'complete' ? 'positive' : 'warning'}
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
                    {fullAppComposition.length === 0 ? (
                        <EmptyState>
                            <div>
                                <strong>
                                    {isLoading
                                        ? 'Loading live inventory…'
                                        : 'No live inventory is cached'}
                                </strong>
                                <p>Run a bounded live scan from Settings to populate this view.</p>
                            </div>
                        </EmptyState>
                    ) : (
                        <CardBody>
                            <CompositionControls
                                aria-label="Live inventory by app controls"
                                onSubmit={(event) => event.preventDefault()}
                            >
                                <CompositionControl>
                                    Find app
                                    <Input
                                        type="search"
                                        value={appQuery}
                                        placeholder="App name"
                                        onChange={(event) => {
                                            setAppQuery(event.currentTarget.value);
                                            setAppPage(0);
                                            setSelectedAppName(null);
                                        }}
                                    />
                                </CompositionControl>
                                <CompositionControl>
                                    Sort by
                                    <Select
                                        value={appSortKey}
                                        onChange={(event) => {
                                            const nextSortKey = event.currentTarget
                                                .value as AppSortKey;
                                            setAppSortKey(nextSortKey);
                                            setAppSortDirection(
                                                nextSortKey === 'app' ? 'asc' : 'desc',
                                            );
                                            setAppPage(0);
                                            setSelectedAppName(null);
                                        }}
                                    >
                                        <option value="objectCount">Object count</option>
                                        <option value="app">App name</option>
                                        <option value="activePercent">Active percent</option>
                                        <option value="reviewPercent">Needs review percent</option>
                                        <option value="concernPercent">Concern percent</option>
                                        <option value="protectedPercent">Protected percent</option>
                                        <option value="unknownPercent">Unknown percent</option>
                                    </Select>
                                </CompositionControl>
                                <CompositionControl>
                                    Rows
                                    <Select
                                        value={appPageSize}
                                        onChange={(event) => {
                                            setAppPageSize(Number(event.currentTarget.value));
                                            setAppPage(0);
                                            setSelectedAppName(null);
                                        }}
                                    >
                                        {appPageSizeOptions.map((pageSize) => (
                                            <option key={pageSize} value={pageSize}>
                                                {pageSize}
                                            </option>
                                        ))}
                                    </Select>
                                </CompositionControl>
                                <StyledButton
                                    type="button"
                                    aria-label={`Sort direction: ${sortDirectionLabel(
                                        appSortKey,
                                        appSortDirection,
                                    )}`}
                                    onClick={() => {
                                        setAppSortDirection((current) =>
                                            current === 'asc' ? 'desc' : 'asc',
                                        );
                                        setAppPage(0);
                                        setSelectedAppName(null);
                                    }}
                                >
                                    {sortDirectionLabel(appSortKey, appSortDirection)}
                                </StyledButton>
                            </CompositionControls>

                            {appComposition.length === 0 ? (
                                <EmptyState>
                                    <div>
                                        <strong>No matching apps</strong>
                                        <p>
                                            Clear or broaden the app-name search to restore live
                                            inventory rows.
                                        </p>
                                    </div>
                                </EmptyState>
                            ) : (
                                <>
                                    {appComposition.map((app) => (
                                        <CompositionRow
                                            key={app.app}
                                            $selected={selectedAppName === app.app}
                                        >
                                            <RowButton
                                                type="button"
                                                title={`View cleanup candidates for ${app.app}`}
                                                onClick={() =>
                                                    navigateToView('candidates', {
                                                        app: app.app,
                                                    })
                                                }
                                            >
                                                {app.app}
                                            </RowButton>
                                            <CompositionBar
                                                type="button"
                                                aria-expanded={selectedAppName === app.app}
                                                aria-label={`Show health breakdown for ${app.app}: ${app.activePercent}% active, ${app.reviewPercent}% needs review, ${app.concernPercent}% concern, ${app.protectedPercent}% protected, ${app.unknownPercent}% unknown`}
                                                onClick={() =>
                                                    setSelectedAppName((current) =>
                                                        current === app.app ? null : app.app,
                                                    )
                                                }
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
                                            <span
                                                aria-label={`${numberFormatter.format(
                                                    app.objectCount,
                                                )} objects`}
                                            >
                                                {numberFormatter.format(app.objectCount)}
                                            </span>
                                        </CompositionRow>
                                    ))}

                                    {selectedApp ? (
                                        <CompositionDetails
                                            aria-label={`Health breakdown for ${selectedApp.app}`}
                                        >
                                            <CompositionDetailsHeader>
                                                <strong>{selectedApp.app}</strong>
                                                <ButtonRow>
                                                    <StyledButton
                                                        type="button"
                                                        onClick={() =>
                                                            navigateToView('candidates', {
                                                                app: selectedApp.app,
                                                            })
                                                        }
                                                    >
                                                        View app candidates
                                                    </StyledButton>
                                                    <StyledButton
                                                        type="button"
                                                        onClick={() => setSelectedAppName(null)}
                                                    >
                                                        Close
                                                    </StyledButton>
                                                </ButtonRow>
                                            </CompositionDetailsHeader>
                                            <CompositionMetricGrid>
                                                <div>
                                                    <dt>Active</dt>
                                                    <dd>
                                                        {selectedApp.activeCount} (
                                                        {selectedApp.activePercent}%)
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt>Needs review</dt>
                                                    <dd>
                                                        {selectedApp.reviewCount} (
                                                        {selectedApp.reviewPercent}%)
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt>Concern</dt>
                                                    <dd>
                                                        {selectedApp.concernCount} (
                                                        {selectedApp.concernPercent}%)
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt>Protected</dt>
                                                    <dd>
                                                        {selectedApp.protectedCount} (
                                                        {selectedApp.protectedPercent}
                                                        %)
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt>Unknown</dt>
                                                    <dd>
                                                        {selectedApp.unknownCount} (
                                                        {selectedApp.unknownPercent}%)
                                                    </dd>
                                                </div>
                                            </CompositionMetricGrid>
                                        </CompositionDetails>
                                    ) : null}

                                    <CompositionPagination aria-label="Live inventory by app pagination">
                                        <CompositionSummary aria-live="polite">
                                            {appPageStart + 1}–
                                            {Math.min(
                                                appPageStart + appPageSize,
                                                sortedAppComposition.length,
                                            )}{' '}
                                            of {sortedAppComposition.length} apps · Page{' '}
                                            {currentAppPage + 1} of {appTotalPages}
                                        </CompositionSummary>
                                        <ButtonRow>
                                            <StyledButton
                                                type="button"
                                                disabled={currentAppPage === 0}
                                                onClick={() => {
                                                    setAppPage(
                                                        Math.max(0, currentAppPage - 1),
                                                    );
                                                    setSelectedAppName(null);
                                                }}
                                            >
                                                Previous
                                            </StyledButton>
                                            <StyledButton
                                                type="button"
                                                disabled={currentAppPage >= appTotalPages - 1}
                                                onClick={() => {
                                                    setAppPage(
                                                        Math.min(
                                                            appTotalPages - 1,
                                                            currentAppPage + 1,
                                                        ),
                                                    );
                                                    setSelectedAppName(null);
                                                }}
                                            >
                                                Next
                                            </StyledButton>
                                        </ButtonRow>
                                    </CompositionPagination>
                                </>
                            )}
                        </CardBody>
                    )}
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Evidence-backed review targets</CardTitle>
                        <StyledButton type="button" onClick={() => navigateToView('candidates')}>
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
                                                        navigateToView('candidates', {
                                                            object: contentObject.objectId,
                                                        })
                                                    }
                                                >
                                                    {contentObject.name}
                                                </RowButton>
                                                <div>{contentObject.app}</div>
                                            </td>
                                            <td>
                                                <StatusBadge status={contentObject.healthStatus} />
                                            </td>
                                            <td>
                                                {findingByObject.get(contentObject.objectId)
                                                    ?.abandonmentConfidence ??
                                                    contentObject.abandonmentConfidence ??
                                                    'Unknown'}
                                            </td>
                                            <td>
                                                {reviewByObject.has(contentObject.objectId) ? (
                                                    <ReviewStageBadge
                                                        stage={
                                                            reviewByObject.get(
                                                                contentObject.objectId,
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
