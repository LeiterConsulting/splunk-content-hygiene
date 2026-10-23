import { ContentObject, DependencyEdge, HealthStatus } from '../types';

export interface DependencyIndex {
    objects: Map<string, ContentObject>;
    inbound: Map<string, DependencyEdge[]>;
    outbound: Map<string, DependencyEdge[]>;
    inboundSources: Map<string, Set<string>>;
}
export function buildDependencyIndex(
    objects: ContentObject[],
    edges: DependencyEdge[],
): DependencyIndex {
    const index: DependencyIndex = {
        objects: new Map(objects.map((item) => [item.objectId, item])),
        inbound: new Map(),
        outbound: new Map(),
        inboundSources: new Map(),
    };
    edges.forEach((edge) => {
        const inbound = index.inbound.get(edge.targetId) ?? [];
        inbound.push(edge);
        index.inbound.set(edge.targetId, inbound);
        const outbound = index.outbound.get(edge.sourceId) ?? [];
        outbound.push(edge);
        index.outbound.set(edge.sourceId, outbound);
        const sources = index.inboundSources.get(edge.targetId) ?? new Set<string>();
        sources.add(edge.sourceId);
        index.inboundSources.set(edge.targetId, sources);
    });
    return index;
}
export interface GraphNode {
    id: string;
    name: string;
    objectType: string;
    app: string;
    status: HealthStatus;
    level: number;
    x: number;
    y: number;
    groupKey?: string;
    memberIds?: string[];
    resolved: boolean;
}
export interface GraphLink {
    id: string;
    source: string;
    target: string;
    label: string;
    confidence: string;
    evidence: string;
}
export interface GraphModel {
    nodes: GraphNode[];
    links: GraphLink[];
    width: number;
    height: number;
    representedObjects: number;
    omittedObjects: number;
}
export const GRAPH_NODE_WIDTH = 280;
export const GRAPH_NODE_HEIGHT = 136;
export const GRAPH_NODE_BUDGET = 60;

function nodeFor(
    id: string,
    level: number,
    index: DependencyIndex,
    edge?: DependencyEdge,
): GraphNode {
    const item = index.objects.get(id);
    const parts = id.split('::');
    return {
        id,
        level,
        x: 0,
        y: 0,
        name: item?.name ?? (parts.slice(3).join('::') || id),
        objectType: item?.objectType ?? `Unresolved ${(parts[1] ?? 'object').replace(/_/g, ' ')}`,
        app: item?.app ?? parts[2] ?? 'unknown',
        status: item?.healthStatus ?? (edge?.confidence === 'unknown' ? 'unknown' : 'broken'),
        resolved: Boolean(item),
    };
}

