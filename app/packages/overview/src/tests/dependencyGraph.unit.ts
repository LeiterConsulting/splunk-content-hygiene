import {
    buildDependencyIndex,
    buildGraphModel,
    GRAPH_NODE_HEIGHT,
    GRAPH_NODE_WIDTH,
    GRAPH_LABEL_HEIGHT,
    GRAPH_LABEL_WIDTH,
    graphLinkPath,
} from '../services/dependencyGraph';
import { analyzeInventory } from '../services/analysis';
import { ContentObject, DependencyEdge } from '../types';

const makeObject = (id: string): ContentObject => ({
    objectId: id,
    canonicalName: id,
    name: id,
    objectType: 'Macro',
    app: 'search',
    owner: 'analyst',
    sharing: 'app',
    enabled: true,
    scheduled: false,
    updated: null,
    lastUsed: null,
    usageEvidence: null,
    healthStatus: 'unknown',
    abandonmentConfidence: null,
    removalImpact: null,
    inboundReferences: 0,
    outboundReferences: 0,
    protected: false,
    evidence: [],
    suggestedAction: '',
});
const makeEdge = (source: string, target: string, relation = 'uses'): DependencyEdge => ({
    edgeId: `${source}-${target}-${relation}`,
    sourceId: source,
    targetId: target,
    relation,
    confidence: 'high',
    evidence: 'Synthetic parser regression',
    sourceLocation: 'search:1',
    resolved: true,
});
const options = {
    grouping: 'app' as const,
    expandedGroups: new Map<string, number>(),
    expandedNodes: new Set<string>(),
};

test('a thousand-neighbor hub is grouped without losing objects or overlapping cards', () => {
    const objects = Array.from({ length: 1001 }, (_unused, i) => makeObject(`object-${i}`));
    const edges = objects.slice(1).map((item) => makeEdge(item.objectId, objects[0].objectId));
    const index = buildDependencyIndex(objects, edges);
    const model = buildGraphModel(objects[0].objectId, index, edges, options);
    expect(model.representedObjects).toBe(1000);
    expect(model.omittedObjects).toBe(0);
    expect(model.nodes).toHaveLength(2);
    const group = model.nodes.find((node) => node.groupKey)!;
    const expanded = buildGraphModel(objects[0].objectId, index, edges, {
        ...options,
        expandedGroups: new Map([[group.groupKey!, 12]]),
    });
    expect(expanded.representedObjects).toBe(1000);
    expect(expanded.nodes).toHaveLength(14);
    expect(expanded.nodes.find((node) => node.id === objects[0].objectId)?.y).toBe(64);
    expect(expanded.nodes.find((node) => node.id === objects[0].objectId)?.y).toBe(
        model.nodes.find((node) => node.id === objects[0].objectId)?.y,
    );
    expanded.nodes.forEach((node) =>
        expanded.nodes
            .filter((other) => other.id !== node.id)
            .forEach((other) => {
                expect(
                    Math.abs(node.x - other.x) >= GRAPH_NODE_WIDTH ||
                        Math.abs(node.y - other.y) >= GRAPH_NODE_HEIGHT,
                ).toBe(true);
            }),
    );
    const individual = buildGraphModel(objects[0].objectId, index, edges, {
        ...options,
        grouping: 'none',
    });
    expect(individual.nodes).toHaveLength(60);
    expect(individual.omittedObjects).toBe(941);
});

test('cycles and multiple relations share nodes; arrows terminate at card boundaries', () => {
    const objects = ['a', 'b', 'c'].map(makeObject);
    const edges = [
        makeEdge('a', 'b'),
        makeEdge('a', 'b', 'reads'),
        makeEdge('b', 'c'),
        makeEdge('c', 'a'),
    ];
    const model = buildGraphModel('a', buildDependencyIndex(objects, edges), [edges[0], edges[1]], {
        ...options,
        expandedNodes: new Set(['b', 'c']),
    });
    expect(model.nodes).toHaveLength(3);
    expect(model.links.find((link) => link.source === 'a' && link.target === 'b')?.label).toBe(
        'uses · reads',
    );
    const source = model.nodes.find((node) => node.id === 'a')!;
    const target = model.nodes.find((node) => node.id === 'b')!;
    expect(graphLinkPath(source, target)).toMatch(
        new RegExp(`, ${target.x} ${target.y + GRAPH_NODE_HEIGHT / 2}$`),
    );
});

