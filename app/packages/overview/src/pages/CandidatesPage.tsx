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
    EvidenceList,
    FilterBar,
    FilterField,
    Input,
    RowButton,
    Score,
    Select,
    StyledButton,
    Table,
    TableScroller,
} from '../AppStyles';
import { PageHeader } from '../components/PageHeader';
import { ReviewEditor } from '../components/ReviewEditor';
import { ReviewStageBadge } from '../components/ReviewStageBadge';
import { StatusBadge } from '../components/StatusBadge';
import { UsageEvidencePanel } from '../components/UsageEvidencePanel';
import { reviewStageOptions } from '../services/reviews';
import { usageEvidenceState } from '../services/usage';
import {
    ContentFinding,
    ContentObject,
    HealthStatus,
    InventorySnapshot,
    ReviewInput,
    ReviewRecord,
} from '../types';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { navigateToView, readQueryParam } from '../utils/navigation';

const analyzedCandidateStatuses: HealthStatus[] = [
    'dormant',
    'orphaned',
    'broken',
    'unowned',
];
const candidateFindingTypes = new Set([
    'cleanup_candidate',
    'broken_reference',
    'unowned',
    'needs_review',
    'repair_required',
]);
const PAGE_SIZE = 50;

interface CandidatesPageProps {
    snapshot: InventorySnapshot | null;
    isLoading: boolean;
    reviews: ReviewRecord[];
    canWriteReviews: boolean;
    onSaveReview: (input: ReviewInput) => Promise<ReviewRecord>;
    onDeleteReview: (objectId: string) => Promise<void>;
}

function formatDate(value: string | null): string {
    if (!value) {
        return 'Unknown';
    }
    return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    }).format(new Date(value));
}

function formatScore(value: number | null | undefined): string {
    return value === null || value === undefined ? 'Unknown' : `${value}/100`;
}

function formatBoolean(
    value: boolean | null,
    nullLabel = 'Unknown'
): string {
    if (value === null) {
        return nullLabel;
    }
    return value ? 'Yes' : 'No';
}

function ownerLabel(contentObject: ContentObject): string {
    if (contentObject.owner) {
        return contentObject.owner;
    }
    if (
        contentObject.sharing === 'app' ||
        contentObject.sharing === 'global'
    ) {
        return `${contentObject.sharing} scope`;
    }
    return contentObject.sharing === 'user'
        ? 'Ownership gap'
        : 'Owner metadata unavailable';
}

function firstFinding(
    findingsByObject: Map<string, ContentFinding[]>,
    objectId: string
): ContentFinding | undefined {
    return findingsByObject.get(objectId)?.[0];
}

function findingReasons(findings: ContentFinding[]): string[] {
    return findings.reduce<string[]>(
        (reasons, finding) => reasons.concat(finding.reasons),
        []
    );
}

function noCandidatesMessage(
    snapshot: InventorySnapshot | null,
    isLoading: boolean,
    candidateCount: number
): string {
    if (!snapshot) {
        return isLoading
            ? 'Loading live inventory…'
            : 'No live inventory is cached. Run a bounded live scan from Settings.';
    }
    if (candidateCount > 0) {
        return 'Clear one or more filters to broaden the review.';
    }
    return snapshot.scan.analysisStatus === 'pending'
        ? 'No live cleanup findings are cached. Usage and dependency analysis is still pending.'
        : 'The latest live analysis did not produce cleanup candidates.';
}

