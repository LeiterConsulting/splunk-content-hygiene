import React, { useContext, useMemo, useState } from 'react';
import {
    ButtonRow,
    Card,
    CardHeader,
    CardTitle,
    FactGrid,
    DetailLayout,
    DetailPanel,
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
    WorkspaceHeader,
    WorkspaceNavigation,
} from '../AppStyles';
import { ResultPagination } from '../components/ResultPagination';
import { PageHeader } from '../components/PageHeader';
import { ReviewEditor } from '../components/ReviewEditor';
import { ExportMenu } from '../components/ExportMenu';
import { FieldLineagePanel } from '../components/FieldLineagePanel';
import { AppPoliciesPanel } from '../components/AppPoliciesPanel';
import { AppPolicyContext, AppRetentionLabel } from '../components/AppPolicyContext';
import { PolicyProtection } from '../services/appPolicies';
import { WorkspaceTabs } from '../components/WorkspaceTabs';
import { CallerContextPanel } from '../components/CallerContextPanel';
import { ReviewHistoryPanel } from '../components/ReviewHistoryPanel';
import { useReviewNavigation } from '../components/ReviewNavigationContext';
import { useSelectionFocus } from '../components/useSelectionFocus';
import { useSelectionLocation } from '../components/useSelectionLocation';
import { ReviewWorkflowContext } from '../components/ReviewWorkflowContext';
import { ReviewStageBadge } from '../components/ReviewStageBadge';
import { ReviewFreshnessBadge, ReviewFreshnessPanel } from '../components/ReviewFreshnessPanel';
import { useEvidenceClock } from '../components/useEvidenceClock';
import { StatusBadge } from '../components/StatusBadge';
import { SummaryMetric } from '../components/SummaryMetric';
import { PathPairPicker } from '../components/PathPairPicker';
import { buildDependencyIndex } from '../services/dependencyGraph';
import { UsageEvidencePanel } from '../components/UsageEvidencePanel';
import { reviewStageOptions } from '../services/reviews';
import { compareReviewEvidence, ReviewFreshness, reviewValidityLabels } from '../services/reviewEvidence';
import { usageValidity } from '../services/usage';
import { ContentObject, InventorySnapshot, ReviewInput, ReviewRecord } from '../types';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { navigateToView, readQueryParam } from '../utils/navigation';
import { ownerLabel } from '../utils/objectLabels';

const PAGE_SIZE = 50;

