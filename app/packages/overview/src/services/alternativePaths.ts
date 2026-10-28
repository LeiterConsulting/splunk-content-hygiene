/* eslint-disable no-restricted-syntax, no-continue -- Explicit state, edge, candidate and context ceilings bound all searches. */
import { DependencyIndex } from './dependencyGraph';
import { createPathContextTracker, PathContextEvidence, PathContextStatus } from './pathContext';
import { ConfidenceLevel, DependencyEdge } from '../types';
import { isPotentialRelation, weakestDependencyConfidence } from '../utils/dependencySemantics';

export const ALTERNATIVE_PATH_LIMITS = { hops: 6, edgeVisits: 20000, states: 2048, candidates: 64, alternatives: 3, baselineHops: 32 } as const;
export type PathSearchLimit = 'depth' | 'edge_visits' | 'states' | 'candidates' | 'context' | 'baseline' | 'identity';
export const ALTERNATIVE_PATH_LIMITATION = 'Bounded comparison of captured directed paths, not complete dependency closure or observed execution. No alternative found does not establish absence, incompatibility, inactivity or removal eligibility. Each path retains its own context; independent callers, queries and branches are never combined. Existing report membership, confidence, removal blockers and decisions are unchanged.';
export interface InvestigatedPath {
    id: string;
    baseline: boolean;
    objectIds: string[];
    edgeIds: string[];
    confidence: ConfidenceLevel;
    conditional: boolean;
    context: PathContextEvidence;
}
export interface PathInvestigation {
    version: 1;
    sourceId: string;
    targetId: string;
    scanId: string | null;
    paths: InvestigatedPath[];
    relationships: DependencyEdge[];
    limits: PathSearchLimit[];
    ceilings: typeof ALTERNATIVE_PATH_LIMITS;
    diagnostics: { edgeVisits: number; states: number; completedCandidates: number; contextWork: number; contextBytes: number };
    limitation: string;
}
const compareId = (a: string, b: string): number => { if (a === b) { return 0; } return a < b ? -1 : 1; };
// A display preference, not a confidence upgrade or universal strength ordering.
const contextOrder: Record<PathContextStatus, number> = { shared_caller: 0, static_only: 1, app_only: 2, unverified: 3, mixed: 4, bounded: 5 };
type SearchOptions = Partial<Record<'hops' | 'edgeVisits' | 'states' | 'candidates', number>>;

/** On-demand only. The index is the existing cached estate, never a native crawl.
 * No per-node visited set: different paths/context receipts may reach the same
 * node. Only within-path cycles are excluded. Original witnesses stay separate. */
