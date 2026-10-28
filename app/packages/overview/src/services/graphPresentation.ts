import { DependencyIndex, GraphLink, GraphModel, GraphNode, nodeFor } from './dependencyGraph';
import { DependencyEdge } from '../types';

export interface GraphGeometry {
    nodeWidth: number;
    nodeHeight: number;
    labelWidth: number;
    labelHeight: number;
    columnGap: number;
    rowGap: number;
}
export const graphGeometry: Record<'overview' | 'detail', GraphGeometry> = {
    overview: { nodeWidth: 240, nodeHeight: 160, labelWidth: 200, labelHeight: 100, columnGap: 224, rowGap: 32 },
    detail: { nodeWidth: 280, nodeHeight: 208, labelWidth: 216, labelHeight: 116, columnGap: 240, rowGap: 40 },
};

function groupRank(node: GraphNode): number {
    if ((node as PresentationNode).continuation) { return 2; }
    return node.memberIds ? 1 : 0;
}

/** Pure presentation: deterministic near-parent ordering, never a new graph. */
export function layoutGraph(model: GraphModel, mode: 'overview' | 'detail', options?: { geometry: GraphGeometry; height: number }): GraphModel {
    const g = options?.geometry ?? graphGeometry[mode];
    const nodes = model.nodes.map(node => ({ ...node }));
    const levels = [...new Set(nodes.map(node => node.level))].sort((a, b) => a - b);
    const columns = new Map(levels.map(level => [level, nodes.filter(node => node.level === level)
        .sort((a, b) => groupRank(a) - groupRank(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))]));
    const byId = new Map(nodes.map(node => [node.id, node]));
    const neighbors = new Map<string, Set<string>>();
    model.links.forEach(link => {
        [[link.source, link.target], [link.target, link.source]].forEach(([id, other]) => {
            const adjacent = neighbors.get(id) ?? new Set<string>(); adjacent.add(other); neighbors.set(id, adjacent);
        });
    });
    const ranks = new Map<string, number>();
    columns.forEach(column => column.forEach((node, i) => ranks.set(node.id, i)));
    // Order outward from the center; both sides stay directed and separate.
    // Stable name/id ties keep repeated renders and keyboard order predictable.
    levels.filter(value => value !== 0).sort((a, b) => Math.abs(a) - Math.abs(b) || a - b).forEach(level => {
        const score = (node: GraphNode): number => {
            const parents = [...(neighbors.get(node.id) ?? [])].filter(id => Math.abs(byId.get(id)!.level) < Math.abs(level));
            return parents.length ? parents.reduce((sum, id) => sum + (ranks.get(id) ?? 0), 0) / parents.length : ranks.get(node.id) ?? 0;
        };
        const scores = new Map(columns.get(level)!.map(node => [node.id, score(node)]));
        columns.get(level)!.sort((a, b) => groupRank(a) - groupRank(b) || scores.get(a.id)! - scores.get(b.id)! || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        columns.get(level)!.forEach((node, i) => ranks.set(node.id, i));
    });
    levels.forEach((level, column) => columns.get(level)!.forEach((node, row) => {
        Object.assign(node, { x: 24 + column * (g.nodeWidth + g.columnGap), y: 64 + row * (g.nodeHeight + g.rowGap) });
    }));
    const occupied = new Map<number, Set<number>>();
    const labels = model.links.flatMap(link => {
        const source = byId.get(link.source)!; const target = byId.get(link.target)!;
        const x = Math.min(source.x, target.x) + g.nodeWidth + (g.columnGap - g.labelWidth) / 2;
        const slots = occupied.get(x) ?? new Set<number>();
        const stride = g.labelHeight + 12;
        const capacity = options ? Math.max(1, Math.floor((options.height - 88 + 12) / stride)) : Infinity;
        if (slots.size >= capacity) { return []; }
        const preferred = Math.min(capacity - 1, Math.max(0, Math.round(((source.y + target.y) / 2 + g.nodeHeight / 2 - g.labelHeight / 2 - 64) / stride)));
        let slot = preferred;
        for (let offset = 0; slots.has(slot); offset += 1) {
            const lower = preferred - offset - 1;
            const upper = preferred + offset + 1;
            if (lower >= 0 && !slots.has(lower)) { slot = lower; }
            else { slot = upper < capacity ? upper : 0; }
        }
        slots.add(slot); occupied.set(x, slots);
        return [{ link, x, y: 64 + slot * stride }];
    });
    return { ...model, nodes, labels,
        width: levels.length * (g.nodeWidth + g.columnGap) + 24,
        height: Math.max(options ? 0 : 350, ...nodes.map(node => node.y + g.nodeHeight + 24), ...labels.map(label => label.y + g.labelHeight + 24)) };
}

export interface GraphWindow {
    level: number;
    start: number;
    end: number;
    total: number;
    pageSize: number;
}
export type PresentationNode = GraphNode & { continuation?: GraphWindow };
export interface ViewportGraph extends GraphModel {
    nodes: PresentationNode[];
    mode: 'overview' | 'detail';
    geometry: GraphGeometry;
    compactLabels: boolean;
    hiddenLinks: number;
    windows: GraphWindow[];
}

/** Merge only actual captured references after replacing off-page cards by an
 * explicit continuation group. A group arrow is never an inferred new edge. */
function remapLinks(links: GraphLink[], renderedIds: Map<string, string>): GraphLink[] {
    const result = new Map<string, GraphLink>();
    const confidence: Record<string, number> = { unknown: 0, low: 1, medium: 2, high: 3 };
    links.forEach(link => {
        const source = renderedIds.get(link.source)!; const target = renderedIds.get(link.target)!;
        const id = JSON.stringify([source, target]);
        const prior = result.get(id);
        if (!prior) { result.set(id, { ...link, id: source === link.source && target === link.target ? link.id : id, source, target, edges: [...link.edges] }); return; }
        prior.edges.push(...link.edges);
        prior.label = [...new Set(prior.edges.map(edge => edge.relation.replace(/_/g, ' ')))].join(' · ');
        if ((confidence[link.confidence] ?? 0) < (confidence[prior.confidence] ?? 0)) { prior.confidence = link.confidence; }
        prior.evidence = `${prior.evidence}; ${link.evidence}`;
    });
    return [...result.values()];
}

/** A bounded map window, not a vertical rendering of the entire neighborhood.
 * All off-page members/references remain in explicit continuation groups and
 * the independent connection browser. Zoom/resize changes presentation only. */
export function viewportGraph(model: GraphModel, options: { width: number; height: number; zoom: number; offsets: ReadonlyMap<number, number> }): ViewportGraph {
    const width = options.width || 1200; const height = options.height || 620;
    const logicalHeight = height / options.zoom;
    const levels = [...new Set(model.nodes.map(node => node.level))];
    const detailFits = levels.length * (graphGeometry.detail.nodeWidth + graphGeometry.detail.columnGap) + 24 <= width / options.zoom;
    const detailRows = Math.max(1, Math.floor((logicalHeight - 88 + graphGeometry.detail.rowGap) / (graphGeometry.detail.nodeHeight + graphGeometry.detail.rowGap)));
    const crowded = levels.some(level => model.nodes.filter(node => node.level === level).length > detailRows);
    const mode = options.zoom < 1 || !detailFits || crowded || logicalHeight < 296 ? 'overview' : 'detail';
    let geometry = graphGeometry[mode];
    // Four rows is a legibility limit, not an estate-size limit. Larger windows
    // show more context per card rather than silently creating a long canvas.
    const capacity = Math.max(1, Math.min(4, Math.floor((logicalHeight - 88 + geometry.rowGap) / (geometry.nodeHeight + geometry.rowGap))));
    const ordered = layoutGraph(model, mode).nodes;
    const nodes: PresentationNode[] = [];
    const windows: GraphWindow[] = [];
    const renderedIds = new Map<string, string>();
    levels.forEach(level => {
        const column = ordered.filter(node => node.level === level).sort((a, b) => a.y - b.y);
        if (column.length <= capacity) {
            column.forEach(node => { nodes.push(node); renderedIds.set(node.id, node.id); });
            return;
        }
        const pageSize = capacity - 1;
        const start = Math.max(0, Math.min(options.offsets.get(level) ?? 0, column.length - Math.max(1, pageSize)));
        const end = start + pageSize;
        const page: GraphWindow = { level, start, end, total: column.length, pageSize };
        windows.push(page);
        column.slice(start, end).forEach(node => { nodes.push(node); renderedIds.set(node.id, node.id); });
        const hidden = [...column.slice(0, start), ...column.slice(end)];
        const memberIds = hidden.flatMap(node => node.memberIds ?? [node.id]);
        const id = `viewport-window::${level}`;
        nodes.push({ ...hidden[0], id, groupKey: undefined, witness: undefined,
            name: `${memberIds.length} more ${level < 0 ? 'consumers' : 'dependencies'}`,
            objectType: 'Off-page objects', app: 'Map window', memberIds, resolved: false,
            continuation: page });
        hidden.forEach(node => renderedIds.set(node.id, id));
    });
    const links = remapLinks(model.links, renderedIds);
    const corridorCounts = new Map<number, number>();
    const byId = new Map(nodes.map(node => [node.id, node]));
    links.forEach(link => {
        const level = Math.min(byId.get(link.source)!.level, byId.get(link.target)!.level);
        corridorCounts.set(level, (corridorCounts.get(level) ?? 0) + 1);
    });
    const fullLabelCapacity = Math.max(1, Math.floor((logicalHeight - 88 + 12) / (geometry.labelHeight + 12)));
    const compactLabels = [...corridorCounts.values()].some(count => count > fullLabelCapacity);
    if (compactLabels) { geometry = { ...geometry, labelHeight: 60 }; }
    const laidOut = layoutGraph({ ...model, nodes, links }, mode, { geometry, height: Math.max(logicalHeight, geometry.nodeHeight + 88) });
    return { ...laidOut, nodes: laidOut.nodes as PresentationNode[], mode, geometry, compactLabels,
        hiddenLinks: links.length - laidOut.labels.length, windows };
}

/** Exact endpoints from an already captured reference, including references
 * inside continuation groups. Does not re-center, re-scan or change filters. */
export function connectionGraph(edge: DependencyEdge, index: DependencyIndex): GraphModel {
    const nodes = [nodeFor(edge.sourceId, 0, index, edge)];
    if (edge.targetId !== edge.sourceId) { nodes.push(nodeFor(edge.targetId, 1, index, edge)); }
    const link: GraphLink = { id: edge.edgeId, source: edge.sourceId, target: edge.targetId,
        label: edge.relation.replace(/_/g, ' '), confidence: edge.confidence, evidence: edge.evidence, edges: [edge] };
    return { nodes, links: [link], labels: [], width: 0, height: 0, representedObjects: nodes.length, omittedObjects: 0 };
}

/** Exact ordered investigation path. It is a view, never a new dependency. */
export function investigatedPathGraph(edges: DependencyEdge[], index: DependencyIndex): GraphModel {
    const ids = edges.length ? [edges[0].sourceId, ...edges.map(edge => edge.targetId)] : [];
    const nodes = ids.map((id, level) => nodeFor(id, level, index, edges[Math.max(0, level - 1)]));
    const links = edges.map(edge => ({ id: edge.edgeId, source: edge.sourceId, target: edge.targetId,
        label: edge.relation.replace(/_/g, ' '), confidence: edge.confidence, evidence: edge.evidence, edges: [edge] }));
    return { nodes, links, labels: [], width: 0, height: 0, representedObjects: nodes.length, omittedObjects: 0 };
}

/** Highlight only this rendered connection (including its aggregated edges). */
export function graphAssociation(model: GraphModel, selection: { kind: 'node' | 'link'; id: string } | null): { links: Set<string>; nodes: Set<string> } {
    const links = new Set<string>(); const nodes = new Set<string>();
    if (!selection) { return { links, nodes }; }
    if (selection.kind === 'node' && model.nodes.some(node => node.id === selection.id)) { nodes.add(selection.id); }
    model.links.forEach(link => {
        if (selection.kind === 'link' ? link.id === selection.id : link.source === selection.id || link.target === selection.id) {
            links.add(link.id); nodes.add(link.source); nodes.add(link.target);
        }
    });
    return { links, nodes };
}

/** Fit the density actually rendered; never claim an unbounded estate fits. */
export function fitGraphZoom(model: GraphModel, width: number, height: number): number {
    const detail = layoutGraph(model, 'detail');
    if (detail.width <= width && detail.height <= height) { return 1; }
    const overview = layoutGraph(model, 'overview');
    return Math.max(0.6, Math.min(0.9, Math.floor(Math.min(width / overview.width, height / overview.height) * 10) / 10));
}
