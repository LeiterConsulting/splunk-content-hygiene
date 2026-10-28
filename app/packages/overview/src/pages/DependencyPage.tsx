import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppPolicyContext, AppRetentionLabel, AppRetentionNotice } from '../components/AppPolicyContext';
import { PolicyProtection } from '../services/appPolicies';
import { WorkspaceTabs as TabLayout } from '../components/WorkspaceTabs';
import {
    Breadcrumbs,
    ButtonRow,
    Card,
    CardBody,
    CardHeader,
    CardTitle,
    DefinitionList,
    FactGrid,
    DetailLayout,
    DetailPanel,
    DetailSection,
    DetailTitle,
    EmptyState,
    FilterBar,
    FilterField,
    InlineNotice,
    Input,
    RowButton,
    Select,
    SmallText,
    SpacedBlock,
    StyledButton,
    Table,
    TableScroller,
    WorkspaceHeader,
} from '../AppStyles';
import { DependencyGraph } from '../components/DependencyGraph';
import { ResultPagination } from '../components/ResultPagination';
import { PageHeader } from '../components/PageHeader';
import { RemovalImpactPanel } from '../components/RemovalImpactPanel';
import { ReviewEditor } from '../components/ReviewEditor';
import { ExportMenu } from '../components/ExportMenu';
import { FieldLineagePanel } from '../components/FieldLineagePanel';
import { useReviewNavigation } from '../components/ReviewNavigationContext';
import { ReviewStageBadge } from '../components/ReviewStageBadge';
import { ReviewFreshnessBadge, ReviewFreshnessPanel } from '../components/ReviewFreshnessPanel';
import { useEvidenceClock } from '../components/useEvidenceClock';
import { StatusBadge } from '../components/StatusBadge';
import { UsageEvidencePanel } from '../components/UsageEvidencePanel';
import { buildDependencyIndex } from '../services/dependencyGraph';
import { createPathContextTracker, PathContextEvidence, PATH_CONTEXT_LABELS } from '../services/pathContext';
import { RemovalImpactAnalysis, analyzeRemovalImpact } from '../services/removalImpact';
import { reviewStageOptions } from '../services/reviews';
import { compareReviewEvidence, ReviewFreshness } from '../services/reviewEvidence';
import { usageEvidenceState, usageValidity } from '../services/usage';
import {
    ContentObject,
    DependencyEdge,
    HealthStatus,
    InventorySnapshot,
    ReviewInput,
    ReviewRecord,
} from '../types';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { navigateToView, readQueryParam, readQueryParams, serializeQuery } from '../utils/navigation';
import { ownerLabel } from '../utils/objectLabels';
import { isPotentialRelation } from '../utils/dependencySemantics';

const candidateFindingTypes = new Set([
    'cleanup_candidate',
    'broken_reference',
    'unowned',
    'needs_review',
    'repair_required',
]);
const candidateStatuses: HealthStatus[] = ['dormant', 'orphaned', 'broken', 'unowned'];

interface DependencyPageProps {
    snapshot: InventorySnapshot | null;
    isLoading: boolean;
    reviews: ReviewRecord[];
    canWriteReviews: boolean;
    onSaveReview: (input: ReviewInput) => Promise<ReviewRecord>;
    onDeleteReview: (objectId: string, expectedRevisionId?: string | null) => Promise<void>;
}

interface RelatedNode {
    edge: DependencyEdge;
    objectId: string;
    name: string;
    objectType: string;
    healthStatus: HealthStatus;
    contentObject: ContentObject | null;
    direction: 'inbound' | 'outbound';
}

function formatScore(value: number | null): string {
    return value === null ? 'Unknown' : `${value}/100`;
}

function unresolvedNode(
    edge: DependencyEdge,
    objectId: string,
    direction: RelatedNode['direction'],
): RelatedNode {
    const parts = objectId.split('::');
    const targetType = parts[1]?.replace(/_/g, ' ') ?? 'target';
    return {
        edge,
        objectId,
        name: parts.slice(3).join('::') || objectId,
        objectType: `Unresolved ${targetType}`,
        healthStatus: edge.confidence === 'unknown' ? 'unknown' : 'broken',
        contentObject: null,
        direction,
    };
}

function matchesGroup(
    contentObject: ContentObject,
    group: string,
    candidateIds: Set<string>,
    reviewByObject: Map<string, ReviewRecord>,
    freshness: Map<string, ReviewFreshness>,
): boolean {
    if (group === 'all') {
        return true;
    }
    if (group.startsWith('validity:')) {
        return freshness.get(contentObject.objectId)?.status === group.slice(9);
    }
    if (group === 'parser_gaps') {
        return Boolean(contentObject.analysisWarnings?.length);
    }
    if (group === 'candidates') {
        return candidateIds.has(contentObject.objectId);
    }
    if (group === 'in_library') {
        return reviewByObject.has(contentObject.objectId);
    }
    if (group === 'usage_observed') {
        return usageEvidenceState(contentObject) === 'observed';
    }
    if (group === 'usage_no_observations_complete') {
        return usageEvidenceState(contentObject) === 'no_observations_complete';
    }
    if (group === 'usage_incomplete') {
        return ['partial', 'unavailable', 'not_measured', 'historical', 'unsupported'].includes(
            usageEvidenceState(contentObject),
        );
    }
    const review = reviewByObject.get(contentObject.objectId);
    if (review?.stage === group) {
        return true;
    }
    return contentObject.healthStatus === group;
}