export function investigateAlternativePaths(index: DependencyIndex, sourceId: string, targetId: string, baselineEdgeIds: readonly string[] = [], options: SearchOptions = {}): PathInvestigation {
    const cap = (key: keyof SearchOptions): number => {
        const value = options[key] ?? ALTERNATIVE_PATH_LIMITS[key];
        return Number.isFinite(value) ? Math.max(0, Math.min(ALTERNATIVE_PATH_LIMITS[key], Math.floor(value))) : 0;
    };
    const limits = new Set<PathSearchLimit>();
    const tracker = createPathContextTracker(index.objects);
    let edgeVisits = 0; let completedCandidates = 0;
    const path = (edges: DependencyEdge[], baseline: boolean): InvestigatedPath => ({
        id: JSON.stringify(edges.map(edge => edge.edgeId)), baseline,
        objectIds: [sourceId, ...edges.map(edge => edge.targetId)], edgeIds: edges.map(edge => edge.edgeId),
        confidence: edges.reduce((value, edge) => weakestDependencyConfidence(value, edge.confidence), 'high' as ConfidenceLevel),
        conditional: edges.some(edge => isPotentialRelation(edge.relation)), context: tracker.path(sourceId, edges),
    });
    const chosen: InvestigatedPath[] = [];
    if (baselineEdgeIds.length > ALTERNATIVE_PATH_LIMITS.baselineHops) { limits.add('baseline'); }
    else if (baselineEdgeIds.length) {
        const edges: DependencyEdge[] = []; let tip = sourceId; let valid = true; const visited = new Set([sourceId]);
        for (const id of baselineEdgeIds) {
            const edge = index.edgeById.get(id);
            if (!edge || index.ambiguousEdgeIds.has(id) || edge.sourceId !== tip || visited.has(edge.targetId)) { valid = false; break; }
            edges.push(edge); tip = edge.targetId; visited.add(tip);
        }
        if (valid && tip === targetId) { chosen.push(path(edges, true)); }
        else { limits.add('baseline'); }
    }
    const candidates = new Map<string, InvestigatedPath>();
    const outgoing = new Map<string, DependencyEdge[]>();
    const adjacent = (id: string): DependencyEdge[] => {
        const cached = outgoing.get(id); if (cached) { return cached; }
        // Bound preparation as well as successful/rejected traversal. An oversized
        // adjacency is not partially sorted into an order-dependent answer.
        const raw = index.outbound.get(id) ?? [];
        if (raw.length > cap('edgeVisits') - edgeVisits) { limits.add('edge_visits'); return []; }
        edgeVisits += raw.length;
        const rows = [...new Map(raw.map(edge => [edge.edgeId, edge])).values()]
            .sort((a, b) => compareId(a.edgeId, b.edgeId));
        outgoing.set(id, rows); return rows;
    };
    const queue: Array<{ id: string; ids: string[]; edges: DependencyEdge[] }> = [];
    if (!index.objects.has(sourceId) || !index.objects.has(targetId) || sourceId === targetId) { limits.add('identity'); }
    else if (!cap('states')) { limits.add('states'); }
    else { queue.push({ id: sourceId, ids: [sourceId], edges: [] }); }
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const state = queue[cursor];
        if (limits.has('edge_visits') || limits.has('candidates')) { break; }
        for (const edge of adjacent(state.id)) {
            if (edgeVisits >= cap('edgeVisits')) { limits.add('edge_visits'); break; }
            edgeVisits += 1;
            if (index.ambiguousEdgeIds.has(edge.edgeId)) { limits.add('identity'); continue; }
            // Containment is metadata, not an outbound requirement. Preserve an
            // original containment witness above, but never manufacture closure.
            if (edge.relation === 'belongs_to' || state.ids.includes(edge.targetId)) { continue; }
            if (!edge.resolved || !index.objects.has(edge.targetId)) { limits.add('identity'); continue; }
            if (state.edges.length >= cap('hops')) { limits.add('depth'); continue; }
            const edges = [...state.edges, edge];
            if (edge.targetId === targetId) {
                if (completedCandidates >= cap('candidates')) { limits.add('candidates'); break; }
                completedCandidates += 1;
                const found = path(edges, false);
                if (!chosen.some(item => item.id === found.id)) { candidates.set(found.id, found); }
                continue;
            }
            if (queue.length >= cap('states')) { limits.add('states'); continue; }
            queue.push({ id: edge.targetId, ids: [...state.ids, edge.targetId], edges });
        }
    }
    if (tracker.diagnostics().bounded) { limits.add('context'); }
    const sorted = [...candidates.values()].sort((a, b) => contextOrder[a.context.status] - contextOrder[b.context.status] || a.edgeIds.length - b.edgeIds.length || compareId(a.id, b.id));
    const paths = [...chosen, ...sorted.slice(0, ALTERNATIVE_PATH_LIMITS.alternatives)];
    const ids = new Set(paths.flatMap(item => item.edgeIds));
    const context = tracker.diagnostics();
    return { version: 1, sourceId, targetId, scanId: index.objects.get(sourceId)?.inventoryScanId ?? index.objects.get(targetId)?.inventoryScanId ?? null,
        paths, relationships: [...ids].sort(compareId).map(id => index.edgeById.get(id)!), limits: [...limits].sort(), ceilings: ALTERNATIVE_PATH_LIMITS,
        diagnostics: { edgeVisits, states: queue.length, completedCandidates, contextWork: context.work, contextBytes: context.evidenceBytes }, limitation: ALTERNATIVE_PATH_LIMITATION };
}

/** Same ordered rows for every UI entry point. Zero-path reports retain limits. */
export function pathInvestigationCsv(report: PathInvestigation): { columns: string[]; rows: Array<Array<string | number | boolean | null>> } {
    const byId = new Map(report.relationships.map(edge => [edge.edgeId, edge]));
    const rows: Array<Array<string | number | boolean | null>> = [];
    report.paths.forEach(item => item.edgeIds.forEach((id, hop) => {
        const edge = byId.get(id)!;
        rows.push([report.sourceId, report.targetId, report.scanId, item.id, item.baseline, hop + 1,
            edge.edgeId, edge.sourceId, edge.targetId, edge.relation, edge.confidence, edge.resolved,
            edge.evidence, edge.sourceLocation, JSON.stringify(edge.fieldProvenance ?? null), item.confidence, item.conditional,
            JSON.stringify(item.context), JSON.stringify(report.limits), JSON.stringify(report.ceilings), JSON.stringify(report.diagnostics), report.limitation]);
    }));
    if (!rows.length) { rows.push([report.sourceId, report.targetId, report.scanId, '', false, 0, '', '', '', '', '', false, '', '', 'null', '', false, 'null', JSON.stringify(report.limits), JSON.stringify(report.ceilings), JSON.stringify(report.diagnostics), report.limitation]); }
    return { columns: ['Source ID', 'Target ID', 'Inventory scan ID', 'Path ID', 'Original witness', 'Hop', 'Edge ID', 'From ID', 'To ID', 'Relation', 'Edge confidence', 'Resolved', 'Evidence', 'Source location', 'Field provenance', 'Path confidence', 'Potential relationship in path', 'Path context', 'Search limits', 'Search ceilings', 'Search diagnostics', 'Interpretation'], rows };
}
