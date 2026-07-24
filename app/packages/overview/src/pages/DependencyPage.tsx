import React, { useState } from 'react';
import {
    Breadcrumbs,
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
    GraphCanvas,
    GraphSvg,
    InlineNotice,
    Input,
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
import { reviewStageOptions } from '../services/reviews';
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
import { navigateToView, readQueryParam } from '../utils/navigation';

const nodeStatusColors = {
    active: '#4fae58',
    dormant: '#e5a632',
    orphaned: '#db584c',
    broken: '#d83b3b',
    unowned: '#4f8ed8',
    protected: '#6c8ebf',
    unknown: '#8b949e',
} as const;
const GRAPH_EDGE_LIMIT = 16;
const candidateFindingTypes = new Set([
    'cleanup_candidate',
    'broken_reference',
    'unowned',
    'needs_review',
    'repair_required',
]);
const candidateStatuses: HealthStatus[] = [
    'dormant',
    'orphaned',
    'broken',
    'unowned',
];

interface DependencyPageProps {
    snapshot: InventorySnapshot | null;
    isLoading: boolean;
    reviews: ReviewRecord[];
    canWriteReviews: boolean;
    onSaveReview: (input: ReviewInput) => Promise<ReviewRecord>;
    onDeleteReview: (objectId: string) => Promise<void>;
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

function truncate(value: string, length = 24): string {
    return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function formatScore(value: number | null): string {
    return value === null ? 'Unknown' : `${value}/100`;
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

function unresolvedNode(
    edge: DependencyEdge,
    objectId: string,
    direction: RelatedNode['direction']
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
    reviewByObject: Map<string, ReviewRecord>
): boolean {
    if (group === 'all') {
        return true;
    }
    if (group === 'candidates') {
        return candidateIds.has(contentObject.objectId);
    }
    if (group === 'in_library') {
        return reviewByObject.has(contentObject.objectId);
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
    reviewByObject: Map<string, ReviewRecord>
): void {
    downloadCsv(
        `content-hygiene-dependencies-${selected.name}.csv`,
        [
            'Center object ID',
            'Center object',
            'Direction',
            'Related object ID',
            'Related object',
            'Related type',
            'Related health',
            'Related review stage',
            'Relation',
            'Confidence',
            'Resolved',
            'Evidence',
            'Source location',
        ],
        rows.map((row) => [
            selected.objectId,
            selected.name,
            row.direction,
            row.objectId,
            row.name,
            row.objectType,
            row.healthStatus,
            reviewByObject.get(row.objectId)?.stage ?? '',
            row.edge.relation,
            row.edge.confidence,
            row.edge.resolved,
            row.edge.evidence,
            row.edge.sourceLocation,
        ])
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
    const [selectedId, setSelectedId] = useState(readQueryParam('object'));
    const [query, setQuery] = useState(readQueryParam('query'));
    const [direction, setDirection] = useState(
        readQueryParam('direction') || 'all'
    );
    const [centerGroup, setCenterGroup] = useState(
        readQueryParam('group') || 'all'
    );
    const [relatedGroup, setRelatedGroup] = useState('all');
    const [trail, setTrail] = useState<string[]>([]);
    const objects = snapshot?.objects ?? [];
    const edges = snapshot?.edges ?? [];
    const reviewByObject = new Map(
        reviews.map((review) => [review.objectId, review])
    );
    const candidateIds = new Set(
        (snapshot?.findings ?? [])
            .filter((finding) =>
                candidateFindingTypes.has(finding.findingType)
            )
            .map((finding) => finding.objectId)
    );
    objects.forEach((contentObject) => {
        if (candidateStatuses.includes(contentObject.healthStatus)) {
            candidateIds.add(contentObject.objectId);
        }
    });
    const objectById = new Map(
        objects.map((contentObject) => [
            contentObject.objectId,
            contentObject,
        ])
    );
    const eligibleCenterObjects = objects.filter((contentObject) =>
        matchesGroup(
            contentObject,
            centerGroup,
            candidateIds,
            reviewByObject
        )
    );
    const defaultObject =
        eligibleCenterObjects.find((contentObject) =>
            edges.some(
                (edge) =>
                    edge.sourceId === contentObject.objectId ||
                    edge.targetId === contentObject.objectId
            )
        ) ?? eligibleCenterObjects[0];
    const selectedFromId = objectById.get(selectedId);
    const selected =
        selectedFromId &&
        matchesGroup(
            selectedFromId,
            centerGroup,
            candidateIds,
            reviewByObject
        )
            ? selectedFromId
            : defaultObject;
    const normalizedQuery = query.trim().toLowerCase();
    const matchingObjects = eligibleCenterObjects
        .filter((contentObject) => {
            if (!normalizedQuery) {
                return true;
            }
            return [
                contentObject.name,
                contentObject.canonicalName,
                contentObject.app,
                contentObject.objectType,
            ].some((value) => value.toLowerCase().includes(normalizedQuery));
        })
        .slice(0, 200);
    const objectOptions =
        selected &&
        !matchingObjects.some(
            (contentObject) => contentObject.objectId === selected.objectId
        )
            ? [selected, ...matchingObjects]
            : matchingObjects;
    const directionalEdges = selected
        ? edges.filter(
              (edge) =>
                  (direction === 'all' &&
                      (edge.sourceId === selected.objectId ||
                          edge.targetId === selected.objectId)) ||
                  (direction === 'outbound' &&
                      edge.sourceId === selected.objectId) ||
                  (direction === 'inbound' &&
                      edge.targetId === selected.objectId)
          )
        : [];
    const relatedRows: RelatedNode[] = selected
        ? directionalEdges
              .map((edge) => {
                  const selectedIsSource = edge.sourceId === selected.objectId;
                  const relatedId = selectedIsSource
                      ? edge.targetId
                      : edge.sourceId;
                  const relatedObject = objectById.get(relatedId);
                  const rowDirection: RelatedNode['direction'] = selectedIsSource
                      ? 'outbound'
                      : 'inbound';
                  return relatedObject
                      ? {
                            edge,
                            objectId: relatedObject.objectId,
                            name: relatedObject.name,
                            objectType: relatedObject.objectType,
                            healthStatus: relatedObject.healthStatus,
                            contentObject: relatedObject,
                            direction: rowDirection,
                        }
                      : unresolvedNode(edge, relatedId, rowDirection);
              })
              .filter(
                  (row) =>
                      relatedGroup === 'all' ||
                      (row.contentObject
                          ? matchesGroup(
                                row.contentObject,
                                relatedGroup,
                                candidateIds,
                                reviewByObject
                            )
                          : relatedGroup === 'broken')
              )
        : [];
    const graphRows = relatedRows.slice(0, GRAPH_EDGE_LIMIT);
    const selectedReview = selected
        ? reviewByObject.get(selected.objectId) ?? null
        : null;
    let emptyTitle = 'No live inventory is cached';
    if (isLoading) {
        emptyTitle = 'Loading live inventory…';
    } else if (centerGroup !== 'all') {
        emptyTitle = 'No objects match this center group';
    }

    const drillTo = (objectId: string): void => {
        const nextObject = objectById.get(objectId);
        if (!selected || !nextObject) {
            return;
        }
        if (
            !matchesGroup(
                nextObject,
                centerGroup,
                candidateIds,
                reviewByObject
            )
        ) {
            setCenterGroup('all');
        }
        setTrail((current) => [...current, selected.objectId]);
        setSelectedId(objectId);
        setQuery('');
    };

    const drillBack = (index: number): void => {
        const targetId = trail[index];
        setSelectedId(targetId);
        setTrail((current) => current.slice(0, index));
    };

    return (
        <>
            <PageHeader
                title="Dependency Explorer"
                subtitle="Drill through live relationship evidence and restrict either side of the graph to a cleanup or review-library group."
                actions={
                    selected ? (
                        <ButtonRow>
                            <StyledButton
                                type="button"
                                onClick={() =>
                                    exportRelationships(
                                        selected,
                                        relatedRows,
                                        reviewByObject
                                    )
                                }
                                disabled={relatedRows.length === 0}
                            >
                                Export relationships CSV
                            </StyledButton>
                            <StyledButton
                                type="button"
                                onClick={() =>
                                    downloadJson(
                                        `content-hygiene-dependencies-${selected.name}.json`,
                                        {
                                            exportedAt: new Date().toISOString(),
                                            scanId:
                                                snapshot?.scan.scanId ?? null,
                                            centerObject: selected,
                                            centerReview: selectedReview,
                                            relationships: relatedRows.map(
                                                (row) => ({
                                                    edge: row.edge,
                                                    direction: row.direction,
                                                    relatedObject:
                                                        row.contentObject,
                                                    unresolvedObjectId:
                                                        row.contentObject
                                                            ? null
                                                            : row.objectId,
                                                    relatedReview:
                                                        reviewByObject.get(
                                                            row.objectId
                                                        ) ?? null,
                                                })
                                            ),
                                        }
                                    )
                                }
                                disabled={relatedRows.length === 0}
                            >
                                Export relationships JSON
                            </StyledButton>
                        </ButtonRow>
                    ) : undefined
                }
            />

            {selected ? (
                <>
                    {trail.length > 0 ? (
                        <Breadcrumbs aria-label="Dependency drill path">
                            {trail.map((objectId, index) => (
                                <React.Fragment
                                    key={`${objectId}-${index.toString()}`}
                                >
                                    <RowButton
                                        type="button"
                                        onClick={() => drillBack(index)}
                                    >
                                        {objectById.get(objectId)?.name ??
                                            objectId}
                                    </RowButton>
                                    <span aria-hidden="true">›</span>
                                </React.Fragment>
                            ))}
                            <strong>{selected.name}</strong>
                            <StyledButton
                                type="button"
                                onClick={() => {
                                    setTrail([]);
                                    setSelectedId('');
                                }}
                            >
                                Reset path
                            </StyledButton>
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
                                onChange={(event) => {
                                    setCenterGroup(event.currentTarget.value);
                                    setSelectedId('');
                                    setTrail([]);
                                }}
                            >
                                <option value="all">All inventory objects</option>
                                <option value="candidates">
                                    All cleanup candidates
                                </option>
                                {candidateStatuses.map((status) => (
                                    <option key={status} value={status}>
                                        Candidate group: {status}
                                    </option>
                                ))}
                                <option value="in_library">
                                    Any review-library record
                                </option>
                                {reviewStageOptions.map((option) => (
                                    <option
                                        key={option.value}
                                        value={option.value}
                                    >
                                        Review stage: {option.label}
                                    </option>
                                ))}
                            </Select>
                        </FilterField>
                        <FilterField>
                            Find center object
                            <Input
                                type="search"
                                value={query}
                                placeholder="Name, app, or type"
                                onChange={(event) =>
                                    setQuery(event.currentTarget.value)
                                }
                            />
                        </FilterField>
                        <FilterField>
                            Selected object
                            <Select
                                value={selected.objectId}
                                onChange={(event) => {
                                    setSelectedId(event.currentTarget.value);
                                    setTrail([]);
                                }}
                            >
                                {objectOptions.map((contentObject) => (
                                    <option
                                        value={contentObject.objectId}
                                        key={contentObject.objectId}
                                    >
                                        {contentObject.name} —{' '}
                                        {contentObject.objectType}
                                    </option>
                                ))}
                            </Select>
                        </FilterField>
                        <FilterField>
                            Direction
                            <Select
                                value={direction}
                                onChange={(event) =>
                                    setDirection(event.currentTarget.value)
                                }
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
                                onChange={(event) =>
                                    setRelatedGroup(event.currentTarget.value)
                                }
                            >
                                <option value="all">All related results</option>
                                <option value="candidates">
                                    Cleanup candidates only
                                </option>
                                {candidateStatuses.map((status) => (
                                    <option key={status} value={status}>
                                        Candidate group: {status}
                                    </option>
                                ))}
                                <option value="in_library">
                                    Review library only
                                </option>
                                {reviewStageOptions.map((option) => (
                                    <option
                                        key={option.value}
                                        value={option.value}
                                    >
                                        Review stage: {option.label}
                                    </option>
                                ))}
                            </Select>
                        </FilterField>
                    </FilterBar>

                    <InlineNotice>
                        The graph shows up to {GRAPH_EDGE_LIMIT} matching
                        relationships. The table and exports include all{' '}
                        {relatedRows.length}. Unresolved references remain visible
                        as evidence but cannot be drilled into.
                    </InlineNotice>

                    <DetailLayout>
                        <div>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        {relatedRows.length} matching
                                        relationship
                                        {relatedRows.length === 1 ? '' : 's'}
                                    </CardTitle>
                                </CardHeader>
                                {relatedRows.length === 0 ? (
                                    <EmptyState>
                                        <div>
                                            <strong>
                                                No relationships match this scope
                                            </strong>
                                            <p>
                                                Clear the related-object group or
                                                direction filter to broaden the
                                                graph.
                                            </p>
                                        </div>
                                    </EmptyState>
                                ) : (
                                    <GraphCanvas>
                                        <GraphSvg
                                            viewBox="0 0 760 440"
                                            role="img"
                                            aria-label={`Dependency graph centered on ${selected.name}`}
                                        >
                                            <defs>
                                                <marker
                                                    id="arrow"
                                                    markerWidth="8"
                                                    markerHeight="8"
                                                    refX="7"
                                                    refY="4"
                                                    orient="auto"
                                                >
                                                    <path
                                                        d="M0,0 L8,4 L0,8 z"
                                                        fill="currentColor"
                                                    />
                                                </marker>
                                            </defs>

                                            {graphRows.map((row, index) => {
                                                const angle =
                                                    (Math.PI * 2 * index) /
                                                        Math.max(
                                                            graphRows.length,
                                                            1
                                                        ) -
                                                    Math.PI / 2;
                                                const relatedX =
                                                    380 +
                                                    Math.cos(angle) * 265;
                                                const relatedY =
                                                    210 +
                                                    Math.sin(angle) * 155;
                                                const outbound =
                                                    row.direction === 'outbound';
                                                return (
                                                    <g key={row.edge.edgeId}>
                                                        <line
                                                            className={
                                                                row.edge
                                                                    .confidence ===
                                                                'low'
                                                                    ? 'edge edge-warning'
                                                                    : 'edge'
                                                            }
                                                            x1={
                                                                outbound
                                                                    ? 380
                                                                    : relatedX
                                                            }
                                                            y1={
                                                                outbound
                                                                    ? 210
                                                                    : relatedY
                                                            }
                                                            x2={
                                                                outbound
                                                                    ? relatedX
                                                                    : 380
                                                            }
                                                            y2={
                                                                outbound
                                                                    ? relatedY
                                                                    : 210
                                                            }
                                                            markerEnd="url(#arrow)"
                                                        />
                                                        <text
                                                            x={
                                                                (380 +
                                                                    relatedX) /
                                                                2
                                                            }
                                                            y={
                                                                (210 +
                                                                    relatedY) /
                                                                    2 -
                                                                8
                                                            }
                                                            fontSize="12"
                                                            textAnchor="middle"
                                                        >
                                                            {row.edge.relation}
                                                        </text>
                                                    </g>
                                                );
                                            })}

                                            {graphRows.map((row, index) => {
                                                const angle =
                                                    (Math.PI * 2 * index) /
                                                        Math.max(
                                                            graphRows.length,
                                                            1
                                                        ) -
                                                    Math.PI / 2;
                                                const x =
                                                    380 +
                                                    Math.cos(angle) * 265;
                                                const y =
                                                    210 +
                                                    Math.sin(angle) * 155;
                                                return (
                                                    <g
                                                        key={row.edge.edgeId}
                                                        transform={`translate(${x - 80} ${y - 32})`}
                                                    >
                                                        <rect
                                                            className="node"
                                                            width="160"
                                                            height="64"
                                                            rx="5"
                                                        />
                                                        <circle
                                                            cx="14"
                                                            cy="17"
                                                            r="5"
                                                            fill={
                                                                nodeStatusColors[
                                                                    row
                                                                        .healthStatus
                                                                ]
                                                            }
                                                        />
                                                        <text
                                                            x="26"
                                                            y="21"
                                                            fontSize="13"
                                                        >
                                                            {truncate(row.name)}
                                                        </text>
                                                        <text
                                                            x="14"
                                                            y="45"
                                                            fontSize="11"
                                                        >
                                                            {row.objectType}
                                                        </text>
                                                    </g>
                                                );
                                            })}

                                            <g transform="translate(280 166)">
                                                <rect
                                                    className="node node-selected"
                                                    width="200"
                                                    height="88"
                                                    rx="6"
                                                />
                                                <circle
                                                    cx="18"
                                                    cy="22"
                                                    r="6"
                                                    fill={
                                                        nodeStatusColors[
                                                            selected.healthStatus
                                                        ]
                                                    }
                                                />
                                                <text
                                                    x="32"
                                                    y="27"
                                                    fontSize="16"
                                                    fontWeight="600"
                                                >
                                                    {truncate(selected.name, 27)}
                                                </text>
                                                <text
                                                    x="18"
                                                    y="52"
                                                    fontSize="12"
                                                >
                                                    {selected.objectType}
                                                </text>
                                                <text
                                                    x="18"
                                                    y="72"
                                                    fontSize="11"
                                                >
                                                    {selected.app}
                                                </text>
                                            </g>
                                        </GraphSvg>
                                    </GraphCanvas>
                                )}
                            </Card>

                            {relatedRows.length > 0 ? (
                                <Card>
                                    <CardHeader>
                                        <CardTitle>
                                            Relationship evidence and drill-down
                                        </CardTitle>
                                    </CardHeader>
                                    <TableScroller>
                                        <Table>
                                            <thead>
                                                <tr>
                                                    <th scope="col">Related object</th>
                                                    <th scope="col">Direction</th>
                                                    <th scope="col">Relation</th>
                                                    <th scope="col">Confidence</th>
                                                    <th scope="col">Status</th>
                                                    <th scope="col">Review</th>
                                                    <th scope="col">Evidence</th>
                                                    <th scope="col">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {relatedRows.map((row) => (
                                                    <tr key={row.edge.edgeId}>
                                                        <td>
                                                            {row.contentObject ? (
                                                                <RowButton
                                                                    type="button"
                                                                    onClick={() =>
                                                                        drillTo(
                                                                            row.objectId
                                                                        )
                                                                    }
                                                                >
                                                                    {row.name}
                                                                </RowButton>
                                                            ) : (
                                                                row.name
                                                            )}
                                                            <div>
                                                                {row.objectType}
                                                            </div>
                                                        </td>
                                                        <td>{row.direction}</td>
                                                        <td>{row.edge.relation}</td>
                                                        <td>
                                                            {row.edge.confidence}
                                                        </td>
                                                        <td>
                                                            <StatusBadge
                                                                status={
                                                                    row.healthStatus
                                                                }
                                                            />
                                                        </td>
                                                        <td>
                                                            {reviewByObject.has(
                                                                row.objectId
                                                            ) ? (
                                                                <ReviewStageBadge
                                                                    stage={
                                                                        reviewByObject.get(
                                                                            row.objectId
                                                                        )!.stage
                                                                    }
                                                                />
                                                            ) : (
                                                                '—'
                                                            )}
                                                        </td>
                                                        <td>
                                                            {row.edge.evidence}
                                                            {row.edge
                                                                .sourceLocation
                                                                ? ` [${row.edge.sourceLocation}]`
                                                                : ''}
                                                        </td>
                                                        <td>
                                                            <StyledButton
                                                                type="button"
                                                                disabled={
                                                                    !row.contentObject
                                                                }
                                                                onClick={() =>
                                                                    drillTo(
                                                                        row.objectId
                                                                    )
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
                            ) : null}
                        </div>

                        <DetailPanel aria-label={`Details for ${selected.name}`}>
                            <DetailSection>
                                <DetailTitle>{selected.name}</DetailTitle>
                                <ButtonRow>
                                    <StatusBadge
                                        status={selected.healthStatus}
                                    />
                                    {selectedReview ? (
                                        <ReviewStageBadge
                                            stage={selectedReview.stage}
                                        />
                                    ) : null}
                                </ButtonRow>
                            </DetailSection>
                            <DetailSection>
                                <DefinitionList>
                                    <dt>Type</dt>
                                    <dd>{selected.objectType}</dd>
                                    <dt>App</dt>
                                    <dd>{selected.app}</dd>
                                    <dt>Owner</dt>
                                    <dd>{ownerLabel(selected)}</dd>
                                    <dt>All inbound refs</dt>
                                    <dd>{selected.inboundReferences}</dd>
                                    <dt>All outbound refs</dt>
                                    <dd>{selected.outboundReferences}</dd>
                                    <dt>Visible after filters</dt>
                                    <dd>{relatedRows.length}</dd>
                                </DefinitionList>
                            </DetailSection>
                            <DetailSection>
                                <strong>Impact context</strong>
                                <DefinitionList>
                                    <dt>Abandonment confidence</dt>
                                    <dd>
                                        {formatScore(
                                            selected.abandonmentConfidence
                                        )}
                                    </dd>
                                    <dt>Removal impact</dt>
                                    <dd>
                                        {formatScore(selected.removalImpact)}
                                    </dd>
                                </DefinitionList>
                            </DetailSection>
                            <DetailSection>
                                <ButtonRow>
                                    <StyledButton
                                        type="button"
                                        onClick={() =>
                                            navigateToView('candidates', {
                                                object: selected.objectId,
                                            })
                                        }
                                        disabled={
                                            !candidateIds.has(selected.objectId)
                                        }
                                    >
                                        View candidate evidence
                                    </StyledButton>
                                    {selectedReview ? (
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
                                    review={selectedReview}
                                    scanId={snapshot?.scan.scanId ?? ''}
                                    canWrite={canWriteReviews}
                                    onSave={onSaveReview}
                                    onDelete={onDeleteReview}
                                />
                            </DetailSection>
                        </DetailPanel>
                    </DetailLayout>
                </>
            ) : (
                <Card>
                    <EmptyState>
                        <div>
                            <strong>
                                {emptyTitle}
                            </strong>
                            <p>
                                {centerGroup === 'all'
                                    ? 'Run a bounded live scan from Settings before exploring dependencies.'
                                    : 'Choose a broader center group to continue.'}
                            </p>
                        </div>
                    </EmptyState>
                </Card>
            )}
        </>
    );
}