function exportCandidates(
    rows: ContentObject[],
    findingsByObject: Map<string, ContentFinding[]>,
    reviewByObject: Map<string, ReviewRecord>
): void {
    const header = [
        'Object ID',
        'Name',
        'Type',
        'App',
        'Owner',
        'Sharing',
        'Enabled',
        'Scheduled',
        'Status',
        'Finding types',
        'Abandonment confidence',
        'Removal impact',
        'Last used',
        'Usage coverage',
        'Usage source',
        'Usage window days',
        'Usage observations',
        'Successful executions',
        'Failed executions',
        'Skipped executions',
        'Evidence',
        'Review stage',
        'Assigned to',
        'Review note',
        'Review updated',
    ];
    downloadCsv(
        'content-hygiene-candidates.csv',
        header,
        rows.map((contentObject) => {
            const findings = findingsByObject.get(contentObject.objectId) ?? [];
            const primaryFinding = findings[0];
            const reasons =
                findings.length > 0
                    ? findingReasons(findings)
                    : contentObject.evidence;
            const review = reviewByObject.get(contentObject.objectId);
            return [
                contentObject.objectId,
                contentObject.name,
                contentObject.objectType,
                contentObject.app,
                contentObject.owner,
                contentObject.sharing,
                contentObject.enabled,
                contentObject.scheduled,
                contentObject.healthStatus,
                findings.map((finding) => finding.findingType).join(' | '),
                primaryFinding?.abandonmentConfidence ??
                    contentObject.abandonmentConfidence,
                primaryFinding?.removalImpact ?? contentObject.removalImpact,
                contentObject.lastUsed,
                contentObject.usageEvidence?.coverage ?? 'not measured',
                contentObject.usageEvidence?.sourceLabel ?? '',
                contentObject.usageEvidence?.windowDays ?? '',
                contentObject.usageEvidence?.observationCount ?? '',
                contentObject.usageEvidence?.successfulCount ?? '',
                contentObject.usageEvidence?.failedCount ?? '',
                contentObject.usageEvidence?.skippedCount ?? '',
                reasons.join(' | '),
                review?.stage ?? '',
                review?.assignedTo ?? '',
                review?.note ?? '',
                review?.updatedAt ?? '',
            ];
        })
    );
}

function exportCandidatesJson(
    rows: ContentObject[],
    findingsByObject: Map<string, ContentFinding[]>,
    reviewByObject: Map<string, ReviewRecord>,
    scanId: string | null
): void {
    downloadJson(
        'content-hygiene-candidates.json',
        {
            scanId,
            exportedAt: new Date().toISOString(),
            candidates: rows.map((contentObject) => ({
                object: contentObject,
                findings: findingsByObject.get(contentObject.objectId) ?? [],
                review: reviewByObject.get(contentObject.objectId) ?? null,
            })),
        }
    );
}

