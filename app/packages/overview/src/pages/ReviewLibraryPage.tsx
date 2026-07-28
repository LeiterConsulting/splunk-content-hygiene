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
    InlineNotice,
    Input,
    MetricGrid,
    RowButton,
    Select,
    StyledButton,
    Table,
    TableScroller,
} from '../AppStyles';
import { PageHeader } from '../components/PageHeader';
import { ReviewEditor } from '../components/ReviewEditor';
import { ReviewStageBadge } from '../components/ReviewStageBadge';
import { StatusBadge } from '../components/StatusBadge';
import { SummaryMetric } from '../components/SummaryMetric';
import { UsageEvidencePanel } from '../components/UsageEvidencePanel';
import { reviewStageOptions } from '../services/reviews';
import {
    ContentObject,
    InventorySnapshot,
    ReviewInput,
    ReviewRecord,
} from '../types';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { navigateToView, readQueryParam } from '../utils/navigation';

const PAGE_SIZE = 50;

interface ReviewLibraryPageProps {
    snapshot: InventorySnapshot | null;
    reviews: ReviewRecord[];
    isLoading: boolean;
    loadError: string | null;
    canWriteReviews: boolean;
    onSaveReview: (input: ReviewInput) => Promise<ReviewRecord>;
    onDeleteReview: (objectId: string) => Promise<void>;
}

function lastObservedObject(review: ReviewRecord): ContentObject {
    return {
        objectId: review.objectId,
        canonicalName: review.canonicalName,
        name: review.objectName,
        objectType: review.objectType,
        app: review.app,
        owner: review.owner,
        sharing: null,
        enabled: null,
        scheduled: null,
        updated: null,
        lastUsed: null,
        usageEvidence: null,
        healthStatus: review.healthStatusAtReview,
        abandonmentConfidence: null,
        removalImpact: null,
        inboundReferences: 0,
        outboundReferences: 0,
        protected: false,
        evidence: [
            'This object is not present in the latest cached inventory. The review record retains its last observed identity.',
        ],
        suggestedAction: 'Confirm whether the object was removed, renamed, or is outside current scan visibility.',
    };
}

function formatDateTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? value
        : new Intl.DateTimeFormat('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
          }).format(date);
}

function exportReviews(
    rows: ReviewRecord[],
    objectById: Map<string, ContentObject>
): void {
    downloadCsv(
        'content-hygiene-review-library.csv',
        [
            'Object ID',
            'Name',
            'Type',
            'App',
            'Owner',
            'Stage',
            'Assigned to',
            'Note',
            'Current inventory status',
            'Health at review',
            'Current usage coverage',
            'Current usage observations',
            'Current last observed',
            'Usage coverage at review',
            'Usage observations at review',
            'Usage last observed at review',
            'Usage run at review',
            'Scan ID',
            'Created at',
            'Updated at',
            'Updated by',
        ],
        rows.map((review) => [
            review.objectId,
            review.objectName,
            review.objectType,
            review.app,
            review.owner,
            review.stage,
            review.assignedTo,
            review.note,
            objectById.has(review.objectId) ? 'present' : 'not present',
            review.healthStatusAtReview,
            objectById.get(review.objectId)?.usageEvidence?.coverage ??
                'not measured',
            objectById.get(review.objectId)?.usageEvidence?.observationCount ??
                '',
            objectById.get(review.objectId)?.lastUsed ?? '',
            review.usageCoverageAtReview ?? 'not measured',
            review.usageObservationCountAtReview ?? '',
            review.usageLastObservedAtReview ?? '',
            review.usageRunIdAtReview ?? '',
            review.scanId,
            review.createdAt,
            review.updatedAt,
            review.updatedBy,
        ])
    );
}