function exportRelationships(
    selected: ContentObject,
    rows: RelatedNode[],
    reviewByObject: Map<string, ReviewRecord>,
    protection: ReadonlyMap<string, PolicyProtection>,
    contexts: ReadonlyMap<string, PathContextEvidence>,
): void {
    downloadCsv(
        `content-hygiene-dependencies-${selected.name}.csv`,
        [
            'Center object ID',
            'Inventory scan ID',
            'Center object',
            'Direction',
            'Related object ID',
            'Related object',
            'Related type',
            'Related health',
            'Related review stage',
            'Related usage coverage',
            'Related usage validity',
            'Related usage window ended',
            'Related usage observations',
            'Related last observed',
            'Relation',
            'Potential implicit relationship',
            'Confidence',
            'Resolved',
            'Evidence',
            'Source location',
            'Field relationship provenance', 'Center declared field facts', 'Related declared field facts',
            'Center app policy protection', 'Related app policy protection',
            'Directed relationship context (one hop)',
        ],
        rows.map((row) => [
            selected.objectId,
            selected.inventoryScanId ?? '',
            selected.name,
            row.direction,
            row.objectId,
            row.name,
            row.objectType,
            row.healthStatus,
            reviewByObject.get(row.objectId)?.stage ?? '',
            row.contentObject?.usageEvidence?.coverage ?? 'not measured',
            row.contentObject ? usageValidity(row.contentObject) : 'not_applicable',
            row.contentObject?.usageEvidence?.windowEnd ?? '',
            row.contentObject?.usageEvidence?.observationCount ?? '',
            row.contentObject?.lastUsed ?? '',
            row.edge.relation,
            isPotentialRelation(row.edge.relation),
            row.edge.confidence,
            row.edge.resolved,
            row.edge.evidence,
            row.edge.sourceLocation,
            row.edge.fieldProvenance ? JSON.stringify(row.edge.fieldProvenance) : '',
            selected.fieldLineage ? JSON.stringify(selected.fieldLineage) : '',
            row.contentObject?.fieldLineage ? JSON.stringify(row.contentObject.fieldLineage) : '',
            JSON.stringify(protection.get(selected.objectId) ?? null), JSON.stringify(protection.get(row.objectId) ?? null),
            JSON.stringify(contexts.get(row.edge.edgeId) ?? null),
        ]),
    );
}

function exportRemovalImpact(selected: ContentObject, analysis: RemovalImpactAnalysis): void {
    const rows = analysis.affectedObjects.length > 0 ? analysis.affectedObjects : [null];
    downloadCsv(
        `content-hygiene-removal-impact-${selected.name}.csv`,
        [
            'Selected object ID',
            'Inventory scan ID',
            'Selected usage validity',
            'Selected usage window ended',
            'Selected object',
            'Impact level',
            'Impact score',
            'Readiness',
            'Summary',
            'Selected usage coverage',
            'Selected usage observations',
            'Selected last observed',
            'Affected object ID',
            'Affected object',
            'Affected type',
            'Affected app',
            'Depth',
            'Direct',
            'Path',
            'Relation',
            'Confidence',
            'Likely outcome',
            'Path contains potential implicit relationship',
            'Evidence',
            'Field relationship provenance', 'Selected declared field facts', 'Affected declared field facts',
            'Selected app policy protection', 'Affected app policy protection',
            'Chosen witness path context', 'Chosen witness edge IDs',
        ],
        rows.map((affected) => [
            selected.objectId,
            selected.inventoryScanId ?? '',
            usageValidity(selected),
            selected.usageEvidence?.windowEnd ?? '',
            selected.name,
            analysis.impactLevel,
            analysis.impactScore,
            analysis.readiness,
            analysis.summary,
            selected.usageEvidence?.coverage ?? 'not measured',
            selected.usageEvidence?.observationCount ?? '',
            selected.lastUsed ?? '',
            affected?.objectId ?? '',
            affected?.name ?? '',
            affected?.objectType ?? '',
            affected?.app ?? '',
            affected?.depth ?? '',
            affected?.direct ?? '',
            affected?.pathNames.join(' -> ') ?? '',
            affected?.relation ?? '',
            affected?.confidence ?? '',
            affected?.likelyOutcome ?? '',
            affected?.conditional ?? false,
            affected?.evidence ?? '',
            affected?.fieldProvenance ? JSON.stringify(affected.fieldProvenance) : '',
            selected.fieldLineage ? JSON.stringify(selected.fieldLineage) : '',
            affected?.fieldLineage ? JSON.stringify(affected.fieldLineage) : '',
            JSON.stringify(analysis.policyProtection ?? null), JSON.stringify(affected?.policyProtection ?? null),
            affected ? JSON.stringify(affected.pathContext) : '',
            affected ? JSON.stringify(affected.pathEdgeIds) : '',
        ]),
    );
}