test('ten thousand unique references resolve through an index within the interactive budget', () => {
    const objects = Array.from({ length: 10000 }, (_unused, i) => makeObject(`m${i}`));
    const start = performance.now();
    const analysis = analyzeInventory(
        objects,
        objects.map((item, i) => ({
            objectId: item.objectId,
            kind: 'spl',
            text: `\`m${(i + 1) % objects.length}\``,
            sourceLocation: 'definition',
        })),
        {
            macros: true,
            lookup_definitions: true,
            lookup_files: true,
            saved_searches: true,
            data_models: true,
            indexes: true,
            sourcetypes: true,
        },
    );
    const durationMs = performance.now() - start;
    expect(analysis.edges).toHaveLength(10000);
    expect(analysis.edges.every((edge) => edge.resolved)).toBe(true);
    expect(durationMs).toBeLessThan(2500);
});

test('aggregate confidence stays conservative and self-loop arrows end outside the card', () => {
    const objects = ['a', 'b'].map(makeObject);
    const edges = [
        { ...makeEdge('a', 'b'), confidence: 'low' as const },
        makeEdge('a', 'b', 'reads'),
        makeEdge('a', 'a'),
    ];
    const model = buildGraphModel('a', buildDependencyIndex(objects, edges), edges, options);
    expect(model.links.find((link) => link.source === 'a' && link.target === 'b')?.confidence).toBe(
        'low',
    );
    const center = model.nodes.find((node) => node.id === 'a')!;
    expect(graphLinkPath(center, center)).toMatch(
        new RegExp(`, ${center.x + GRAPH_NODE_WIDTH * 0.75} ${center.y}$`),
    );
});

test('relationship context slots never overlap cards or each other, including cycles and fan-in', () => {
    const objects = Array.from({ length: 35 }, (_unused, i) => makeObject(`object-${i}`));
    const edges = objects.slice(1).flatMap((item) => [
        makeEdge('object-0', item.objectId, 'may_apply_automatic_lookup'),
        makeEdge(item.objectId, 'object-0', 'uses_lookup'),
    ]);
    edges.push(makeEdge('object-0', 'object-0'));
    const model = buildGraphModel('object-0', buildDependencyIndex(objects, edges), edges, {
        ...options, grouping: 'none', expandedNodes: new Set(['object-1', 'object-2']),
    });
    const bytes = JSON.stringify(edges);
    model.labels.forEach((label) => {
        expect(label.x).toBeGreaterThanOrEqual(0);
        expect(label.y).toBeGreaterThanOrEqual(64);
        expect(label.x + GRAPH_LABEL_WIDTH).toBeLessThanOrEqual(model.width);
        expect(label.y + GRAPH_LABEL_HEIGHT).toBeLessThanOrEqual(model.height);
        model.nodes.forEach((node) => {
            expect(label.x + GRAPH_LABEL_WIDTH <= node.x || node.x + GRAPH_NODE_WIDTH <= label.x ||
                label.y + GRAPH_LABEL_HEIGHT <= node.y || node.y + GRAPH_NODE_HEIGHT <= label.y).toBe(true);
        });
        model.labels.filter((other) => other.link.id !== label.link.id).forEach((other) => {
            expect(Math.abs(label.x - other.x) >= GRAPH_LABEL_WIDTH ||
                Math.abs(label.y - other.y) >= GRAPH_LABEL_HEIGHT).toBe(true);
        });
        expect(label.link.edges.length).toBeGreaterThan(0);
        const source = model.nodes.find((node) => node.id === label.link.source)!;
        const target = model.nodes.find((node) => node.id === label.link.target)!;
        expect(graphLinkPath(source, target, label)).toContain(
            `${label.x + GRAPH_LABEL_WIDTH / 2} ${label.y + GRAPH_LABEL_HEIGHT / 2}`,
        );
    });
    expect(JSON.stringify(edges)).toBe(bytes);
});

test('grouped relationship context preserves every original endpoint and source location', () => {
    const objects = Array.from({ length: 1001 }, (_unused, i) => makeObject(`object-${i}`));
    const edges = objects.slice(1).map((item) => makeEdge(item.objectId, 'object-0'));
    const model = buildGraphModel('object-0', buildDependencyIndex(objects, edges), edges, options);
    expect(model.labels).toHaveLength(1);
    expect(model.links[0].edges).toEqual(edges);
    expect(model.links[0].edges[999].sourceId).toBe('object-1000');
    expect(model.links[0].edges[999].sourceLocation).toBe('search:1');
});
