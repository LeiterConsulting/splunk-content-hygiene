import { ContentObject, DependencyEdge, InventorySnapshot, ReviewRecord } from '../types';
import { compareReviewEvidence } from './reviewEvidence';
import { usageSourceForObject, usageValidity } from './usage';
import { isPotentialRelation } from '../utils/dependencySemantics';

export interface InUseOptions {
    activity: 'all' | 'dashboard_view' | 'saved_search_execution' | 'none';
    includeRetained: boolean;
    successfulOnly: boolean;
    selectedIds?: string[];
    maxObjects?: number;
    maxEdges?: number;
}
export interface InUseReason {
    kind: 'observed' | 'retained' | 'selected';
    detail: string;
    reviewer?: string;
    reviewedAt?: string;
    revisionId?: string;
    evidenceStatus?: string;
}
export interface InUseRow {
    objectId: string;
    name: string;
    objectType: string;
    app: string;
    owner: string | null;
    sharing: string | null;
    inInventory: boolean;
    reasons: InUseReason[];
    via?: {
        rootId: string;
        parentId: string;
        edgeId: string;
        relation: string;
        depth: number;
        confidence: DependencyEdge['confidence'];
        conditional: boolean;
        fieldProvenance?: DependencyEdge['fieldProvenance'];
    };
    usage: ContentObject['usageEvidence'];
    usageValidity: string;
    outboundCoverage: string;
    outboundLimitations: string[];
    fieldLineage?: ContentObject['fieldLineage'];
}
export interface InUseReport {
    scanId: string;
    generatedAt: string;
    options: InUseOptions;
    usage: InventorySnapshot['usage'];
    rows: InUseRow[];
    relationships: DependencyEdge[];
    groups: Record<string, number>;
    rootCount: number;
    coverage: 'partial';
    truncated: boolean;
    gaps: string[];
}
const implicitGaps = [
    'This is a supported shared static dependency footprint, not a complete migration manifest or proof that excluded objects are unused.',
    'Shared event types and distinct tag assignments have bounded literal-reference coverage. Implicit classification, wildcard names, encoded tag values, system inheritance and invoking-app contexts are not exhaustively resolved.',
    'Field extractions, aliases, calculated fields and transforms have bounded declared-metadata coverage. Potential field paths respect extraction → alias → parallel calculated fields → lookup. Supported capture declarations do not prove regex validity, matches or field availability; dynamic outputs, cross-scope precedence and chaining remain unverified. Workflow actions and navigation menus are outside inventory.',
    'Automatic props lookup rules and exact-selector caller matches cover only part of search-time props. Patterns, precedence, renames, field availability and inherited invocation contexts remain unverified; potential paths do not establish execution.',
    'Ad-hoc searches, private content, dynamic SPL/tokens and external consumers may require additional objects.',
    'App-containment and ownership links are metadata, not dependency closure. Retaining an app is not an app-wide retain rule.',
    'Each required object has one shortest supported witness path; the exported relationships also preserve other traversed paths.',
];