export function ReviewLibraryPage({
    snapshot,
    reviews,
    isLoading,
    loadError,
    canWriteReviews,
    onSaveReview,
    onDeleteReview,
}: ReviewLibraryPageProps): React.ReactElement {
    const [query, setQuery] = useState(readQueryParam('query'));
    const [stageFilter, setStageFilter] = useState(
        readQueryParam('stage') || 'all'
    );
    const [appFilter, setAppFilter] = useState('all');
    const [typeFilter, setTypeFilter] = useState('all');
    const [presenceFilter, setPresenceFilter] = useState('all');
    const [selectedId, setSelectedId] = useState(readQueryParam('object'));
    const [page, setPage] = useState(0);
    const objects = snapshot?.objects ?? [];
    const objectById = new Map(
        objects.map((contentObject) => [contentObject.objectId, contentObject])
    );
    const apps = Array.from(new Set(reviews.map((review) => review.app))).sort();
    const objectTypes = Array.from(
        new Set(reviews.map((review) => review.objectType))
    ).sort();
    const normalizedQuery = query.trim().toLowerCase();
    const filteredReviews = reviews
        .filter((review) => {
            const isPresent = objectById.has(review.objectId);
            return (
                (stageFilter === 'all' || review.stage === stageFilter) &&
                (appFilter === 'all' || review.app === appFilter) &&
                (typeFilter === 'all' ||
                    review.objectType === typeFilter) &&
                (presenceFilter === 'all' ||
                    (presenceFilter === 'present' && isPresent) ||
                    (presenceFilter === 'missing' && !isPresent)) &&
                (!normalizedQuery ||
                    [
                        review.objectName,
                        review.canonicalName,
                        review.app,
                        review.objectType,
                        review.owner ?? '',
                        review.assignedTo ?? '',
                        review.note,
                    ].some((value) =>
                        value.toLowerCase().includes(normalizedQuery)
                    ))
            );
        })
        .sort(
            (left, right) =>
                right.updatedAt.localeCompare(left.updatedAt) ||
                left.objectName.localeCompare(right.objectName)
        );
    const totalPages = Math.max(1, Math.ceil(filteredReviews.length / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages - 1);
    const pageStart = currentPage * PAGE_SIZE;
    const pageReviews = filteredReviews.slice(pageStart, pageStart + PAGE_SIZE);
    const selectedReview =
        filteredReviews.find((review) => review.objectId === selectedId) ??
        pageReviews[0] ??
        null;
    const selectedObject = selectedReview
        ? objectById.get(selectedReview.objectId) ??
          lastObservedObject(selectedReview)
        : null;
    const stageCount = (stage: ReviewRecord['stage']): number =>
        reviews.filter((review) => review.stage === stage).length;

    return (
        <>
            <PageHeader
                title="Review Library"
                subtitle="Build a durable, app-local investigation queue without modifying any Splunk knowledge object."
                actions={
                    <ButtonRow>
                        <StyledButton
                            type="button"
                            onClick={() =>
                                exportReviews(filteredReviews, objectById)
                            }
                            disabled={filteredReviews.length === 0}
                        >
                            Export filtered CSV
                        </StyledButton>
                        <StyledButton
                            type="button"
                            onClick={() =>
                                downloadJson(
                                    'content-hygiene-review-library.json',
                                    {
                                        exportedAt: new Date().toISOString(),
                                        scanId: snapshot?.scan.scanId ?? null,
                                        reviews: filteredReviews.map((review) => ({
                                            ...review,
                                            currentObject:
                                                objectById.get(review.objectId) ??
                                                null,
                                        })),
                                    }
                                )
                            }
                            disabled={filteredReviews.length === 0}
                        >
                            Export filtered JSON
                        </StyledButton>
                        <StyledButton
                            type="button"
                            $primary
                            onClick={() => navigateToView('candidates')}
                        >
                            Find candidates
                        </StyledButton>
                    </ButtonRow>
                }
            />

            <MetricGrid aria-label="Review workflow summary">
                <SummaryMetric
                    label="Library records"
                    value={reviews.length.toLocaleString()}
                    hint="Persist across live inventory scans"
                    accent="info"
                />
                <SummaryMetric
                    label="Investigating"
                    value={stageCount('investigating').toLocaleString()}
                    hint="Evidence collection in progress"
                    accent="warning"
                />
                <SummaryMetric
                    label="Awaiting owner"
                    value={stageCount('awaiting_owner').toLocaleString()}
                    hint="Needs content-owner confirmation"
                    accent="warning"
                />
                <SummaryMetric
                    label="Confirmed eligible"
                    value={stageCount('confirmed_eligible').toLocaleString()}
                    hint="Positively identified for a later cleanup process"
                    accent="positive"
                />
                <SummaryMetric
                    label="Retain / blocked"
                    value={(
                        stageCount('retain') + stageCount('blocked')
                    ).toLocaleString()}
                    hint="Excluded or prevented from cleanup"
                    accent="neutral"
                />
            </MetricGrid>

            {loadError ? (
                <InlineNotice role="alert">{loadError}</InlineNotice>
            ) : null}

            <FilterBar
                aria-label="Review library filters"
                onSubmit={(event) => event.preventDefault()}
            >
                <FilterField>
                    Search
                    <Input
                        type="search"
                        value={query}
                        placeholder="Object, app, owner, note"
                        onChange={(event) => {
                            setQuery(event.currentTarget.value);
                            setPage(0);
                        }}
                    />
                </FilterField>
                <FilterField>
                    Confirmation stage
                    <Select
                        value={stageFilter}
                        onChange={(event) => {
                            setStageFilter(event.currentTarget.value);
                            setPage(0);
                        }}
                    >
                        <option value="all">All stages</option>
                        {reviewStageOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </Select>
                </FilterField>
                <FilterField>
                    App
                    <Select
                        value={appFilter}
                        onChange={(event) => {
                            setAppFilter(event.currentTarget.value);
                            setPage(0);
                        }}
                    >
                        <option value="all">All apps</option>
                        {apps.map((app) => (
                            <option key={app} value={app}>
                                {app}
                            </option>
                        ))}
                    </Select>
                </FilterField>
                <FilterField>
                    Object type
                    <Select
                        value={typeFilter}
                        onChange={(event) => {
                            setTypeFilter(event.currentTarget.value);
                            setPage(0);
                        }}
                    >
                        <option value="all">All types</option>
                        {objectTypes.map((objectType) => (
                            <option key={objectType} value={objectType}>
                                {objectType}
                            </option>
                        ))}
                    </Select>
                </FilterField>
                <FilterField>
                    Current inventory
                    <Select
                        value={presenceFilter}
                        onChange={(event) => {
                            setPresenceFilter(event.currentTarget.value);
                            setPage(0);
                        }}
                    >
                        <option value="all">Present and not present</option>
                        <option value="present">Present in latest scan</option>
                        <option value="missing">Not present in latest scan</option>
                    </Select>
                </FilterField>
                <StyledButton
                    type="button"
                    onClick={() => {
                        setQuery('');
                        setStageFilter('all');
                        setAppFilter('all');
                        setTypeFilter('all');
                        setPresenceFilter('all');
                        setPage(0);
                    }}
                >
                    Clear filters
                </StyledButton>
            </FilterBar>

            <DetailLayout>
                <Card>
                    <CardHeader>
                        <CardTitle>
                            {filteredReviews.length} review record
                            {filteredReviews.length === 1 ? '' : 's'}
                        </CardTitle>
                        {filteredReviews.length > 0 ? (
                            <ButtonRow>
                                <span>
                                    {pageStart + 1}–
                                    {Math.min(
                                        pageStart + PAGE_SIZE,
                                        filteredReviews.length
                                    )}{' '}
                                    of {filteredReviews.length}
                                </span>
                                <StyledButton
                                    type="button"
                                    disabled={currentPage === 0}
                                    onClick={() =>
                                        setPage(Math.max(0, currentPage - 1))
                                    }
                                >
                                    Previous
                                </StyledButton>
                                <StyledButton
                                    type="button"
                                    disabled={currentPage >= totalPages - 1}
                                    onClick={() =>
                                        setPage(
                                            Math.min(
                                                totalPages - 1,
                                                currentPage + 1
                                            )
                                        )
                                    }
                                >
                                    Next
                                </StyledButton>
                            </ButtonRow>
                        ) : null}
                    </CardHeader>
                    {filteredReviews.length === 0 ? (
                        <EmptyState>
                            <div>
                                <strong>
                                    {isLoading
                                        ? 'Loading the review library…'
                                        : 'No matching review records'}
                                </strong>
                                <p>
                                    Add a candidate or dependency object to the
                                    library, or clear the filters.
                                </p>
                            </div>
                        </EmptyState>
                    ) : (
                        <TableScroller>
                            <Table>
                                <thead>
                                    <tr>
                                        <th scope="col">Object</th>
                                        <th scope="col">Type</th>
                                        <th scope="col">Stage</th>
                                        <th scope="col">Assigned to</th>
                                        <th scope="col">Current health</th>
                                        <th scope="col">Updated</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageReviews.map((review) => {
                                        const currentObject = objectById.get(
                                            review.objectId
                                        );
                                        return (
                                            <tr key={review.objectId}>
                                                <td>
                                                    <RowButton
                                                        type="button"
                                                        aria-pressed={
                                                            selectedReview?.objectId ===
                                                            review.objectId
                                                        }
                                                        onClick={() =>
                                                            setSelectedId(
                                                                review.objectId
                                                            )
                                                        }
                                                    >
                                                        {review.objectName}
                                                    </RowButton>
                                                    <div>{review.app}</div>
                                                </td>
                                                <td>{review.objectType}</td>
                                                <td>
                                                    <ReviewStageBadge
                                                        stage={review.stage}
                                                    />
                                                </td>
                                                <td>
                                                    {review.assignedTo ??
                                                        'Unassigned'}
                                                </td>
                                                <td>
                                                    {currentObject ? (
                                                        <StatusBadge
                                                            status={
                                                                currentObject.healthStatus
                                                            }
                                                        />
                                                    ) : (
                                                        'Not present'
                                                    )}
                                                </td>
                                                <td>
                                                    {formatDateTime(
                                                        review.updatedAt
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </Table>
                        </TableScroller>
                    )}
                </Card>

                {selectedReview && selectedObject ? (
                    <DetailPanel
                        aria-label={`Review details for ${selectedReview.objectName}`}
                    >
                        <DetailSection>
                            <DetailTitle>
                                {selectedReview.objectName}
                            </DetailTitle>
                            <ButtonRow>
                                <ReviewStageBadge stage={selectedReview.stage} />
                                <StatusBadge
                                    status={selectedObject.healthStatus}
                                />
                            </ButtonRow>
                        </DetailSection>
                        <DetailSection>
                            <DefinitionList>
                                <dt>Type</dt>
                                <dd>{selectedReview.objectType}</dd>
                                <dt>App</dt>
                                <dd>{selectedReview.app}</dd>
                                <dt>Owner</dt>
                                <dd>{selectedReview.owner ?? 'Unknown'}</dd>
                                <dt>Current scan</dt>
                                <dd>
                                    {objectById.has(selectedReview.objectId)
                                        ? 'Present'
                                        : 'Not present'}
                                </dd>
                                <dt>Inbound refs</dt>
                                <dd>{selectedObject.inboundReferences}</dd>
                                <dt>Outbound refs</dt>
                                <dd>{selectedObject.outboundReferences}</dd>
                                <dt>Usage coverage at review</dt>
                                <dd>
                                    {selectedReview.usageCoverageAtReview ??
                                        'Not measured'}
                                </dd>
                                <dt>Observations at review</dt>
                                <dd>
                                    {selectedReview.usageObservationCountAtReview ??
                                        'Not measured'}
                                </dd>
                                <dt>Last observed at review</dt>
                                <dd>
                                    {selectedReview.usageLastObservedAtReview
                                        ? formatDateTime(
                                              selectedReview.usageLastObservedAtReview
                                          )
                                        : 'Not observed'}
                                </dd>
                                <dt>Last updated by</dt>
                                <dd>{selectedReview.updatedBy}</dd>
                                <dt>Last updated</dt>
                                <dd>
                                    {formatDateTime(selectedReview.updatedAt)}
                                </dd>
                            </DefinitionList>
                        </DetailSection>
                        {!objectById.has(selectedReview.objectId) ? (
                            <DetailSection>
                                <InlineNotice>
                                    This record remains in the library even
                                    though the object is not visible in the
                                    latest cached scan.
                                </InlineNotice>
                            </DetailSection>
                        ) : null}
                        <DetailSection>
                            <UsageEvidencePanel
                                contentObject={selectedObject}
                            />
                        </DetailSection>
                        <DetailSection>
                            <ButtonRow>
                                <StyledButton
                                    type="button"
                                    onClick={() =>
                                        navigateToView('dependencies', {
                                            object: selectedReview.objectId,
                                        })
                                    }
                                    disabled={
                                        !objectById.has(selectedReview.objectId)
                                    }
                                >
                                    Explore dependencies
                                </StyledButton>
                                <StyledButton
                                    type="button"
                                    onClick={() =>
                                        navigateToView('candidates', {
                                            object: selectedReview.objectId,
                                        })
                                    }
                                    disabled={
                                        !objectById.has(selectedReview.objectId)
                                    }
                                >
                                    View candidate evidence
                                </StyledButton>
                            </ButtonRow>
                        </DetailSection>
                        <DetailSection>
                            <ReviewEditor
                                contentObject={selectedObject}
                                review={selectedReview}
                                scanId={
                                    snapshot?.scan.scanId ??
                                    selectedReview.scanId
                                }
                                canWrite={canWriteReviews}
                                onSave={onSaveReview}
                                onDelete={onDeleteReview}
                            />
                        </DetailSection>
                    </DetailPanel>
                ) : null}
            </DetailLayout>
        </>
    );
}
