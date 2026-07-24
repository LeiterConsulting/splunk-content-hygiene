import React, { useState } from 'react';
import {
    ButtonRow,
    Card,
    CardHeader,
    CardTitle,
    DefinitionList,
    DetailLayout,
    DetailPanel,
    DetailSection,
    DetailTitle,
    EmptyState,
    FilterBar,
    FilterField,
    Input,
    MetricGrid,
    ProgressBar,
    ProgressTrack,
    RowButton,
    SpacedBlock,
    StyledButton,
    Table,
    TableScroller,
} from '../AppStyles';
import { PageHeader } from '../components/PageHeader';
import { ReviewStageBadge } from '../components/ReviewStageBadge';
import { StatusBadge } from '../components/StatusBadge';
import { SummaryMetric } from '../components/SummaryMetric';
import { ContentObject, InventorySnapshot, ReviewRecord } from '../types';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { navigateToView } from '../utils/navigation';

const numberFormatter = new Intl.NumberFormat('en-US');

interface OwnershipPageProps {
    snapshot: InventorySnapshot | null;
    isLoading: boolean;
    reviews: ReviewRecord[];
}

function exportOwnershipWorksheet(
    objects: ContentObject[],
    reviewByObject: Map<string, ReviewRecord>
): void {
    downloadCsv(
        'content-hygiene-ownership-review.csv',
        [
            'Object ID',
            'Name',
            'Type',
            'App',
            'Current owner',
            'Sharing',
            'Status',
            'Review stage',
            'Review assignee',
            'Suggested reviewer',
        ],
        objects.map((contentObject) => [
            contentObject.objectId,
            contentObject.name,
            contentObject.objectType,
            contentObject.app,
            contentObject.owner,
            contentObject.sharing,
            contentObject.healthStatus,
            reviewByObject.get(contentObject.objectId)?.stage ?? '',
            reviewByObject.get(contentObject.objectId)?.assignedTo ?? '',
            '',
        ])
    );
}

function objectsForOwner(
    owner: string,
    objects: ContentObject[]
): ContentObject[] {
    if (owner === 'App/global scope') {
        return objects.filter(
            (contentObject) =>
                !contentObject.owner &&
                (contentObject.sharing === 'app' ||
                    contentObject.sharing === 'global')
        );
    }
    if (owner === 'Unowned') {
        return objects.filter(
            (contentObject) =>
                !contentObject.owner && contentObject.sharing === 'user'
        );
    }
    if (owner === 'Ownership metadata unavailable') {
        return objects.filter(
            (contentObject) =>
                !contentObject.owner &&
                contentObject.sharing !== 'app' &&
                contentObject.sharing !== 'global' &&
                contentObject.sharing !== 'user'
        );
    }
    return objects.filter((contentObject) => contentObject.owner === owner);
}

function ownershipEmptyTitle(
    isLoading: boolean,
    ownerCount: number
): string {
    if (isLoading) {
        return 'Loading live ownership data…';
    }
    return ownerCount === 0
        ? 'No live ownership data is cached'
        : 'No owners match the current search';
}

function ownerInterpretation(
    owner: string,
    status: 'active' | 'disabled' | 'missing' | 'shared' | 'unknown'
): string {
    if (status === 'shared') {
        return 'These objects are owned by their app or shared globally in Splunk. They are not treated as missing-owner findings.';
    }
    if (owner === 'Unowned') {
        return 'These user-scoped objects have no named individual in their cached ACL metadata. Export the worksheet to assign reviewers.';
    }
    if (status === 'unknown') {
        return 'Splunk did not expose owner or sharing metadata for these objects. They are disclosed separately and are not asserted as ownership gaps.';
    }
    if (status === 'active') {
        return 'This account is active. Object health remains unknown until live analysis produces evidence.';
    }
    return 'This account is disabled or absent from the collected user records. Assign an administrative reviewer.';
}