interface ReviewLibraryPageProps {
    snapshot: InventorySnapshot | null;
    reviews: ReviewRecord[];
    isLoading: boolean;
    loadError: string | null;
    canWriteReviews: boolean;
    onSaveReview: (input: ReviewInput) => Promise<ReviewRecord>;
    onDeleteReview: (objectId: string, expectedRevisionId?: string | null) => Promise<void>;
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
        suggestedAction:
            'Confirm whether the object was removed, renamed, or is outside current scan visibility.',
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

function exportReviews(rows: ReviewRecord[], objectById: Map<string, ContentObject>, freshness: Map<string, ReviewFreshness>, inventoryAvailable: boolean,
    protection: ReadonlyMap<string, PolicyProtection>): void {
    const presence = (id: string): string => {
        if (!inventoryAvailable) { return 'unavailable'; }
        return objectById.has(id) ? 'present' : 'not observed';
    };
    const missingUsage = inventoryAvailable ? 'not_in_inventory' : 'inventory_unavailable';
    downloadCsv(
        'content-hygiene-review-library.csv',
        [
            'Object ID',
            'Name',
            'Type',
            'App',
            'Owner',
            'Stage',
            'Review evidence status',
            'Changes since review',
            'Verification limits',
            'Evidence baseline scan',
            'Assigned to',
            'Note',
            'Current inventory status',
            'Health at review',
            'Usage validity',
            'Usage window ended',
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
            'Library state', 'Revision', 'Revision ID', 'Persistence warning',
            'Coverage policy', 'Configuration coverage', 'ACL coverage', 'Outbound coverage', 'Inbound coverage',
            'Current declared field facts',
            'App policy protection (separate from individual decision)',
        ],
        rows.map((review) => [
            review.objectId,
            review.objectName,
            review.objectType,
            review.app,
            review.owner,
            review.stage,
            freshness.get(review.objectId)?.status ?? 'cannot_verify',
            freshness.get(review.objectId)?.reasons.join('; ') ?? '',
            freshness.get(review.objectId)?.limitations.join('; ') ?? '',
            review.evidenceBaseline?.evidence.scanId ?? '',
            review.assignedTo,
            review.note,
            presence(review.objectId),
            review.healthStatusAtReview,
            objectById.has(review.objectId)
                ? usageValidity(objectById.get(review.objectId)!)
                : missingUsage,
            objectById.get(review.objectId)?.usageEvidence?.windowEnd ?? '',
            objectById.get(review.objectId)?.usageEvidence?.coverage ?? 'not measured',
            objectById.get(review.objectId)?.usageEvidence?.observationCount ?? '',
            objectById.get(review.objectId)?.lastUsed ?? '',
            review.usageCoverageAtReview ?? 'not measured',
            review.usageObservationCountAtReview ?? '',
            review.usageLastObservedAtReview ?? '',
            review.usageRunIdAtReview ?? '',
            review.scanId,
            review.createdAt,
            review.updatedAt,
            review.updatedBy,
            review.removed ? 'archived' : 'active', review.revisionNumber ?? 0, review.revisionId ?? '', review.persistenceIssue ?? '',
            freshness.get(review.objectId)?.current?.coverage?.policy ?? 'legacy-unscoped',
            freshness.get(review.objectId)?.current?.coverage?.configuration.status ?? 'unavailable',
            freshness.get(review.objectId)?.current?.coverage?.access.status ?? 'unavailable',
            freshness.get(review.objectId)?.current?.coverage?.outbound.status ?? 'unavailable',
            freshness.get(review.objectId)?.current?.coverage?.inbound.status ?? 'unavailable',
            objectById.get(review.objectId)?.fieldLineage ? JSON.stringify(objectById.get(review.objectId)!.fieldLineage) : '',
            JSON.stringify(protection.get(review.objectId) ?? null),
        ]),
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
    const workflow = useContext(ReviewWorkflowContext);
    const policies = useContext(AppPolicyContext);
    const { navigate } = useReviewNavigation();
    const [query, setQuery] = useState(readQueryParam('query'));
    const [stageFilter, setStageFilter] = useState(readQueryParam('stage') || 'all');
    const [appFilter, setAppFilter] = useState('all');
    const [typeFilter, setTypeFilter] = useState('all');
    const [presenceFilter, setPresenceFilter] = useState('all');
    const [validityFilter, setValidityFilter] = useState(readQueryParam('validity') || 'all');
    const [libraryFilter, setLibraryFilter] = useState(readQueryParam('library') || 'active');
    const [selectedId, setSelectedId] = useState(readQueryParam('object'));
    useSelectionLocation(selectedId);
    const [page, setPage] = useState(0);
    const evidenceNow = useEvidenceClock();
    const objectById = useMemo(() => new Map(
        (snapshot?.objects ?? []).map((contentObject) => [contentObject.objectId, contentObject]),
    ), [snapshot]);
    const freshness = useMemo(() => new Map(reviews.map((review) => [review.objectId,
        compareReviewEvidence(loadError ? { ...review, persistenceIssue: 'The saved library could not be verified. Refresh before relying on this confirmation.' } : review,
            objectById.get(review.objectId), snapshot?.scan, evidenceNow),
    ])), [reviews, objectById, snapshot?.scan, evidenceNow, loadError]);
    const apps = Array.from(new Set(reviews.map((review) => review.app))).sort();
    const objectTypes = Array.from(new Set(reviews.map((review) => review.objectType))).sort();
    const normalizedQuery = query.trim().toLowerCase();
    const activeReviews = useMemo(() => reviews.filter((review) => !review.removed), [reviews]);
    const filteredReviews = reviews
        .filter((review) => {
            const isPresent = objectById.has(review.objectId);
            return (
                (libraryFilter === 'all' || (libraryFilter === 'archived' ? review.removed : !review.removed)) &&
                (stageFilter === 'all' || review.stage === stageFilter) &&
                (validityFilter === 'all' || freshness.get(review.objectId)?.status === validityFilter) &&
                (appFilter === 'all' || review.app === appFilter) &&
                (typeFilter === 'all' || review.objectType === typeFilter) &&
                (presenceFilter === 'all' ||
                    (presenceFilter === 'present' && isPresent) ||
                    (presenceFilter === 'missing' && Boolean(snapshot) && !isPresent)) &&
                (!normalizedQuery ||
                    [
                        review.objectName,
                        review.canonicalName,
                        review.app,
                        review.objectType,
                        review.owner ?? '',
                        review.assignedTo ?? '',
                        review.note,
                    ].some((value) => value.toLowerCase().includes(normalizedQuery)))
            );
        })
        .sort(
            (left, right) =>
                right.updatedAt.localeCompare(left.updatedAt) ||
                left.objectName.localeCompare(right.objectName),
        );
    const totalPages = Math.max(1, Math.ceil(filteredReviews.length / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages - 1);
    const pageStart = currentPage * PAGE_SIZE;
    const pageReviews = filteredReviews.slice(pageStart, pageStart + PAGE_SIZE);
    const pathIndex = useMemo(() => snapshot ? buildDependencyIndex(snapshot.objects, snapshot.edges) : null, [snapshot]);
    const selectedReview = reviews.find((review) => review.objectId === selectedId) ?? null;
    const selectedIndex = filteredReviews.findIndex((review) => review.objectId === selectedId);
    const { detailTitle, listTitle } = useSelectionFocus(selectedReview?.objectId);
    const openReview = (objectId: string): void => navigate(() => setSelectedId(objectId));
    const closeReview = (): void => navigate(() => {
        if (selectedIndex >= 0) { setPage(Math.floor(selectedIndex / PAGE_SIZE)); }
        setSelectedId('');
    });
    const selectedObject = selectedReview
        ? (objectById.get(selectedReview.objectId) ?? lastObservedObject(selectedReview))
        : null;
    const selectedIsPresent = Boolean(selectedReview && objectById.has(selectedReview.objectId));
    const stageCount = (stage: ReviewRecord['stage']): number =>
        activeReviews.filter((review) => review.stage === stage).length;
    const missingLabel = snapshot ? 'Not present' : 'Unavailable';

    if (isLoading && !snapshot) {
        return <>
            <PageHeader title="Review Library" subtitle="Loading verified inventory and saved review evidence." />
            <Card><EmptyState><div>
                <strong>Loading review evidence…</strong>
                <p>Saved decisions remain unchanged. Object presence is not yet known.</p>
            </div></EmptyState></Card>
        </>;
    }

    return (
        <>
            <PageHeader
                title="Review Library"
                subtitle="Build a durable, app-local investigation queue without modifying any Splunk knowledge object."
                actions={!selectedReview ?
                    <ButtonRow>
                        <StyledButton onClick={() => navigate(() => navigateToView('inuse', { activity: 'none' }))}>Retained content report</StyledButton>
                        {workflow.refresh ? <StyledButton type="button" disabled={isLoading}
                            onClick={() => workflow.refresh!().catch(() => undefined)}>Refresh library</StyledButton> : null}
                        <ExportMenu label="Export filtered reviews" disabled={!filteredReviews.length} items={[
                            { label: 'Review library CSV', onClick: () => exportReviews(filteredReviews, objectById, freshness, Boolean(snapshot), policies.protection) },
                            { label: 'Review library JSON', onClick: () =>
                                downloadJson('content-hygiene-review-library.json', {
                                    exportedAt: new Date().toISOString(),
                                    scanId: snapshot?.scan.scanId ?? null,
                                    reviews: filteredReviews.map((review) => ({
                                        ...review,
                                        currentObject: objectById.get(review.objectId) ?? null,
                                        reviewEvidenceStatus: freshness.get(review.objectId),
                                        appPolicyProtection: policies.protection.get(review.objectId) ?? null,
                                    })),
                                })
                            },
                        ]} />
                        <StyledButton
                            type="button"
                            $primary
                            onClick={() => navigate(() => navigateToView('candidates'))}
                        >
                            Find candidates
                        </StyledButton>
                    </ButtonRow> : undefined
                }
            />

            {loadError ? <InlineNotice role="alert">{loadError}</InlineNotice> : null}
            <div hidden={Boolean(selectedReview)}>
            {!selectedReview ? <AppPoliciesPanel snapshot={snapshot} /> : null}
            <MetricGrid aria-label="Review workflow summary">
                <SummaryMetric
                    label="Active library records"
                    value={activeReviews.length.toLocaleString()}
                    hint={`${reviews.length - activeReviews.length} archived; decisions and history remain durable`}
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
                    hint="Saved decision; check current evidence before relying on it"
                    accent="positive"
                />
                <SummaryMetric
                    label="Retain / blocked"
                    value={(stageCount('retain') + stageCount('blocked')).toLocaleString()}
                    hint="Excluded or prevented from cleanup"
                    accent="neutral"
                />
            </MetricGrid>
            <ButtonRow aria-label="Review evidence summary">
                {(['needs_review', 'cannot_verify', 'current'] as const).map((status) => (
                    <StyledButton key={status} onClick={() => { setValidityFilter(status); setPage(0); }}>
                        {reviewValidityLabels[status]}: {[...freshness.values()].filter((item) => item.status === status).length}
                    </StyledButton>
                ))}
            </ButtonRow>

            <FilterBar
                aria-label="Review library filters"
                onSubmit={(event) => event.preventDefault()}
            >
                <FilterField>
                    Library state
                    <Select value={libraryFilter} onChange={(event) => { setLibraryFilter(event.currentTarget.value); setPage(0); }}>
                        <option value="active">Active library</option>
                        <option value="archived">Archived reviews</option>
                        <option value="all">All saved records</option>
                    </Select>
                </FilterField>
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
                    Review evidence status
                    <Select value={validityFilter} onChange={(event) => {
                        setValidityFilter(event.currentTarget.value); setPage(0);
                    }}>
                        <option value="all">All evidence statuses</option>
                        {(['needs_review', 'cannot_verify', 'current'] as const).map((status) => (
                            <option key={status} value={status}>{reviewValidityLabels[status]}</option>
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
                        setValidityFilter('all');
                        setLibraryFilter('active');
                        setPage(0);
                    }}
                >
                    Clear filters
                </StyledButton>
            </FilterBar>
            </div>

            <DetailLayout>
                <Card hidden={Boolean(selectedReview)}>
                    <CardHeader>
                        <CardTitle ref={listTitle} tabIndex={-1}>
                            {filteredReviews.length} review record
                            {filteredReviews.length === 1 ? '' : 's'}
                        </CardTitle>
                        {filteredReviews.length > 0 ? (
                            <ResultPagination
                                page={currentPage}
                                pageSize={PAGE_SIZE}
                                total={filteredReviews.length}
                                onChange={setPage}
                            />
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
                                    Add a candidate or dependency object to the library, or clear
                                    the filters.
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
                                        <th scope="col">Review evidence</th>
                                        <th scope="col">Assigned to</th>
                                        <th scope="col">Current health</th>
                                        <th scope="col">Updated</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageReviews.map((review) => {
                                        const currentObject = objectById.get(review.objectId);
                                        return (
                                            <tr key={review.objectId}>
                                                <td>
                                                    <RowButton
                                                        type="button"
                                                        onClick={() =>
                                                            openReview(review.objectId)
                                                        }
                                                    >
                                                        {review.objectName}
                                                    </RowButton>
                                                    <div>{review.app}</div>
                                                </td>
                                                <td>{review.objectType}</td>
                                                <td>
                                                    <ReviewStageBadge stage={review.stage} />
                                                    <div><AppRetentionLabel objectId={review.objectId} /></div>
                                                    {review.removed ? <div>Archived · decision retained</div> : null}
                                                </td>
                                                <td><ReviewFreshnessBadge status={freshness.get(review.objectId)!.status} /></td>
                                                <td>{review.assignedTo ?? 'Unassigned'}</td>
                                                <td>
                                                    {currentObject ? (
                                                        <StatusBadge
                                                            status={currentObject.healthStatus}
                                                        />
                                                    ) : (
                                                        missingLabel
                                                    )}
                                                </td>
                                                <td>{formatDateTime(review.updatedAt)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </Table>
                        </TableScroller>
                    )}
                </Card>

                {selectedReview && selectedObject ? (
                    <div data-investigation-workspace>
                    <WorkspaceNavigation aria-label="Review navigation">
                        <StyledButton onClick={closeReview}>Back to review library</StyledButton>
                        <ButtonRow>
                            <span>{selectedIndex >= 0 ? `${selectedIndex + 1} of ${filteredReviews.length} filtered reviews` : 'Outside current library filters'}</span>
                            <StyledButton disabled={selectedIndex <= 0} onClick={() => openReview(filteredReviews[selectedIndex - 1].objectId)}>Previous review</StyledButton>
                            <StyledButton disabled={selectedIndex < 0 || selectedIndex >= filteredReviews.length - 1} onClick={() => openReview(filteredReviews[selectedIndex + 1].objectId)}>Next review</StyledButton>
                        </ButtonRow>
                    </WorkspaceNavigation>
                    <DetailPanel aria-label={`Review details for ${selectedReview.objectName}`}>
                        <WorkspaceHeader>
                            <div>
                            <DetailTitle ref={detailTitle} tabIndex={-1}>{selectedReview.objectName}</DetailTitle>
                            <p>{selectedReview.objectType} · {selectedReview.app} · {ownerLabel(selectedObject)}</p>
                            <ButtonRow>
                                <ReviewStageBadge stage={selectedReview.stage} />
                                {selectedReview.removed ? <span>Archived · decision retained</span> : null}
                                {!selectedIsPresent ? <span>Health at review:</span> : null}
                                <StatusBadge status={selectedObject.healthStatus} />
                                <ReviewFreshnessBadge status={freshness.get(selectedReview.objectId)!.status} />
                            </ButtonRow>
                            </div>
                            <ButtonRow>
                                <StyledButton $primary disabled={!objectById.has(selectedReview.objectId)}
                                    onClick={() => navigate(() => navigateToView('dependencies', { object: selectedReview.objectId, scan: snapshot?.scan.scanId }))}>Explore dependencies</StyledButton>
                                <StyledButton disabled={!objectById.has(selectedReview.objectId)}
                                    onClick={() => navigate(() => navigateToView('candidates', { object: selectedReview.objectId }))}>View candidate evidence</StyledButton>
                                <ExportMenu label="Export this review" items={[
                                    { label: 'Selected review CSV', onClick: () => exportReviews([selectedReview], objectById, freshness, Boolean(snapshot), policies.protection) },
                                    { label: 'Selected review JSON', onClick: () => downloadJson('content-hygiene-review.json', { exportedAt: new Date().toISOString(), review: selectedReview, currentObject: objectById.get(selectedReview.objectId) ?? null, reviewEvidenceStatus: freshness.get(selectedReview.objectId), appPolicyProtection: policies.protection.get(selectedReview.objectId) ?? null }) },
                                ]} />
                            </ButtonRow>
                        </WorkspaceHeader>
                        {!selectedIsPresent ? <InlineNotice>
                            {snapshot
                                ? 'This object is not visible in the latest cached scan. Its saved decision and historical health are retained; they are not a current inventory confirmation.'
                                : 'Inventory is unavailable. This saved decision is retained; current object presence and health are unknown.'}
                        </InlineNotice> : null}
                        <WorkspaceTabs key={selectedReview.objectId} defaultActivePanelId="decision">
                        <WorkspaceTabs.Panel panelId="decision" label="Review decision">
                            <ReviewEditor contentObject={selectedObject} review={selectedReview}
                                scanId={snapshot?.scan.scanId ?? selectedReview.scanId}
                                canWrite={canWriteReviews} onSave={onSaveReview} onDelete={onDeleteReview} showHistory={false} />
                        </WorkspaceTabs.Panel>
                        <WorkspaceTabs.Panel panelId="evidence" label="Evidence & changes">
                            <ReviewFreshnessPanel
                                key={selectedReview.objectId}
                                objectId={selectedReview.objectId}
                                comparison={freshness.get(selectedReview.objectId)!}
                                canDrillTo={(id) => objectById.has(id)}
                                onDrillTo={(id) => navigate(() => navigateToView('dependencies', { object: id, scan: snapshot?.scan.scanId }))}
                            />
                        </WorkspaceTabs.Panel>
                        <WorkspaceTabs.Panel panelId="details" label="Object & usage details">
                            <FactGrid>
                                <dt>Type</dt>
                                <dd>{selectedReview.objectType}</dd>
                                <dt>App</dt>
                                <dd>{selectedReview.app}</dd>
                                <dt>Owner at review</dt>
                                <dd>{selectedReview.owner ?? 'No named owner captured'}</dd>
                                <dt>Current ownership</dt>
                                <dd>{selectedIsPresent ? ownerLabel(selectedObject) : 'Unavailable in current inventory'}</dd>
                                <dt>Current scan</dt>
                                <dd>
                                    {objectById.has(selectedReview.objectId)
                                        ? 'Present'
                                        : missingLabel}
                                </dd>
                                <dt>Inbound refs</dt>
                                <dd>{selectedObject.inboundReferences}</dd>
                                <dt>Outbound refs</dt>
                                <dd>{selectedObject.outboundReferences}</dd>
                                <dt>Usage coverage at review</dt>
                                <dd>{selectedReview.usageCoverageAtReview ?? 'Not measured'}</dd>
                                <dt>Observations at review</dt>
                                <dd>
                                    {selectedReview.usageObservationCountAtReview ?? 'Not measured'}
                                </dd>
                                <dt>Last observed at review</dt>
                                <dd>
                                    {selectedReview.usageLastObservedAtReview
                                        ? formatDateTime(selectedReview.usageLastObservedAtReview)
                                        : 'Not observed'}
                                </dd>
                                <dt>Last updated by</dt>
                                <dd>{selectedReview.updatedBy}</dd>
                                <dt>Decision source scan</dt>
                                <dd>{selectedReview.scanId}</dd>
                                <dt>Last updated</dt>
                                <dd>{formatDateTime(selectedReview.updatedAt)}</dd>
                            </FactGrid>
                            <FieldLineagePanel object={selectedObject} />
                            <UsageEvidencePanel contentObject={selectedObject} />
                        </WorkspaceTabs.Panel>
                        <WorkspaceTabs.Panel panelId="paths" label="Dependency paths">
                            {pathIndex && selectedIsPresent ? <PathPairPicker key={selectedReview.objectId} index={pathIndex} objectId={selectedReview.objectId}
                                onInspect={id => navigate(() => navigateToView('dependencies', { object: id, scan: snapshot?.scan.scanId }))} /> :
                                <InlineNotice>Current inventory is unavailable for this identity. The saved decision remains unchanged; no current path can be inferred from the historical review.</InlineNotice>}
                        </WorkspaceTabs.Panel>
                        <WorkspaceTabs.Panel panelId="history" label="Revision history">
                            <ReviewHistoryPanel objectId={selectedReview.objectId} />
                        </WorkspaceTabs.Panel>
                        <WorkspaceTabs.Panel panelId="context" label="Caller context">
                            {selectedIsPresent ? <CallerContextPanel key={selectedReview.objectId} object={selectedObject} /> :
                                <InlineNotice>This object is not present in the current inventory. Its saved decision is preserved; current caller diagnostics are unavailable, not inferred from historical review data.</InlineNotice>}
                        </WorkspaceTabs.Panel>
                        </WorkspaceTabs>
                    </DetailPanel>
                    </div>
                ) : null}
            </DetailLayout>
        </>
    );
}