/** A deterministic bounded neighborhood, not a force simulation over the estate. */
export function buildGraphModel(
    centerId: string,
    index: DependencyIndex,
    scopedEdges: DependencyEdge[],
    options: {
        grouping: 'app' | 'type' | 'none';
        expandedGroups: Map<string, number>;
        expandedNodes: Set<string>;
        allows?: (id: string, edge: DependencyEdge) => boolean;
    },
): GraphModel {
    const neighbors = new Map<string, GraphNode>();
    scopedEdges.forEach((edge) => {
        const id = edge.sourceId === centerId ? edge.targetId : edge.sourceId;
        if (id !== centerId && !neighbors.has(id)) {
            neighbors.set(id, nodeFor(id, edge.sourceId === centerId ? 1 : -1, index, edge));
        }
    });
    const sorted = Array.from(neighbors.values()).sort(
        (a, b) =>
            a.level - b.level ||
            a.app.localeCompare(b.app) ||
            a.name.localeCompare(b.name) ||
            a.id.localeCompare(b.id),
    );
    const groups = new Map<string, GraphNode[]>();
    sorted.forEach((node) => {
        const key = `${node.level}::${options.grouping === 'type' ? node.objectType : node.app}`;
        const members = groups.get(key) ?? [];
        members.push(node);
        groups.set(key, members);
    });
    const nodes = [nodeFor(centerId, 0, index)];
    const renderedId = new Map<string, string>([[centerId, centerId]]);
    const omitted = new Set<string>();
    groups.forEach((members, groupKey) => {
        const groupable = options.grouping !== 'none' && sorted.length > 12 && members.length > 4;
        const limit = groupable ? (options.expandedGroups.get(groupKey) ?? 0) : members.length;
        members.slice(0, limit).forEach((node) => {
            if (nodes.length >= GRAPH_NODE_BUDGET - (members.length > limit ? 1 : 0)) {
                omitted.add(node.id);
                return;
            }
            nodes.push(node);
            renderedId.set(node.id, node.id);
        });
        const remaining = members.slice(limit);
        if (!remaining.length) {
            return;
        }
        if (nodes.length >= GRAPH_NODE_BUDGET) {
            remaining.forEach((node) => omitted.add(node.id));
            return;
        }
        const id = `group::${groupKey}`;
        nodes.push({
            ...remaining[0],
            id,
            name: options.grouping === 'type' ? remaining[0].objectType : remaining[0].app,
            objectType: `${remaining.length} ${remaining[0].level < 0 ? 'consumers' : 'dependencies'}`,
            groupKey,
            memberIds: remaining.map((item) => item.id),
            resolved: false,
        });
        remaining.forEach((node) => renderedId.set(node.id, id));
    });
    const capturedEdges = new Map(scopedEdges.map((edge) => [edge.edgeId, edge]));
    // Explicit node expansion walks only its branch. Cycles share one node.
    for (let cursor = 0; cursor < nodes.length && cursor < GRAPH_NODE_BUDGET; cursor += 1) {
        const node = nodes[cursor];
        if (node.memberIds || !options.expandedNodes.has(node.id) || Math.abs(node.level) >= 3) {
            // eslint-disable-next-line no-continue -- Skip unexpanded branches without traversing the estate.
            continue;
        }
        const adjacent = node.level < 0 ? index.inbound.get(node.id) : index.outbound.get(node.id);
        (adjacent ?? []).forEach((edge) => {
            const id = node.level < 0 ? edge.sourceId : edge.targetId;
            if (options.allows && !options.allows(id, edge)) {
                return;
            }
            if (!renderedId.has(id)) {
                if (nodes.length >= GRAPH_NODE_BUDGET) {
                    omitted.add(id);
                    return;
                }
                nodes.push(nodeFor(id, node.level + (node.level < 0 ? -1 : 1), index, edge));
                renderedId.set(id, id);
            }
            capturedEdges.set(edge.edgeId, edge);
        });
    }
    const links = new Map<string, GraphLink>();
    const confidenceOrder: Record<string, number> = { unknown: 0, low: 1, medium: 2, high: 3 };
    capturedEdges.forEach((edge) => {
        const source = renderedId.get(edge.sourceId);
        const target = renderedId.get(edge.targetId);
        if (!source || !target) {
            return;
        }
        const key = `${source}::${target}`;
        const existing = links.get(key);
        const label = Array.from(
            new Set([...(existing?.label.split(' · ') ?? []), edge.relation.replace(/_/g, ' ')]),
        ).join(' · ');
        links.set(key, {
            id: key,
            source,
            target,
            label,
            confidence:
                existing && confidenceOrder[existing.confidence] < confidenceOrder[edge.confidence]
                    ? existing.confidence
                    : edge.confidence,
            evidence: existing ? `${existing.evidence}; ${edge.evidence}` : edge.evidence,
        });
    });
    const levels = Array.from(new Set(nodes.map((node) => node.level))).sort((a, b) => a - b);
    const columns = levels.map((level) =>
        nodes
            .filter((node) => node.level === level)
            .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    );
    const rows = Math.max(1, ...columns.map((column) => column.length));
    columns.forEach((column, columnIndex) =>
        column.forEach((node, rowIndex) => {
            Object.assign(node, {
                x: 24 + columnIndex * 440,
                // Expanding a hub must not push the center below the viewport.
                y: 64 + rowIndex * 160,
            });
        }),
    );
    return {
        nodes,
        links: Array.from(links.values()),
        width: levels.length * 440,
        height: rows * 160 + 100,
        representedObjects: renderedId.size - 1,
        omittedObjects: omitted.size,
    };
}

/** Arrows end at card boundaries, never underneath the node. */
export function graphLinkPath(source: GraphNode, target: GraphNode): string {
    const forward = target.x >= source.x;
    const sx = source.x + (forward ? GRAPH_NODE_WIDTH : 0);
    const tx = target.x + (forward ? 0 : GRAPH_NODE_WIDTH);
    const sy = source.y + GRAPH_NODE_HEIGHT / 2;
    const ty = target.y + GRAPH_NODE_HEIGHT / 2;
    if (source.id === target.id) {
        const topX = source.x + GRAPH_NODE_WIDTH * 0.75;
        return `M ${sx} ${sy} C ${sx + 90} ${sy}, ${topX + 90} ${source.y - 64}, ${topX} ${source.y}`;
    }
    const bend = Math.max(30, Math.abs(tx - sx) / 2);
    return `M ${sx} ${sy} C ${sx + (forward ? bend : -bend)} ${sy}, ${tx + (forward ? -bend : bend)} ${ty}, ${tx} ${ty}`;
}