export function CandidatesPage({
    snapshot,
    isLoading,
    reviews,
    canWriteReviews,
    onSaveReview,
    onDeleteReview,
}: CandidatesPageProps): React.ReactElement {
    const [statusFilter, setStatusFilter] = useState(
        readQueryParam('status') || 'all'
    );
    const [typeFilter, setTypeFilter] = useState('all');
    const [appFilter, setAppFilter] = useState(
        readQueryParam('app') || 'all'
    );
    const [reviewFilter, setReviewFilter] = useState(
        readQueryParam('review') || 'all'
    );
    const [usageFilter, setUsageFilter] = useState('all');
    const [sortOrder, setSortOrder] = useState('confidence');
    const [query, setQuery] = useState(readQueryParam('query'));
    const [selectedId, setSelectedId] = useState(readQueryParam('object'));
    const [page, setPage] = useState(0);
    const findingsByObject = new Map<string, ContentFinding[]>();
    const reviewByObject = new Map(
        reviews.map((review) => [review.objectId, review])
    );

    (snapshot?.findings ?? []).forEach((finding) => {
        const existing = findingsByObject.get(finding.objectId) ?? [];
        if (candidateFindingTypes.has(finding.findingType)) {
            existing.push(finding);
            findingsByObject.set(finding.objectId, existing);
        }
    });

    const candidates = (snapshot?.objects ?? []).filter(
        (contentObject) =>
            analyzedCandidateStatuses.includes(contentObject.healthStatus) ||
            findingsByObject.has(contentObject.objectId)
    );
    const candidateStatusOptions = Array.from(
        new Set(candidates.map((contentObject) => contentObject.healthStatus))
    ).sort();
    const objectTypes = Array.from(
        new Set(candidates.map((contentObject) => contentObject.objectType))
    ).sort();
    const apps = Array.from(
        new Set(candidates.map((contentObject) => contentObject.app))
    ).sort();
    const normalizedQuery = query.trim().toLowerCase();
    const filteredCandidates = candidates
        .filter((contentObject) => {
            const matchesStatus =
                statusFilter === 'all' ||
                contentObject.healthStatus === statusFilter;
            const matchesType =
                typeFilter === 'all' ||
                contentObject.objectType === typeFilter;
            const matchesApp =
                appFilter === 'all' || contentObject.app === appFilter;
            const review = reviewByObject.get(contentObject.objectId);
            const matchesReview =
                reviewFilter === 'all' ||
                (reviewFilter === 'in_library' && Boolean(review)) ||
                (reviewFilter === 'not_in_library' && !review) ||
                review?.stage === reviewFilter;
            const usageState = usageEvidenceState(contentObject);
            const matchesUsage =
                usageFilter === 'all' || usageState === usageFilter;
            const matchesQuery =
                normalizedQuery.length === 0 ||
                [
                    contentObject.name,
                    contentObject.app,
                    ownerLabel(contentObject),
                ].some((value) =>
                    value
                        .toLowerCase()
                        .replace(/[_-]+/g, ' ')
                        .includes(normalizedQuery)
                );

            return (
                matchesStatus &&
                matchesType &&
                matchesApp &&
                matchesReview &&
                matchesUsage &&
                matchesQuery
            );
        })
        .sort((left, right) => {
            const leftFinding = firstFinding(
                findingsByObject,
                left.objectId
            );
            const rightFinding = firstFinding(
                findingsByObject,
                right.objectId
            );
            if (sortOrder === 'impact') {
                return (
                    (rightFinding?.removalImpact ??
                        right.removalImpact ??
                        -1) -
                    (leftFinding?.removalImpact ?? left.removalImpact ?? -1)
                );
            }
            if (sortOrder === 'name') {
                return left.name.localeCompare(right.name);
            }
            if (sortOrder === 'last_used') {
                return (right.lastUsed ?? '').localeCompare(
                    left.lastUsed ?? ''
                );
            }
            return (
                (rightFinding?.abandonmentConfidence ??
                    right.abandonmentConfidence ??
                    -1) -
                (leftFinding?.abandonmentConfidence ??
                    left.abandonmentConfidence ??
                    -1)
            );
        });
    const totalPages = Math.max(
        1,
        Math.ceil(filteredCandidates.length / PAGE_SIZE)
    );
    const currentPage = Math.min(page, totalPages - 1);
    const pageStart = currentPage * PAGE_SIZE;
    const pageCandidates = filteredCandidates.slice(
        pageStart,
        pageStart + PAGE_SIZE
    );
    const selected =
        filteredCandidates.find(
            (contentObject) => contentObject.objectId === selectedId
        ) ?? pageCandidates[0];
    const selectedFindings = selected
        ? (findingsByObject.get(selected.objectId) ?? [])
        : [];
    const selectedFinding = selected
        ? firstFinding(findingsByObject, selected.objectId)
        : undefined;
    const selectedEvidence = Array.from(
        new Set(
            selectedFindings.length > 0
                ? findingReasons(selectedFindings)
                : (selected?.evidence ?? [])
        )
    );
    const emptyMessage = noCandidatesMessage(
        snapshot,
        isLoading,
        candidates.length
    );

    return (
        <>
            <PageHeader
                title="Cleanup Candidates"
                subtitle="Review evidence-backed findings from the latest live snapshot. No customer content can be changed from this beta."
                actions={
                    <ButtonRow>
                        <StyledButton
                            type="button"
                            onClick={() =>
                                exportCandidates(
                                    filteredCandidates,
                                    findingsByObject,
                                    reviewByObject
                                )
                            }
                            disabled={filteredCandidates.length === 0}
                        >
                            Export filtered CSV
                        </StyledButton>
                        <StyledButton
                            type="button"
                            onClick={() =>
                                exportCandidatesJson(
                                    filteredCandidates,
                                    findingsByObject,
                                    reviewByObject,
                                    snapshot?.scan.scanId ?? null
                                )
                            }
                            disabled={filteredCandidates.length === 0}
                        >
                            Export filtered JSON
                        </StyledButton>
                    </ButtonRow>
                }
            />

            <FilterBar
                onSubmit={(event) => {
                    event.preventDefault();
                }}
                aria-label="Candidate filters"
            >
                <FilterField>
                    Search
                    <Input
                        type="search"
                        value={query}
                        placeholder="Object, app, or owner"
                        onChange={(event) => {
                            setQuery(event.currentTarget.value);
                            setPage(0);
                        }}
                    />
                </FilterField>
                <FilterField>
                    Status
                    <Select
                        value={statusFilter}
                        onChange={(event) => {
                            setStatusFilter(event.currentTarget.value);
                            setPage(0);
                        }}
                    >
                        <option value="all">All statuses</option>
                        {candidateStatusOptions.map((status) => (
                            <option value={status} key={status}>
                                {status}
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
                            <option value={objectType} key={objectType}>
                                {objectType}
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
                            <option value={app} key={app}>
                                {app}
                            </option>
                        ))}
                    </Select>
                </FilterField>
                <FilterField>
                    Review stage
                    <Select
                        value={reviewFilter}
                        onChange={(event) => {
                            setReviewFilter(event.currentTarget.value);
                            setPage(0);
                        }}
                    >
                        <option value="all">All review states</option>
                        <option value="not_in_library">Not in library</option>
                        <option value="in_library">Any library record</option>
                        {reviewStageOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </Select>
                </FilterField>
                <FilterField>
                    Usage evidence
                    <Select
                        value={usageFilter}
                        onChange={(event) => {
                            setUsageFilter(event.currentTarget.value);
                            setPage(0);
                        }}
                    >
                        <option value="all">All usage states</option>
                        <option value="observed">Activity observed</option>
                        <option value="no_observations_complete">
                            No activity, complete window
                        </option>
                        <option value="partial">Partial window</option>
                        <option value="unavailable">Source unavailable</option>
                        <option value="not_measured">Not measured</option>
                    </Select>
                </FilterField>
                <FilterField>
                    Sort
                    <Select
                        value={sortOrder}
                        onChange={(event) => {
                            setSortOrder(event.currentTarget.value);
                            setPage(0);
                        }}
                    >
                        <option value="confidence">Confidence, high first</option>
                        <option value="impact">Impact, high first</option>
                        <option value="last_used">Last observed, newest first</option>
                        <option value="name">Name</option>
                    </Select>
                </FilterField>
                <StyledButton
                    type="button"
                    onClick={() => {
                        setStatusFilter('all');
                        setTypeFilter('all');
                        setAppFilter('all');
                        setReviewFilter('all');
                        setUsageFilter('all');
                        setSortOrder('confidence');
                        setQuery('');
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
                            {filteredCandidates.length} live candidate
                            {filteredCandidates.length === 1 ? '' : 's'}
                        </CardTitle>
                        {filteredCandidates.length > 0 ? (
                            <ButtonRow>
                                <span>
                                    {pageStart + 1}–
                                    {Math.min(
                                        pageStart + PAGE_SIZE,
                                        filteredCandidates.length
                                    )}{' '}
                                    of {filteredCandidates.length}
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
                    {filteredCandidates.length === 0 ? (
                        <EmptyState>
                            <div>
                                <strong>No candidates to display</strong>
                                <p>{emptyMessage}</p>
                            </div>
                        </EmptyState>
                    ) : (
                        <TableScroller>
                            <Table>
                                <thead>
                                    <tr>
                                        <th scope="col">Object</th>
                                        <th scope="col">Type</th>
                                        <th scope="col">Owner</th>
                                        <th scope="col">Last used</th>
                                        <th scope="col">Status</th>
                                        <th scope="col">Review</th>
                                        <th scope="col">Confidence</th>
                                        <th scope="col">Impact</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageCandidates.map((contentObject) => {
                                        const finding = firstFinding(
                                            findingsByObject,
                                            contentObject.objectId
                                        );
                                        return (
                                            <tr key={contentObject.objectId}>
                                                <td>
                                                    <RowButton
                                                        type="button"
                                                        aria-pressed={
                                                            contentObject.objectId ===
                                                            selected?.objectId
                                                        }
                                                        onClick={() =>
                                                            setSelectedId(
                                                                contentObject.objectId
                                                            )
                                                        }
                                                    >
                                                        {contentObject.name}
                                                    </RowButton>
                                                    <div>{contentObject.app}</div>
                                                </td>
                                                <td>{contentObject.objectType}</td>
                                                <td>
                                                    {ownerLabel(contentObject)}
                                                </td>
                                                <td>
                                                    {formatDate(
                                                        contentObject.lastUsed
                                                    )}
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
                                                        'Not in library'
                                                    )}
                                                </td>
                                                <td>
                                                    <Score>
                                                        {finding?.abandonmentConfidence ??
                                                            contentObject.abandonmentConfidence ??
                                                            '—'}
                                                    </Score>
                                                </td>
                                                <td>
                                                    <Score>
                                                        {finding?.removalImpact ??
                                                            contentObject.removalImpact ??
                                                            '—'}
                                                    </Score>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </Table>
                        </TableScroller>
                    )}
                </Card>

                {selected ? (
                    <DetailPanel aria-label={`Details for ${selected.name}`}>
                        <DetailSection>
                            <DetailTitle>{selected.name}</DetailTitle>
                            <StatusBadge status={selected.healthStatus} />
                        </DetailSection>
                        <DetailSection>
                            <DefinitionList>
                                <dt>Type</dt>
                                <dd>{selected.objectType}</dd>
                                <dt>App</dt>
                                <dd>{selected.app}</dd>
                                <dt>Owner</dt>
                                <dd>{ownerLabel(selected)}</dd>
                                <dt>Sharing</dt>
                                <dd>{selected.sharing ?? 'Unknown'}</dd>
                                <dt>Enabled</dt>
                                <dd>{formatBoolean(selected.enabled)}</dd>
                                <dt>Scheduled</dt>
                                <dd>
                                    {formatBoolean(
                                        selected.scheduled,
                                        'Not applicable'
                                    )}
                                </dd>
                                <dt>Last modified</dt>
                                <dd>{formatDate(selected.updated)}</dd>
                                <dt>Last used</dt>
                                <dd>{formatDate(selected.lastUsed)}</dd>
                                <dt>Inbound refs</dt>
                                <dd>{selected.inboundReferences}</dd>
                                <dt>Outbound refs</dt>
                                <dd>{selected.outboundReferences}</dd>
                            </DefinitionList>
                        </DetailSection>
                        <DetailSection>
                            <UsageEvidencePanel contentObject={selected} />
                        </DetailSection>
                        <DetailSection>
                            <strong>Recorded evidence</strong>
                            <EvidenceList>
                                {selectedEvidence.map((evidence) => (
                                    <li key={evidence}>{evidence}</li>
                                ))}
                            </EvidenceList>
                        </DetailSection>
                        <DetailSection>
                            <strong>Independent scores</strong>
                            <DefinitionList>
                                <dt>Abandonment confidence</dt>
                                <dd>
                                    {formatScore(
                                        selectedFinding?.abandonmentConfidence ??
                                            selected.abandonmentConfidence
                                    )}
                                </dd>
                                <dt>Removal impact</dt>
                                <dd>
                                    {formatScore(
                                        selectedFinding?.removalImpact ??
                                            selected.removalImpact
                                    )}
                                </dd>
                            </DefinitionList>
                        </DetailSection>
                        <DetailSection>
                            <strong>Suggested review action</strong>
                            <p>
                                {selectedFinding?.suggestedAction ??
                                    selected.suggestedAction}
                            </p>
                            <StyledButton
                                type="button"
                                onClick={() =>
                                    exportCandidates(
                                        [selected],
                                        findingsByObject,
                                        reviewByObject
                                    )
                                }
                            >
                                Export this finding
                            </StyledButton>
                        </DetailSection>
                        <DetailSection>
                            <strong>Investigate this object</strong>
                            <ButtonRow>
                                <StyledButton
                                    type="button"
                                    onClick={() =>
                                        navigateToView('dependencies', {
                                            object: selected.objectId,
                                        })
                                    }
                                >
                                    Explore dependencies
                                </StyledButton>
                                {reviewByObject.has(selected.objectId) ? (
                                    <StyledButton
                                        type="button"
                                        onClick={() =>
                                            navigateToView('reviews', {
                                                object: selected.objectId,
                                            })
                                        }
                                    >
                                        Open in review library
                                    </StyledButton>
                                ) : null}
                            </ButtonRow>
                        </DetailSection>
                        <DetailSection>
                            <ReviewEditor
                                contentObject={selected}
                                review={
                                    reviewByObject.get(selected.objectId) ?? null
                                }
                                scanId={snapshot?.scan.scanId ?? ''}
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