function groupOptions(allLabel: string): React.ReactNode {
    return (
        <>
            <option value="all">{allLabel}</option>
            <option value="parser_gaps">Objects with parser/coverage gaps</option>
            <option value="candidates">All cleanup candidates</option>
            {candidateStatuses.map((status) => (
                <option key={status} value={status}>
                    Candidate group: {status}
                </option>
            ))}
            <option value="in_library">Any review-library record</option>
            <option value="validity:needs_review">Review evidence: needs re-review</option>
            <option value="validity:cannot_verify">Review evidence: cannot verify</option>
            <option value="validity:current">Review evidence: current</option>
            <option value="usage_observed">Usage: activity observed</option>
            <option value="usage_no_observations_complete">
                Usage: no activity, complete window
            </option>
            <option value="usage_incomplete">Usage: incomplete, historical, or not measured</option>
            {reviewStageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                    Review stage: {option.label}
                </option>
            ))}
        </>
    );
}

export function DependencyPage({
    snapshot,
    isLoading,
    reviews,
    canWriteReviews,
    onSaveReview,
    onDeleteReview,
}: DependencyPageProps): React.ReactElement {
    const { navigate } = useReviewNavigation();
    const policies = useContext(AppPolicyContext);
    const inspectionTitle = useRef<HTMLHeadingElement | null>(null);
    const focusInspection = useRef(false);
    const [selectedId, setSelectedId] = useState(() => readQueryParam('object'));
    const [requestedScanId, setRequestedScanId] = useState(() => readQueryParam('scan'));
    const currentLocation = useRef(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    const [inspectedId, setInspectedId] = useState('');
    const [query, setQuery] = useState(() => readQueryParam('query'));
    const [direction, setDirection] = useState(() => readQueryParam('direction') || 'all');
    const [centerGroup, setCenterGroup] = useState(() => readQueryParam('group') || 'all');
    const [relatedGroup, setRelatedGroup] = useState(() => readQueryParam('related') || 'all');
    const [tab, setTab] = useState(() =>
        ['impact', 'changes', 'object', 'review'].includes(readQueryParam('tab')) ? readQueryParam('tab') : 'relationships',
    );
    const [impactDepth, setImpactDepth] = useState(3);
    const [page, setPage] = useState(0);
    const [trail, setTrail] = useState<string[]>([]);
    const evidenceNow = useEvidenceClock();
    const objects = snapshot?.objects ?? EMPTY_OBJECTS;
    const edges = snapshot?.edges ?? EMPTY_EDGES;
    const index = useMemo(() => buildDependencyIndex(objects, edges), [objects, edges]);
    const reviewByObject = useMemo(
        () => new Map(reviews.map((review) => [review.objectId, review])),
        [reviews],
    );
    const freshness = useMemo(() => new Map(reviews.map((review) => [review.objectId,
        compareReviewEvidence(review, index.objects.get(review.objectId), snapshot?.scan, evidenceNow),
    ])), [reviews, index, snapshot?.scan, evidenceNow]);
    const selectedFreshness = (id: string): ReviewFreshness => freshness.get(id) ??
        compareReviewEvidence(null, index.objects.get(id), snapshot?.scan);
    const candidateIds = useMemo(() => {
        const ids = new Set(
            (snapshot?.findings ?? [])
                .filter((finding) => candidateFindingTypes.has(finding.findingType))
                .map((finding) => finding.objectId),
        );
        objects.forEach((item) => {
            if (candidateStatuses.includes(item.healthStatus)) {
                ids.add(item.objectId);
            }
        });
        return ids;
    }, [snapshot, objects]);
    const eligible = useMemo(
        () =>
            objects.filter((item) => matchesGroup(item, centerGroup, candidateIds, reviewByObject, freshness)),
        [objects, centerGroup, candidateIds, reviewByObject, freshness],
    );
    const selectedFromId = index.objects.get(selectedId);
    const requestedOutsideGroup = Boolean(selectedFromId && !eligible.includes(selectedFromId));
    // A supplied identity is a request, never permission to choose an unrelated
    // object. Default centering is only for an entry without an object request.
    let selected: ContentObject | undefined;
    if (!isLoading) {
        if (selectedId) {
            if (!requestedOutsideGroup) { selected = selectedFromId; }
        } else {
            selected = eligible.find((item) => index.inbound.has(item.objectId) || index.outbound.has(item.objectId)) ?? eligible[0];
        }
    }
    const matches = useMemo(() => {
        const normalized = query.trim().toLowerCase().replace(/[_-]+/g, ' ');
        return eligible
            .filter((item) =>
                [item.name, item.canonicalName, item.app, item.objectType].some((value) =>
                    value.toLowerCase().replace(/[_-]+/g, ' ').includes(normalized),
                ),
            )
            .sort((a, b) => a.name.localeCompare(b.name) || a.objectId.localeCompare(b.objectId));
    }, [eligible, query]);
    const options = matches.slice(0, 200);
    if (selected && !options.includes(selected)) {
        options.unshift(selected);
    }
    const allows = useCallback(
        (id: string, edge: DependencyEdge) => {
            const item = index.objects.get(id);
            return (
                relatedGroup === 'all' ||
                (item
                    ? matchesGroup(item, relatedGroup, candidateIds, reviewByObject, freshness)
                    : relatedGroup === 'broken' && edge.confidence !== 'unknown')
            );
        },
        [index, relatedGroup, candidateIds, reviewByObject, freshness],
    );
    const relatedRows = useMemo<RelatedNode[]>(() => {
        if (!selected) {
            return [];
        }
        const adjacent = [
            ...(direction !== 'outbound' ? (index.inbound.get(selected.objectId) ?? []) : []),
            ...(direction !== 'inbound' ? (index.outbound.get(selected.objectId) ?? []) : []),
        ];
        return Array.from(new Map(adjacent.map((edge) => [edge.edgeId, edge])).values())
            .map((edge) => {
                const outbound = edge.sourceId === selected.objectId;
                const id = outbound ? edge.targetId : edge.sourceId;
                const item = index.objects.get(id);
                return item
                    ? {
                          edge,
                          objectId: id,
                          name: item.name,
                          objectType: item.objectType,
                          healthStatus: item.healthStatus,
                          contentObject: item,
                          direction: outbound ? ('outbound' as const) : ('inbound' as const),
                      }
                    : unresolvedNode(edge, id, outbound ? 'outbound' : 'inbound');
            })
            .filter((row) => allows(row.objectId, row.edge))
            .sort(
                (a, b) =>
                    a.direction.localeCompare(b.direction) ||
                    a.name.localeCompare(b.name) ||
                    a.edge.edgeId.localeCompare(b.edge.edgeId),
            );
    }, [selected, index, direction, allows]);
    const graphEdges = useMemo(() => relatedRows.map((row) => row.edge), [relatedRows]);
    const relationshipContexts = useMemo(() => {
        const tracker = createPathContextTracker(index.objects);
        return new Map(relatedRows.map(row => [row.edge.edgeId, tracker.path(row.edge.sourceId, [row.edge])]));
    }, [index, relatedRows]);
    const scan = snapshot?.scan;
    let emptyTitle = 'No verified inventory is cached';
    let emptyExplanation = 'Run a complete live scan from Settings to establish a verified baseline.';
    if (snapshot) {
        emptyTitle = 'No objects match this center group';
        emptyExplanation = 'Clear filters or choose a broader group to continue.';
    }
    if (selectedId) {
        emptyTitle = 'Requested object is unavailable';
        emptyExplanation = 'The requested identity is not in the current verified inventory. It may have changed, be outside the scanning identity’s visibility, or belong to an earlier scan. This is not proof that it was deleted. Choose another object or inspect scan coverage; no substitute has been selected.';
        if (requestedOutsideGroup) {
            emptyTitle = 'Requested object is outside the center group';
            emptyExplanation = 'This object exists in the current inventory but does not match the center group. Show it explicitly or choose another object; no substitute has been selected.';
        }
    }
    if (isLoading) {
        emptyTitle = 'Loading live inventory…';
        emptyExplanation = 'The requested identity is preserved while the verified inventory loads.';
    }
    const impact = useMemo(
        () =>
            selected && scan
                ? analyzeRemovalImpact(selected, objects, edges, reviews, scan, impactDepth, evidenceNow, policies.protection)
                : null,
        [selected, objects, edges, reviews, scan, impactDepth, evidenceNow, policies.protection],
    );
    const detailId = inspectedId || selected?.objectId || '';
    const detail = index.objects.get(detailId);
    const unresolvedEvidence = index.inbound.get(detailId) ?? [];
    const unresolved =
        !detail && unresolvedEvidence[0]
            ? unresolvedNode(unresolvedEvidence[0], detailId, 'outbound')
            : null;
    const detailReview = detail ? (reviewByObject.get(detail.objectId) ?? null) : null;
    useEffect(() => {
        if (focusInspection.current && tab === 'object') {
            inspectionTitle.current?.focus({ preventScroll: true });
            inspectionTitle.current?.scrollIntoView?.({ block: 'start' });
            focusInspection.current = false;
        }
    }, [detailId, tab]);
    const currentPage = Math.min(page, Math.max(0, Math.ceil(relatedRows.length / 25) - 1));
    const pageRows = relatedRows.slice(currentPage * 25, currentPage * 25 + 25);

    useEffect(() => {
        const params = readQueryParams();
        const values = {
            // An automatic preview is not an explicit object request. Only
            // deliberate selections become bookmarks and remain pinned.
            object: selectedId,
            scan: selectedId ? requestedScanId || scan?.scanId || '' : '',
            query,
            direction,
            group: centerGroup,
            related: relatedGroup,
            tab,
        };
        Object.entries(values).forEach(([key, value]) => {
            if (value) {
                params.set(key, value);
            } else {
                params.delete(key);
            }
        });
        const search = serializeQuery(params);
        currentLocation.current = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
        window.history.replaceState(window.history.state, '', currentLocation.current);
    }, [selectedId, selected?.objectId, requestedScanId, scan?.scanId, query, direction, centerGroup, relatedGroup, tab]);

    useEffect(() => {
        const restoreRequest = (): void => {
            const destination = `${window.location.pathname}${window.location.search}${window.location.hash}`;
            const params = readQueryParams();
            // Keep URL and visible center aligned if a review draft blocks Back.
            window.history.replaceState(window.history.state, '', currentLocation.current);
            navigate(() => {
                currentLocation.current = destination;
                window.history.replaceState(window.history.state, '', destination);
                setSelectedId(params.get('object') ?? '');
                setRequestedScanId(params.get('scan') ?? '');
                setQuery(params.get('query') ?? '');
                setDirection(params.get('direction') || 'all');
                setCenterGroup(params.get('group') || 'all');
                setRelatedGroup(params.get('related') || 'all');
                const requestedTab = params.get('tab') ?? '';
                setTab(['impact', 'changes', 'object', 'review'].includes(requestedTab) ? requestedTab : 'relationships');
                setInspectedId(''); setTrail([]); setPage(0);
            });
        };
        window.addEventListener('popstate', restoreRequest);
        return () => window.removeEventListener('popstate', restoreRequest);
    }, [navigate]);

    const drillTo = (id: string): void => navigate(() => {
        const item = index.objects.get(id);
        if (!item) {
            return;
        }
        if (selected) {
            setTrail((current) => [...current, selected.objectId]);
        }
        if (!matchesGroup(item, centerGroup, candidateIds, reviewByObject, freshness)) {
            setCenterGroup('all');
        }
        setSelectedId(id);
        setRequestedScanId(scan?.scanId ?? '');
        setInspectedId('');
        setQuery('');
        setPage(0);
        setTab('relationships');
    });
    const inspect = (id: string, nextTab = 'object'): void => {
        const action = (): void => {
            if (!selectedId && selected) {
                setSelectedId(selected.objectId); setRequestedScanId(scan?.scanId ?? '');
            }
            focusInspection.current = nextTab === 'object'; setInspectedId(id); setTab(nextTab);
        };
        if (id === detailId) { action(); } else { navigate(action); }
    };
    const clear = (): void => navigate(() => {
        setCenterGroup('all');
        setRelatedGroup('all');
        setDirection('all');
        setQuery('');
        setPage(0);
    });
    return (
        <>
            <PageHeader
                title="Dependency Explorer"
                subtitle="Explore consumers and dependencies, inspect the evidence, and assess removal impact."
                actions={
                    selected && impact ? (
                        <ExportMenu label="Export investigation" items={[
                            { label: 'Filtered relationships CSV', disabled: !relatedRows.length,
                                onClick: () => exportRelationships(selected, relatedRows, reviewByObject, policies.protection, relationshipContexts) },
                            { label: 'Filtered relationships JSON', disabled: !relatedRows.length,
                                onClick: () =>
                                    downloadJson('content-hygiene-dependencies.json', {
                                        exportedAt: new Date().toISOString(),
                                        scanId: snapshot?.scan.scanId,
                                        centerObject: selected,
                                        centerAppPolicyProtection: policies.protection.get(selected.objectId) ?? null,
                                        relationships: relatedRows.map((row) => ({
                                            ...row,
                                            pathContext: relationshipContexts.get(row.edge.edgeId),
                                            appPolicyProtection: policies.protection.get(row.objectId) ?? null,
                                            usageValidity: row.contentObject
                                                ? usageValidity(row.contentObject)
                                                : 'not_applicable',
                                        })),
                                    })
                                },
                            { label: 'Full removal impact CSV', onClick: () => exportRemovalImpact(selected, impact) },
                            { label: 'Full removal impact JSON', onClick: () =>
                                    downloadJson('content-hygiene-impact.json', {
                                        exportedAt: new Date().toISOString(),
                                        scanId: snapshot?.scan.scanId,
                                        selectedObject: selected,
                                        usageValidity: usageValidity(selected),
                                        analysis: impact,
                                    })
                                },
                        ]} />
                    ) : undefined
                }
            />
            {trail.length ? (
                <Breadcrumbs aria-label="Dependency drill path">
                    {trail.map((id, i) => (
                        <React.Fragment key={trail.slice(0, i + 1).join('>')}>
                            <RowButton
                                onClick={() => navigate(() => {
                                    setCenterGroup('all');
                                    setSelectedId(id);
                                    setRequestedScanId(scan?.scanId ?? '');
                                    setInspectedId('');
                                    setTrail((current) => current.slice(0, i));
                                    setPage(0);
                                })}
                            >
                                {index.objects.get(id)?.name ?? id}
                            </RowButton>
                            <span aria-hidden="true">›</span>
                        </React.Fragment>
                    ))}
                    <strong>{selected?.name}</strong>
                    <StyledButton onClick={() => setTrail([])}>Reset path</StyledButton>
                </Breadcrumbs>
            ) : null}
            <FilterBar
                aria-label="Dependency explorer controls"
                onSubmit={(event) => event.preventDefault()}
            >
                <FilterField>
                    Center group
                    <Select
                        value={centerGroup}
                        onChange={(event) => navigate(() => {
                            setCenterGroup(event.currentTarget.value);
                            setInspectedId('');
                            setTrail([]);
                            setPage(0);
                        })}
                    >
                        {groupOptions('All inventory objects')}
                    </Select>
                </FilterField>
                <FilterField>
                    Find center object
                    <Input
                        type="search"
                        placeholder="Name, app, or type"
                        value={query}
                        onChange={(event) => setQuery(event.currentTarget.value)}
                    />
                </FilterField>
                <FilterField className="center-object-picker">
                    Selected object
                    <Select
                        disabled={isLoading || !options.length}
                        value={selected?.objectId ?? ''}
                        onChange={(event) => navigate(() => {
                            setSelectedId(event.currentTarget.value);
                            setRequestedScanId(scan?.scanId ?? '');
                            setInspectedId('');
                            setTrail([]);
                            setPage(0);
                        })}
                        footerMessage={
                            matches.length > 200
                                ? `Showing 200 of ${matches.length} matches. Refine Find center object to select any other object.`
                                : undefined
                        }
                    >
                        {!selected ? <option value="" disabled>Choose a center object</option> : null}
                        {options.map((item) => (
                            <option
                                key={item.objectId}
                                value={item.objectId}
                                data-description={`${item.objectType} · ${item.app}`}
                            >
                                {item.name}
                            </option>
                        ))}
                    </Select>
                </FilterField>
                <FilterField>
                    Direction
                    <Select
                        value={direction}
                        onChange={(event) => {
                            setDirection(event.currentTarget.value);
                            setPage(0);
                        }}
                    >
                        <option value="all">Inbound and outbound</option>
                        <option value="inbound">Inbound only</option>
                        <option value="outbound">Outbound only</option>
                    </Select>
                </FilterField>
                <FilterField>
                    Related-object group
                    <Select
                        value={relatedGroup}
                        onChange={(event) => {
                            setRelatedGroup(event.currentTarget.value);
                            setPage(0);
                        }}
                    >
                        {groupOptions('All related results')}
                    </Select>
                </FilterField>
                <StyledButton onClick={clear}>Clear filters</StyledButton>
            </FilterBar>
            {!isLoading && requestedScanId && scan && requestedScanId !== scan.scanId ? (
                <InlineNotice role="status">
                    <strong>Inventory changed since this link was opened</strong>
                    <p>The link came from scan {requestedScanId}; this view uses scan {scan.scanId}. The requested identity is preserved. Review current evidence before relying on an earlier finding.</p>
                </InlineNotice>
            ) : null}
            {!selected ? (
                <Card>
                    <EmptyState>
                        <div>
                            <strong>{emptyTitle}</strong>
                            <p>{emptyExplanation}</p>
                            {selectedId ? <p style={{ overflowWrap: 'anywhere' }}>Requested identity: {selectedId}</p> : null}
                            {requestedOutsideGroup && !isLoading ? (
                                <StyledButton $primary onClick={() => navigate(() => setCenterGroup('all'))}>Show requested object</StyledButton>
                            ) : <StyledButton onClick={clear}>Reset dependency scope</StyledButton>}
                        </div>
                    </EmptyState>
                </Card>
            ) : (
                <DetailLayout>
                    <Card>
                        <WorkspaceHeader style={{ overflowWrap: 'anywhere' }}>
                            <div>
                                <SmallText>Dependency graph center</SmallText>
                                <DetailTitle>{selected.name}</DetailTitle>
                                <p>{selected.objectType} · {selected.app} · {selected.inboundReferences} inbound · {selected.outboundReferences} outbound</p>
                                <StatusBadge status={selected.healthStatus} />
                                <div><AppRetentionLabel objectId={selected.objectId} /></div>
                            </div>
                            <ButtonRow>
                                <StyledButton onClick={() => setTab('impact')}>Assess removal impact</StyledButton>
                                <StyledButton onClick={() => navigate(() => navigateToView('inuse', { object: selected.objectId, scan: snapshot?.scan.scanId }))}>Required content report</StyledButton>
                                <StyledButton $primary onClick={() => inspect(selected.objectId, 'review')}>Review center object</StyledButton>
                                {reviewByObject.has(selected.objectId) ? <StyledButton onClick={() => navigate(() => navigateToView('reviews', { object: selected.objectId }))}>Open center in review library</StyledButton> : null}
                            </ButtonRow>
                        </WorkspaceHeader>
                        <AppRetentionNotice object={selected} />
                        {selected.fieldLineage || ['Automatic Lookup', 'Event Type', 'Tag Binding', 'Workflow Action', 'Navigation Menu'].includes(selected.objectType) || relatedRows.some((row) => isPotentialRelation(row.edge.relation)) ? (
                            <InlineNotice>
                                <strong>Configuration is not execution evidence</strong>
                                <p>Automatic lookups, event types, tag assignments and declared field processing are configured search-time knowledge. “Matches” and “excludes” preserve declared filter semantics; they do not establish observed use. “May” links are potential event-scope, field-input, inactive-state or invoking-app bindings. Confirm effective permissions, namespace overrides, props precedence and field availability before treating a path as a runtime dependency.</p>
                                {['Workflow Action', 'Navigation Menu'].includes(selected.objectType) ? <p>Interaction links retain exact declared destinations, not clicks or execution. Dynamic menu lists, workflow field tokens, inherited app/view context, built-in views and query/fragment bodies can add dependencies. External and POST destinations are never followed.</p> : null}
                            </InlineNotice>
                        ) : null}
                    </Card>
                    <div>
                        <TabLayout
                            activePanelId={tab}
                            onChange={(_event, data) =>
                                setTab(data.activePanelId ?? 'relationships')
                            }
                        >
                            <TabLayout.Panel
                                panelId="relationships"
                                label="Relationships"
                                count={relatedRows.length}
                                inset={false}
                            >
                                <Card>
                                    <CardHeader>
                                        <CardTitle>
                                            {relatedRows.length} matching relationship
                                            {relatedRows.length === 1 ? '' : 's'}
                                        </CardTitle>
                                        <SmallText>Inspect an object without moving the graph center. Choose “Drill in” to follow its own dependencies. Filters affect this view, not the full removal-impact assessment.</SmallText>
                                    </CardHeader>
                                    <CardBody>
                                        {relatedRows.length ? (
                                            <DependencyGraph
                                                key={selected.objectId}
                                                center={selected}
                                                index={index}
                                                edges={graphEdges}
                                                inspectedId={detailId}
                                                onInspect={inspect}
                                                allows={allows}
                                            />
                                        ) : (
                                            <EmptyState>
                                                <div>
                                                    <strong>
                                                        No relationships match this scope
                                                    </strong>
                                                    <p>
                                                        Broaden the direction or related-object
                                                        group. This is not proof of zero impact.
                                                    </p>
                                                    <StyledButton onClick={clear}>
                                                        Broaden relationship scope
                                                    </StyledButton>
                                                </div>
                                            </EmptyState>
                                        )}
                                    </CardBody>
                                </Card>
                                {relatedRows.length ? (
                                    <SpacedBlock>
                                        <Card>
                                            <CardHeader>
                                                <CardTitle>
                                                    Relationship evidence and drill-down
                                                </CardTitle>
                                                <ResultPagination
                                                    page={currentPage}
                                                    pageSize={25}
                                                    total={relatedRows.length}
                                                    onChange={setPage}
                                                />
                                            </CardHeader>
                                            <SmallText>
                                                All matching relationships are included in exports.
                                                The table shows 25 at a time.
                                            </SmallText>
                                            <TableScroller>
                                                <Table>
                                                    <thead>
                                                        <tr>
                                                            <th>Related object</th>
                                                            <th>Direction / relation</th>
                                                            <th>Confidence</th>
                                                            <th>Evidence</th>
                                                            <th>Action</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {pageRows.map((row) => (
                                                            <tr key={row.edge.edgeId}>
                                                                <td>
                                                                    <RowButton
                                                                        onClick={() =>
                                                                            inspect(
                                                                                row.objectId,
                                                                            )
                                                                        }
                                                                    >
                                                                        {row.name}
                                                                    </RowButton>
                                                                    <div>
                                                                        {row.objectType} ·{' '}
                                                                        {row.contentObject?.app ??
                                                                            'Unresolved target'}
                                                                    </div>
                                                                </td>
                                                                <td>
                                                                    {row.direction}
                                                                    <div>
                                                                        {row.edge.relation.replace(
                                                                            /_/g,
                                                                            ' ',
                                                                        )}
                                                                    </div>
                                                                    {isPotentialRelation(row.edge.relation) ? <SmallText>Potential — not observed execution</SmallText> : null}
                                                                </td>
                                                                <td>
                                                                    {row.edge.confidence}
                                                                    <StatusBadge
                                                                        status={row.healthStatus}
                                                                    />
                                                                </td>
                                                                <td>
                                                                    {row.edge.evidence}
                                                                    <SmallText>
                                                                        {row.edge.sourceLocation}
                                                                    </SmallText>
                                                                    {relationshipContexts.get(row.edge.edgeId) ? <SmallText>{PATH_CONTEXT_LABELS[relationshipContexts.get(row.edge.edgeId)!.status]}</SmallText> : null}
                                                                </td>
                                                                <td>
                                                                    <StyledButton
                                                                        onClick={() =>
                                                                            drillTo(row.objectId)
                                                                        }
                                                                        disabled={
                                                                            !row.contentObject
                                                                        }
                                                                    >
                                                                        Drill in
                                                                    </StyledButton>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </Table>
                                            </TableScroller>
                                        </Card>
                                    </SpacedBlock>
                                ) : null}
                            </TabLayout.Panel>
                            <TabLayout.Panel panelId="impact" label="Removal impact" inset={false}>
                                {impact ? (
                                    <RemovalImpactPanel
                                        key={selected.objectId}
                                        selected={selected}
                                        analysis={impact}
                                        depth={impactDepth}
                                        onDepthChange={setImpactDepth}
                                        onDrillTo={drillTo}
                                    />
                                ) : null}
                            </TabLayout.Panel>
                            <TabLayout.Panel panelId="changes" label="Changes since review" inset={false}>
                                <Card>
                                    <CardHeader><CardTitle>What changed since this review?</CardTitle></CardHeader>
                                    <CardBody>
                                        <ReviewFreshnessPanel
                                            key={selected.objectId}
                                            objectId={selected.objectId}
                                            comparison={selectedFreshness(selected.objectId)}
                                            canDrillTo={(id) => index.objects.has(id)}
                                            onDrillTo={(id) => {
                                                drillTo(id);
                                                setDirection('all');
                                                setRelatedGroup('all');
                                                setTab('relationships');
                                            }}
                                        />
                                        <InlineNotice>
                                            This comparison uses the full captured direct neighborhood, independent
                                            of relationship filters. Removal impact always uses the full current graph.
                                        </InlineNotice>
                                    </CardBody>
                                </Card>
                            </TabLayout.Panel>
                            <TabLayout.Panel panelId="object" label="Selected object" inset={false}>
                    <DetailPanel
                        aria-label={`Details for ${detail?.name ?? unresolved?.name ?? detailId}`}
                    >
                        <DetailSection>
                            <DetailTitle ref={inspectionTitle} tabIndex={-1}>
                                {detail?.name ?? unresolved?.name ?? detailId}
                            </DetailTitle>
                            <SmallText>
                                {detailId === selected.objectId
                                    ? 'Center object'
                                    : `Selected for inspection · graph center remains ${selected.name}`}
                            </SmallText>
                            {detail ? (
                                <ButtonRow>
                                    <StatusBadge status={detail.healthStatus} />
                                    {detailReview ? (
                                        <ReviewStageBadge stage={detailReview.stage} />
                                    ) : null}
                                    <ReviewFreshnessBadge status={selectedFreshness(detail.objectId).status} />
                                    <StyledButton onClick={() => navigate(() => {
                                        if (detail.objectId !== selected.objectId) { drillTo(detail.objectId); }
                                        setTab('changes');
                                    })}>Changes since review</StyledButton>
                                    {detailId !== selected.objectId ? (
                                        <StyledButton $primary onClick={() => drillTo(detailId)}>
                                            Center on this object
                                        </StyledButton>
                                    ) : null}
                                    <StyledButton onClick={() => setTab('review')}>Review selected object</StyledButton>
                                    <StyledButton onClick={() => navigate(() => navigateToView('candidates', { object: detail.objectId }))}>View candidate evidence</StyledButton>
                                    {detailReview ? <StyledButton onClick={() => navigate(() => navigateToView('reviews', { object: detail.objectId }))}>Open in review library</StyledButton> : null}
                                </ButtonRow>
                            ) : (
                                <InlineNotice>
                                    This target is unresolved. Inspect the namespace, collector
                                    coverage, and source evidence before calling it missing.
                                </InlineNotice>
                            )}
                        </DetailSection>
                        {detail ? (
                            <>
                                <DetailSection>
                                    <FactGrid>
                                        <dt>Type</dt>
                                        <dd>{detail.objectType}</dd>
                                        <dt>App</dt>
                                        <dd>{detail.app}</dd>
                                        <dt>Owner</dt>
                                        <dd>{ownerLabel(detail)}</dd>
                                        <dt>All inbound refs</dt>
                                        <dd>{detail.inboundReferences}</dd>
                                        <dt>All outbound refs</dt>
                                        <dd>{detail.outboundReferences}</dd>
                                        <dt>Abandonment confidence</dt>
                                        <dd>{formatScore(detail.abandonmentConfidence)}</dd>
                                        <dt>Removal impact</dt>
                                        <dd>{formatScore(detail.removalImpact)}</dd>
                                    </FactGrid>
                                    {detail.analysisWarnings?.length ? (
                                        <InlineNotice>
                                            {detail.analysisWarnings.join('; ')}
                                        </InlineNotice>
                                    ) : null}
                                </DetailSection>
                                <DetailSection>
                                    <FieldLineagePanel object={detail} />
                                    <UsageEvidencePanel contentObject={detail} />
                                </DetailSection>
                                <DetailSection>
                                    <strong>Recorded evidence</strong>
                                    <ul>
                                        {detail.evidence.map((item) => (
                                            <li key={item}>{item}</li>
                                        ))}
                                    </ul>
                                </DetailSection>
                            </>
                        ) : (
                            <DetailSection>
                                <DefinitionList>
                                    <dt>Target identity</dt>
                                    <dd>{detailId}</dd>
                                </DefinitionList>
                                <ul>
                                    {unresolvedEvidence.slice(0, 25).map((edge) => (
                                        <li key={edge.edgeId}>
                                            {edge.evidence} [{edge.sourceLocation}]
                                        </li>
                                    ))}
                                </ul>
                                <SmallText>
                                    {unresolvedEvidence.length} captured references. Relationship
                                    exports retain the complete evidence.
                                </SmallText>
                            </DetailSection>
                        )}
                    </DetailPanel>
                            </TabLayout.Panel>
                            <TabLayout.Panel panelId="review" label="Review decision" inset={false}>
                                <Card><CardHeader><CardTitle>Review {detail?.name ?? 'unresolved target'}</CardTitle></CardHeader><CardBody>
                                    {detail ? <ReviewEditor key={detail.objectId} contentObject={detail} review={detailReview}
                                        scanId={snapshot?.scan.scanId ?? ''} canWrite={canWriteReviews}
                                        onSave={onSaveReview} onDelete={onDeleteReview} />
                                        : <InlineNotice>Unresolved targets cannot be added to the library. Inspect source evidence and namespace coverage first.</InlineNotice>}
                                </CardBody></Card>
                            </TabLayout.Panel>
                        </TabLayout>
                    </div>
                </DetailLayout>
            )}
        </>
    );
}
const EMPTY_OBJECTS: ContentObject[] = [];
const EMPTY_EDGES: DependencyEdge[] = [];