/** Multi-source BFS: finite graph closure, no recursive or arbitrary hop cutoff. */
export function buildInUseReport(
    snapshot: InventorySnapshot,
    reviews: ReviewRecord[],
    options: InUseOptions,
    now = Date.now(),
    reviewsVerified = true,
): InUseReport {
    const objects = new Map(snapshot.objects.map((object) => [object.objectId, object]));
    const rows = new Map<string, InUseRow>();
    const gaps = new Set(implicitGaps);
    if (!Object.prototype.hasOwnProperty.call(snapshot.scan.collectorCounts, 'automatic_lookups')) {
        gaps.add('This snapshot predates automatic lookup collection. Run a new complete scan to assess that catalog.');
    }
    if (!['event_types', 'tag_bindings'].every(collector => Object.prototype.hasOwnProperty.call(snapshot.scan.collectorCounts, collector))) {
        gaps.add('This snapshot predates event-type/tag collection. Run a new complete scan to assess these catalogs; existing decisions are unchanged.');
    }
    if (!['field_extractions', 'field_aliases', 'calculated_fields', 'field_transforms'].every(collector => Object.prototype.hasOwnProperty.call(snapshot.scan.collectorCounts, collector))) {
        gaps.add('This snapshot predates field-lineage collection. Run a new complete scan; absence of these paths does not establish that a field definition is unused.');
    }
    const maxObjects = Math.max(1, options.maxObjects ?? 50000);
    const maxEdges = Math.max(1, options.maxEdges ?? 250000);
    let truncated = false;
    const add = (id: string, fallback?: ReviewRecord): InUseRow | null => {
        if (rows.has(id)) {
            return rows.get(id)!;
        }
        if (rows.size >= maxObjects) {
            truncated = true;
            return null;
        }
        const object = objects.get(id);
        const row: InUseRow = {
            objectId: id,
            name: object?.name ?? fallback?.objectName ?? id,
            objectType: object?.objectType ?? fallback?.objectType ?? 'Unresolved reference',
            app: object?.app ?? fallback?.app ?? 'Unknown',
            owner: object?.owner ?? fallback?.owner ?? null,
            sharing: object?.sharing ?? null,
            inInventory: Boolean(object && !/^Unresolved\b/i.test(object.objectType)),
            reasons: [],
            usage: object?.usageEvidence ?? null,
            ...(object?.fieldLineage ? { fieldLineage: object.fieldLineage } : {}),
            usageValidity: object
                ? usageValidity(object, snapshot.scan.scanId, now)
                : 'not_measured',
            outboundCoverage: object?.reviewEvidence?.coverage?.outbound.status ?? 'unavailable',
            outboundLimitations: object?.reviewEvidence?.coverage?.outbound.reasons ?? [
                'No current declared-outbound coverage manifest is available.',
            ],
        };
        rows.set(id, row);
        return row;
    };
    if (snapshot.scan.status !== 'succeeded' || snapshot.scan.analysisStatus !== 'complete') {
        gaps.add(
            'The source inventory or dependency analysis is partial; inspect scan diagnostics.',
        );
    }
    snapshot.scan.warnings.forEach((warning) => gaps.add(warning));
    snapshot.scan.errors.forEach((error) => gaps.add(error));
    if (snapshot.edges.length !== snapshot.scan.edgeCount) {
        gaps.add(
            'The cached relationship count does not match the scan manifest; dependency coverage cannot be verified.',
        );
    }
    const { usage } = snapshot;
    usage?.warnings.forEach((warning) => gaps.add(`Usage evidence: ${warning}`));
    usage?.sources.forEach((source) => {
        const warning = source.warning ? `${source.label}: ${source.warning}` : null;
        if (
            source.coverage !== 'complete' ||
            source.truncated ||
            (warning && !usage?.warnings.includes(warning))
        ) {
            gaps.add(
                `${source.label}: ${source.coverage} usage coverage${source.truncated ? '; activity results truncated' : ''}${source.warning ? `; ${source.warning}` : ''}`,
            );
        }
    });
    const currentWindow = Boolean(
        usage?.matchesCurrentInventory && usage.inventoryScanId === snapshot.scan.scanId,
    );
    if (!currentWindow || usage?.coverage !== 'complete') {
        gaps.add(
            'The current usage window is absent, historical, partial or unavailable. Missing activity does not establish inactivity.',
        );
    }
    if (!reviewsVerified) {
        gaps.add(
            'The saved Review Library could not be verified; Retain decisions have not been used as starting evidence.',
        );
    }
    if (options.selectedIds) {
        [...new Set(options.selectedIds)].forEach((id) => {
            add(id)?.reasons.push({
                kind: 'selected',
                detail: 'Explicitly selected for investigation; this is not observed usage.',
            });
        });
    } else {
        let invalidObservations = 0;
        snapshot.objects.forEach((object) => {
            const evidence = object.usageEvidence;
            if (
                options.activity === 'none' ||
                !evidence ||
                !(evidence.observationCount > 0) ||
                (options.activity !== 'all' && evidence.activityKind !== options.activity)
            ) {
                return;
            }
            if (
                !currentWindow ||
                usageValidity(object, snapshot.scan.scanId, now) !== 'current' ||
                evidence.usageRunId !== usage?.runId ||
                evidence.windowEnd !== usage?.windowEnd ||
                evidence.windowStart !== usage?.windowStart ||
                evidence.coverage === 'unavailable' ||
                evidence.activityKind !== usageSourceForObject(object)?.activityKind
            ) {
                invalidObservations += 1;
                return;
            }
            if (
                options.successfulOnly &&
                evidence.activityKind === 'saved_search_execution' &&
                !(evidence.successfulCount > 0)
            ) {
                return;
            }
            add(object.objectId)?.reasons.push({
                kind: 'observed',
                detail: `${evidence.observationCount} observations; latest ${evidence.lastObserved ?? 'unknown'}. ${evidence.successfulCount} successful, ${evidence.failedCount} failed, ${evidence.skippedCount} skipped; ${evidence.coverage} window.`,
            });
        });
        if (invalidObservations) {
            gaps.add(
                `${invalidObservations} positive activity records are historical, modified or unverifiable for the current window and were not accepted as usage roots. They are not proven unused.`,
            );
        }
        if (options.includeRetained && reviewsVerified) {
            let unverifiedRetained = 0;
            reviews.forEach((review) => {
                if (review.removed || review.stage !== 'retain') {
                    return;
                }
                if (review.persistenceIssue) {
                    unverifiedRetained += 1;
                    return;
                }
                const object = objects.get(review.objectId);
                add(review.objectId, review)?.reasons.push({
                    kind: 'retained',
                    detail: 'Explicit Retain decision, not a usage observation.',
                    reviewer: review.updatedBy,
                    reviewedAt: review.updatedAt,
                    revisionId: review.revisionId,
                    evidenceStatus: compareReviewEvidence(review, object, snapshot.scan, now)
                        .status,
                });
            });
            if (unverifiedRetained) {
                gaps.add(
                    `${unverifiedRetained} Retain decisions have unverifiable persistence and were not accepted as roots.`,
                );
            }
        }
    }
    const roots = [...rows.keys()];
    const queue = [...roots];
    const outbound = new Map<string, DependencyEdge[]>();
    snapshot.edges.forEach((edge) => {
        if (['belongs_to', 'owned_by'].includes(edge.relation)) {
            return;
        }
        const list = outbound.get(edge.sourceId) ?? [];
        list.push(edge);
        outbound.set(edge.sourceId, list);
    });
    const relationships: DependencyEdge[] = [];
    const edgeIds = new Set<string>();
    let unresolved = 0;
    let edgeLimitReached = false;
    for (let position = 0; position < queue.length && !edgeLimitReached; position += 1) {
        const parent = rows.get(queue[position])!;
        const outgoing = outbound.get(parent.objectId) ?? [];
        for (let edgePosition = 0; edgePosition < outgoing.length; edgePosition += 1) {
            const edge = outgoing[edgePosition];
            if (!edgeIds.has(edge.edgeId)) {
                if (relationships.length >= maxEdges) {
                    truncated = true;
                    edgeLimitReached = true;
                    break;
                }
                edgeIds.add(edge.edgeId);
                relationships.push(edge);
                if (!edge.resolved || !objects.has(edge.targetId)) {
                    unresolved += 1;
                }
                if (!rows.has(edge.targetId)) {
                    const row = add(edge.targetId);
                    if (row) {
                        row.via = {
                            rootId: parent.via?.rootId ?? parent.objectId,
                            parentId: parent.objectId,
                            edgeId: edge.edgeId,
                            relation: edge.relation,
                            depth: (parent.via?.depth ?? 0) + 1,
                            confidence: weakestConfidence(
                                parent.via?.confidence ?? 'high',
                                edge.confidence,
                            ),
                            conditional: parent.via?.conditional === true || isPotentialRelation(edge.relation),
                            ...(edge.fieldProvenance ? { fieldProvenance: edge.fieldProvenance } : {}),
                        };
                        queue.push(row.objectId);
                    }
                }
            }
        }
    }
    if (unresolved) {
        gaps.add(
            `${unresolved} traversed references are unresolved or point outside the visible inventory.`,
        );
    }
    const conditional = [...rows.values()].filter((row) => row.via?.conditional).length;
    if (conditional) {
        gaps.add(`${conditional} included identities have a shortest witness path containing a potential configuration relationship; inclusion is not proof of runtime use or an unconditional requirement.`);
    }
    const missing = [...rows.values()].filter((row) => !row.inInventory).length;
    if (missing) {
        gaps.add(
            `${missing} included identities are not in the current inventory. Their current definitions and dependencies cannot be verified.`,
        );
    }
    const outboundUnknown = [...rows.values()].filter(
        (row) => row.inInventory && row.outboundCoverage !== 'complete',
    ).length;
    if (outboundUnknown) {
        gaps.add(
            `${outboundUnknown} included objects have partial or unavailable declared-outbound coverage.`,
        );
    }
    if (truncated) {
        gaps.add(
            `Traversal limit reached (${maxObjects} objects / ${maxEdges} relationships). This report is truncated; narrow the starting set.`,
        );
    }
    const sorted = [...rows.values()].sort(
        (a, b) =>
            a.objectType.localeCompare(b.objectType) ||
            a.app.localeCompare(b.app) ||
            a.name.localeCompare(b.name) ||
            a.objectId.localeCompare(b.objectId),
    );
    const groups: Record<string, number> = {};
    sorted.forEach((row) => {
        groups[row.objectType] = (groups[row.objectType] ?? 0) + 1;
    });
    return {
        scanId: snapshot.scan.scanId,
        generatedAt: new Date(now).toISOString(),
        options,
        usage,
        rows: sorted,
        relationships,
        groups,
        rootCount: roots.length,
        coverage: 'partial',
        truncated,
        gaps: [...gaps],
    };
}

function weakestConfidence(
    left: DependencyEdge['confidence'],
    right: DependencyEdge['confidence'],
): DependencyEdge['confidence'] {
    const rank = { unknown: 0, low: 1, medium: 2, high: 3 };
    return rank[left] < rank[right] ? left : right;
}

/** Bound presentation only, never the closure. Full adjacency remains exported. */
export function inUsePath(
    report: InUseReport,
    objectId: string,
    limit = 100,
): { ids: string[]; truncated: boolean } {
    const rows = new Map(report.rows.map((row) => [row.objectId, row]));
    const ids: string[] = [];
    let id: string | undefined = objectId;
    while (id && ids.length < limit) {
        ids.push(id);
        id = rows.get(id)?.via?.parentId;
    }
    return { ids: ids.reverse(), truncated: Boolean(id) };
}