export function OwnershipPage({
    snapshot,
    isLoading,
    reviews,
}: OwnershipPageProps): React.ReactElement {
    const [query, setQuery] = useState('');
    const [selectedOwner, setSelectedOwner] = useState('');
    const objects = snapshot?.objects ?? [];
    const reviewByObject = new Map(
        reviews.map((review) => [review.objectId, review])
    );
    const ownerSummaries = snapshot?.owners ?? [];
    const unownedObjects = objects.filter(
        (contentObject) =>
            contentObject.owner === null &&
            contentObject.sharing === 'user'
    );
    const sharedScopeObjects = objects.filter(
        (contentObject) =>
            contentObject.owner === null &&
            (contentObject.sharing === 'app' ||
                contentObject.sharing === 'global')
    );
    const unknownScopeObjects = objects.filter(
        (contentObject) =>
            contentObject.owner === null &&
            contentObject.sharing !== 'user' &&
            contentObject.sharing !== 'app' &&
            contentObject.sharing !== 'global'
    );
    const accountableObjects = objects.filter(
        (contentObject) =>
            Boolean(contentObject.owner) ||
            contentObject.sharing === 'app' ||
            contentObject.sharing === 'global'
    ).length;
    const coverage =
        objects.length === 0
            ? 0
            : Math.round((accountableObjects / objects.length) * 1000) / 10;
    const activeOwnersWithContent = ownerSummaries.filter(
        (summary) => summary.status === 'active' && summary.objectCount > 0
    ).length;
    const disabledOwnerObjects = ownerSummaries
        .filter((summary) => summary.status === 'disabled')
        .reduce((total, summary) => total + summary.objectCount, 0);
    const normalizedQuery = query.trim().toLowerCase();
    const filteredOwners = ownerSummaries.filter((summary) =>
        summary.owner.toLowerCase().includes(normalizedQuery)
    );
    const selected =
        ownerSummaries.find((summary) => summary.owner === selectedOwner) ??
        filteredOwners[0];
    const selectedObjects = selected
        ? objectsForOwner(selected.owner, objects)
        : [];

    return (
        <>
            <PageHeader
                title="Ownership"
                subtitle="Inspect live ACL ownership metadata and prepare a worksheet without changing Splunk objects."
                actions={
                    <ButtonRow>
                        <StyledButton
                            type="button"
                            onClick={() =>
                                exportOwnershipWorksheet(
                                    selectedObjects.length > 0
                                        ? selectedObjects
                                        : objects,
                                    reviewByObject
                                )
                            }
                            disabled={objects.length === 0}
                        >
                            Export selected ownership CSV
                        </StyledButton>
                        <StyledButton
                            type="button"
                            onClick={() =>
                                downloadJson(
                                    'content-hygiene-ownership-report.json',
                                    {
                                        exportedAt: new Date().toISOString(),
                                        scanId: snapshot?.scan.scanId ?? null,
                                        owners: ownerSummaries,
                                        objects: objects.map((contentObject) => ({
                                            ...contentObject,
                                            review:
                                                reviewByObject.get(
                                                    contentObject.objectId
                                                ) ?? null,
                                        })),
                                    }
                                )
                            }
                            disabled={objects.length === 0}
                        >
                            Export full ownership JSON
                        </StyledButton>
                    </ButtonRow>
                }
            />

            <MetricGrid aria-label="Ownership summary">
                <SummaryMetric
                    label="Active named owners"
                    value={
                        snapshot
                            ? numberFormatter.format(activeOwnersWithContent)
                            : '—'
                    }
                    hint="Active accounts attached to cached objects"
                    accent="positive"
                />
                <SummaryMetric
                    label="Ownership gaps"
                    value={
                        snapshot
                            ? numberFormatter.format(unownedObjects.length)
                            : '—'
                    }
                    hint="User-scoped objects without a resolvable owner"
                    accent="negative"
                />
                <SummaryMetric
                    label="Disabled-owner objects"
                    value={
                        snapshot
                            ? numberFormatter.format(disabledOwnerObjects)
                            : '—'
                    }
                    hint="Cached objects attached to a disabled account"
                    accent="warning"
                />
                <SummaryMetric
                    label="App/global scope"
                    value={
                        snapshot
                            ? numberFormatter.format(sharedScopeObjects.length)
                            : '—'
                    }
                    hint="Objects intentionally owned by an app or global scope"
                    accent="warning"
                />
                <SummaryMetric
                    label="Ownership coverage"
                    value={snapshot ? `${coverage}%` : '—'}
                    hint="Objects with a named owner or explicit shared scope"
                    accent="info"
                />
                <SummaryMetric
                    label="Ownership metadata unavailable"
                    value={
                        snapshot
                            ? numberFormatter.format(unknownScopeObjects.length)
                            : '—'
                    }
                    hint="Objects not asserted as gaps because ACL scope was not exposed"
                    accent="info"
                />
            </MetricGrid>

            <FilterBar
                aria-label="Ownership filters"
                onSubmit={(event) => event.preventDefault()}
            >
                <FilterField>
                    Search owners
                    <Input
                        type="search"
                        value={query}
                        placeholder="Owner name"
                        onChange={(event) => setQuery(event.currentTarget.value)}
                    />
                </FilterField>
                <StyledButton type="button" onClick={() => setQuery('')}>
                    Clear filter
                </StyledButton>
            </FilterBar>

            <DetailLayout>
                <div>
                    <Card>
                        <CardHeader>
                            <CardTitle>Live ownership inventory</CardTitle>
                        </CardHeader>
                        {filteredOwners.length === 0 ? (
                            <EmptyState>
                                <div>
                                    <strong>
                                        {ownershipEmptyTitle(
                                            isLoading,
                                            ownerSummaries.length
                                        )}
                                    </strong>
                                    <p>
                                        {ownerSummaries.length === 0
                                            ? 'Run a bounded live scan from Settings to collect owner metadata.'
                                            : 'Clear the search to show all cached owners.'}
                                    </p>
                                </div>
                            </EmptyState>
                        ) : (
                            <TableScroller>
                                <Table>
                                    <thead>
                                        <tr>
                                            <th scope="col">Owner</th>
                                            <th scope="col">Account status</th>
                                            <th scope="col">Objects</th>
                                            <th scope="col">Needs review</th>
                                            <th scope="col">Known-active share</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredOwners.map((summary) => {
                                            const activePercent =
                                                summary.objectCount === 0
                                                    ? 0
                                                    : Math.round(
                                                          (summary.activeCount /
                                                              summary.objectCount) *
                                                              100
                                                      );
                                            return (
                                                <tr key={summary.owner}>
                                                    <td>
                                                        <RowButton
                                                            type="button"
                                                            aria-pressed={
                                                                selected?.owner ===
                                                                summary.owner
                                                            }
                                                            onClick={() =>
                                                                setSelectedOwner(
                                                                    summary.owner
                                                                )
                                                            }
                                                        >
                                                            {summary.owner}
                                                        </RowButton>
                                                    </td>
                                                    <td>{summary.status}</td>
                                                    <td>
                                                        {numberFormatter.format(
                                                            summary.objectCount
                                                        )}
                                                    </td>
                                                    <td>
                                                        {numberFormatter.format(
                                                            summary.reviewCount
                                                        )}
                                                    </td>
                                                    <td>
                                                        <ProgressTrack
                                                            aria-label={`${activePercent}% known active`}
                                                        >
                                                            <ProgressBar
                                                                $percent={
                                                                    activePercent
                                                                }
                                                            />
                                                        </ProgressTrack>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </Table>
                            </TableScroller>
                        )}
                    </Card>

                    <SpacedBlock>
                        <Card>
                            <CardHeader>
                                <CardTitle>
                                    User-scoped ownership gaps
                                </CardTitle>
                            </CardHeader>
                            {unownedObjects.length === 0 ? (
                                <EmptyState>
                                    No cached user-scoped objects have an
                                    ownership gap.
                                </EmptyState>
                            ) : (
                                <TableScroller>
                                    <Table>
                                        <thead>
                                            <tr>
                                                <th scope="col">Object</th>
                                                <th scope="col">App</th>
                                                <th scope="col">Type</th>
                                                <th scope="col">Status</th>
                                                <th scope="col">Review</th>
                                                <th scope="col">Investigate</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {unownedObjects
                                                .slice(0, 25)
                                                .map((contentObject) => (
                                                    <tr
                                                        key={
                                                            contentObject.objectId
                                                        }
                                                    >
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
                                                                {
                                                                    contentObject.name
                                                                }
                                                            </RowButton>
                                                        </td>
                                                        <td>
                                                            {contentObject.app}
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
                                                        <td>
                                                            <StyledButton
                                                                type="button"
                                                                onClick={() =>
                                                                    navigateToView(
                                                                        'dependencies',
                                                                        {
                                                                            object: contentObject.objectId,
                                                                        }
                                                                    )
                                                                }
                                                            >
                                                                Dependencies
                                                            </StyledButton>
                                                        </td>
                                                        <td>
                                                            {
                                                                contentObject.objectType
                                                            }
                                                        </td>
                                                        <td>
                                                            <StatusBadge
                                                                status={
                                                                    contentObject.healthStatus
                                                                }
                                                            />
                                                        </td>
                                                    </tr>
                                                ))}
                                        </tbody>
                                    </Table>
                                </TableScroller>
                            )}
                        </Card>
                    </SpacedBlock>
                </div>

                {selected ? (
                    <DetailPanel
                        aria-label={`Ownership details for ${selected.owner}`}
                    >
                        <DetailSection>
                            <DetailTitle>{selected.owner}</DetailTitle>
                            <strong>Account status: {selected.status}</strong>
                        </DetailSection>
                        <DetailSection>
                            <DefinitionList>
                                <dt>Total objects</dt>
                                <dd>
                                    {numberFormatter.format(
                                        selected.objectCount
                                    )}
                                </dd>
                                <dt>Known active</dt>
                                <dd>
                                    {numberFormatter.format(
                                        selected.activeCount
                                    )}
                                </dd>
                                <dt>Needs review</dt>
                                <dd>
                                    {numberFormatter.format(
                                        selected.reviewCount
                                    )}
                                </dd>
                                <dt>Without named owner</dt>
                                <dd>
                                    {numberFormatter.format(
                                        selected.unownedCount
                                    )}
                                </dd>
                            </DefinitionList>
                        </DetailSection>
                        <DetailSection>
                            <strong>Interpretation</strong>
                            <p>
                                {ownerInterpretation(
                                    selected.owner,
                                    selected.status
                                )}
                            </p>
                        </DetailSection>
                        <DetailSection>
                            <strong>
                                Objects attributed to this owner (
                                {numberFormatter.format(selectedObjects.length)})
                            </strong>
                            {selectedObjects.length === 0 ? (
                                <p>No cached objects are attributed here.</p>
                            ) : (
                                <TableScroller>
                                    <Table>
                                        <thead>
                                            <tr>
                                                <th scope="col">Object</th>
                                                <th scope="col">Status</th>
                                                <th scope="col">Review</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {selectedObjects
                                                .slice(0, 50)
                                                .map((contentObject) => (
                                                    <tr
                                                        key={
                                                            contentObject.objectId
                                                        }
                                                    >
                                                        <td>
                                                            <RowButton
                                                                type="button"
                                                                onClick={() =>
                                                                    navigateToView(
                                                                        'dependencies',
                                                                        {
                                                                            object: contentObject.objectId,
                                                                        }
                                                                    )
                                                                }
                                                            >
                                                                {
                                                                    contentObject.name
                                                                }
                                                            </RowButton>
                                                        </td>
                                                        <td>
                                                            <StatusBadge
                                                                status={
                                                                    contentObject.healthStatus
                                                                }
                                                            />
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
                            {selectedObjects.length > 50 ? (
                                <p>
                                    Export the selected ownership CSV for all{' '}
                                    {numberFormatter.format(
                                        selectedObjects.length
                                    )}{' '}
                                    objects.
                                </p>
                            ) : null}
                        </DetailSection>
                    </DetailPanel>
                ) : null}
            </DetailLayout>
        </>
    );
}
