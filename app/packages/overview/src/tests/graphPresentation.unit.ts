// Synthetic graph presentation/expansion contracts; never bundled as app data.
import { buildDependencyIndex, buildGraphModel, GRAPH_EXPANSION_WORK, GRAPH_NODE_BUDGET } from '../services/dependencyGraph';
import { connectionGraph, fitGraphZoom, graphAssociation, graphGeometry, layoutGraph, viewportGraph } from '../services/graphPresentation';
import { object, edge } from './milestoneFixtures';

const options = { grouping: 'none' as const, expandedGroups: new Map<string, number>(), expandedNodes: new Set<string>() };
const chain = [edge('root', 'a'), edge('a', 'b'), edge('b', 'c'), edge('c', 'd')];
const index = buildDependencyIndex(['root', 'a', 'b', 'c', 'd'].map(id => object(id)), chain);

test('all expansion stops at three hops, collapse returns to the direct neighborhood, and source evidence is immutable', () => {
    const original = JSON.stringify(chain);
    const expanded = buildGraphModel('root', index, [chain[0]], { ...options, expandAll: true });
    expect(expanded.nodes.map(node => node.id)).toEqual(['root', 'a', 'b', 'c']);
    expect(expanded.nodes.find(node => node.id === 'c')?.canExpand).toBe(false);
    expect(expanded.nodes.find(node => node.id === 'a')?.expanded).toBe(true);
    const collapsed = buildGraphModel('root', index, [chain[0]], options);
    expect(collapsed.nodes.map(node => node.id)).toEqual(['root', 'a']);
    expect(JSON.stringify(chain)).toBe(original);
});

test('branch expansion requeues a previously visible shared node, handles cycles, and preserves another branch on collapse', () => {
    const objects = ['root', 'a', 'z', 'b', 'c'].map(id => object(id));
    const edges = [edge('root', 'a'), edge('root', 'z'), edge('z', 'a'), edge('a', 'b'), edge('b', 'c'), edge('c', 'a')];
    const data = buildDependencyIndex(objects, edges);
    const branch = buildGraphModel('root', data, edges.slice(0, 2), { ...options, expandedBranches: new Set(['z']) });
    expect(branch.nodes.map(node => node.id)).toEqual(['root', 'a', 'z', 'b', 'c']);
    expect(new Set(branch.nodes.map(node => node.id)).size).toBe(branch.nodes.length);
    const collapsed = buildGraphModel('root', data, edges.slice(0, 2), { ...options, expandAll: true, collapsedNodes: new Set(['z']) });
    expect(collapsed.nodes.some(node => node.id === 'b')).toBe(true);
    expect(collapsed.nodes.find(node => node.id === 'z')?.expanded).toBe(false);
    expect(collapsed.nodes.find(node => node.id === 'a')?.expanded).toBe(true);
});

test('inbound expansion retains direction, filters each hop, and does not manufacture filtered neighbors', () => {
    const incoming = chain.map(row => ({ ...row, sourceId: row.targetId, targetId: row.sourceId }));
    const model = buildGraphModel('root', buildDependencyIndex([...index.objects.values()], incoming), [incoming[0]], {
        ...options, expandAll: true, allows: id => id !== 'c',
    });
    expect(model.nodes.map(node => [node.id, node.level])).toEqual([['root', 0], ['a', -1], ['b', -2]]);
    expect(model.links.every(link => link.edges.every(row => row.sourceId !== 'c'))).toBe(true);
});

test('bulk reveal keeps all hub members represented by individual cards or the remaining group', () => {
    const objects = Array.from({ length: 1001 }, (_, i) => object(`item-${i}`));
    const edges = objects.slice(1).map(item => edge('item-0', item.objectId));
    const data = buildDependencyIndex(objects, edges);
    const grouped = buildGraphModel('item-0', data, edges, { ...options, grouping: 'app' });
    const key = grouped.nodes.find(node => node.groupKey)!.groupKey!;
    const expanded = buildGraphModel('item-0', data, edges, { ...options, grouping: 'app', expandAll: true, expandedGroups: new Map([[key, GRAPH_NODE_BUDGET]]) });
    expect(expanded.nodes).toHaveLength(GRAPH_NODE_BUDGET);
    expect(expanded.representedObjects).toBe(1000);
    expect(expanded.omittedObjects).toBe(0);
    expect(expanded.nodes.find(node => node.memberIds)?.memberIds).toHaveLength(942);
    expect(expanded.links.reduce((total, link) => total + link.edges.length, 0)).toBe(1000);
});

test('rejected expansion candidates consume a bounded work budget and remain a disclosed gap', () => {
    const many = Array.from({ length: GRAPH_EXPANSION_WORK + 5 }, (_, i) => ({ ...edge('a', 'excluded'), edgeId: `rejected-${i}` }));
    const data = buildDependencyIndex(['root', 'a', 'excluded'].map(id => object(id)), [chain[0], ...many]);
    const allows = jest.fn(id => id !== 'excluded');
    const model = buildGraphModel('root', data, [chain[0]], { ...options, expandAll: true, allows });
    expect(model.expansionLimited).toBe(true);
    expect(model.nodes.map(node => node.id)).toEqual(['root', 'a']);
    expect(model.links).toHaveLength(1);
    expect(allows).toHaveBeenCalledTimes(GRAPH_EXPANSION_WORK);
});

test('association highlights only the exact rendered relationship and both endpoints, including aggregated relations and loops', () => {
    const edges = [edge('root', 'a'), edge('root', 'a', 'reads'), edge('root', 'b'), edge('root', 'root')];
    const model = buildGraphModel('root', index, edges, options);
    const link = model.links.find(row => row.target === 'a')!;
    const active = graphAssociation(model, { kind: 'link', id: link.id });
    expect([...active.links]).toEqual([link.id]);
    expect([...active.nodes]).toEqual(['root', 'a']);
    expect(link.edges).toHaveLength(2);
    const loop = model.links.find(row => row.target === 'root')!;
    expect([...graphAssociation(model, { kind: 'link', id: loop.id }).nodes]).toEqual(['root']);
    expect(graphAssociation(model, { kind: 'link', id: 'stale' }).links.size).toBe(0);
    expect(graphAssociation(model, null).nodes.size).toBe(0);
});

test.each(['overview', 'detail'] as const)('semantic %s layout preserves evidence and avoids card/label overlap on a cyclic fan-in graph', mode => {
    const objects = Array.from({ length: 35 }, (_, i) => object(`item-${i}`));
    const edges = objects.slice(1).flatMap(item => [edge('item-0', item.objectId), edge(item.objectId, 'item-0')]);
    edges.push(edge('item-0', 'item-0'));
    const original = buildGraphModel('item-0', buildDependencyIndex(objects, edges), edges, options);
    const bytes = JSON.stringify(original); const g = graphGeometry[mode];
    const model = layoutGraph(original, mode);
    expect(JSON.stringify(original)).toBe(bytes);
    expect(model.links).toBe(original.links);
    expect(model.nodes.map(node => node.id)).toEqual(original.nodes.map(node => node.id));
    expect(model.representedObjects).toBe(original.representedObjects);
    expect(model.omittedObjects).toBe(original.omittedObjects);
    model.nodes.forEach(node => model.nodes.filter(other => other.id !== node.id).forEach(other => {
        expect(Math.abs(node.x - other.x) >= g.nodeWidth || Math.abs(node.y - other.y) >= g.nodeHeight).toBe(true);
    }));
    model.labels.forEach(label => {
        expect(label.x + g.labelWidth).toBeLessThanOrEqual(model.width);
        expect(label.y + g.labelHeight).toBeLessThanOrEqual(model.height);
        model.nodes.forEach(node => expect(label.x + g.labelWidth <= node.x || node.x + g.nodeWidth <= label.x ||
            label.y + g.labelHeight <= node.y || node.y + g.nodeHeight <= label.y).toBe(true));
        model.labels.filter(other => other.link.id !== label.link.id).forEach(other => expect(Math.abs(label.x - other.x) >= g.labelWidth ||
            Math.abs(label.y - other.y) >= g.labelHeight).toBe(true));
    });
    expect(layoutGraph(original, mode)).toEqual(model);
});

test('outward ordering brings children near their connected parent rather than sorting them solely by name', () => {
    const objects = ['root', 'a', 'z', 'alpha-child', 'zulu-child'].map(id => object(id));
    const edges = [edge('root', 'a'), edge('root', 'z'), edge('a', 'zulu-child'), edge('z', 'alpha-child')];
    const model = layoutGraph(buildGraphModel('root', buildDependencyIndex(objects, edges), edges.slice(0, 2), { ...options, expandAll: true }), 'detail');
    expect(model.nodes.find(node => node.id === 'zulu-child')!.y).toBeLessThan(model.nodes.find(node => node.id === 'alpha-child')!.y);
    expect(model.nodes.find(node => node.id === 'root')!.y).toBe(64);
});

test('fit uses actual density dimensions and retains the explicit minimum zoom for oversized graphs', () => {
    const model = buildGraphModel('root', index, [chain[0]], options);
    const detail = layoutGraph(model, 'detail');
    const overview = layoutGraph(model, 'overview');
    expect(fitGraphZoom(model, detail.width + 1, detail.height + 1)).toBe(1);
    expect(fitGraphZoom(model, overview.width, overview.height)).toBe(0.9);
    expect(fitGraphZoom(model, 1, 1)).toBe(0.6);
});

function hub(size = 992) {
    const objects = [object('root'), ...Array.from({ length: size }, (_, i) => object(`neighbor-${String(i).padStart(4, '0')}`))];
    const edges = objects.slice(1).map(item => edge('root', item.objectId));
    const data = buildDependencyIndex(objects, edges);
    const grouped = buildGraphModel('root', data, edges, { ...options, grouping: 'app' });
    const key = grouped.nodes.find(node => node.groupKey)!.groupKey!;
    return { data, edges, model: buildGraphModel('root', data, edges, { ...options, grouping: 'app', expandAll: true,
        expandedGroups: new Map([[key, GRAPH_NODE_BUDGET]]) }) };
}

test('a 992-reference expanded hub is viewport-bounded, paged, and loses no member or reference', () => {
    const { model, edges } = hub(); const bytes = JSON.stringify(model);
    const view = viewportGraph(model, { width: 960, height: 600, zoom: 1, offsets: new Map() });
    expect(model.nodes).toHaveLength(60);
    expect(view.nodes).toHaveLength(3);
    expect(view.mode).toBe('overview');
    expect(view.height).toBeLessThanOrEqual(600);
    expect(view.nodes.find(node => node.id === 'root')?.y).toBe(64);
    expect(view.windows).toEqual([{ level: 1, start: 0, end: 1, total: 59, pageSize: 1 }]);
    expect(new Set(view.nodes.flatMap(node => node.memberIds ?? [node.id]))).toEqual(new Set(['root', ...edges.map(row => row.targetId)]));
    expect(view.links.flatMap(link => link.edges).sort((a, b) => a.edgeId.localeCompare(b.edgeId))).toEqual([...edges].sort((a, b) => a.edgeId.localeCompare(b.edgeId)));
    const next = viewportGraph(model, { width: 960, height: 600, zoom: 1, offsets: new Map([[1, 1]]) });
    expect(next.nodes.some(node => node.id === 'neighbor-0001')).toBe(true);
    expect(next.nodes.some(node => node.id === 'neighbor-0000')).toBe(false);
    expect(next.links.flatMap(link => link.edges)).toHaveLength(992);
    expect(JSON.stringify(model)).toBe(bytes);
});

test('zoom and resizing adapt a high-degree page while retaining exact captured evidence', () => {
    const { model } = hub();
    [0.6, 0.9, 1, 1.6].forEach(zoom => [350, 600, 900].forEach(height => {
        const view = viewportGraph(model, { width: 960, height, zoom, offsets: new Map([[1, 10]]) });
        expect(view.height * zoom).toBeLessThanOrEqual(Math.max(height, (view.geometry.nodeHeight + 88) * zoom));
        expect(view.nodes.filter(node => node.level === 1).length).toBeLessThanOrEqual(4);
        expect(new Set(view.links.flatMap(link => link.edges.map(row => row.edgeId))).size).toBe(992);
        expect(view.nodes.find(node => node.continuation)?.memberIds?.length).toBeGreaterThan(900);
    }));
});

test('dense cyclic labels use compact slots, disclose undrawn connections, and cannot stretch the map vertically', () => {
    const objects = ['root', ...Array.from({ length: 12 }, (_, i) => `n${i}`)].map(id => object(id));
    const edges = objects.slice(1).flatMap(source => objects.slice(1).map(target => edge(source.objectId, target.objectId)));
    const direct = objects.slice(1).map(item => edge('root', item.objectId));
    const model = buildGraphModel('root', buildDependencyIndex(objects, [...direct, ...edges]), direct, { ...options, expandAll: true });
    const view = viewportGraph(model, { width: 1000, height: 900, zoom: 1, offsets: new Map() });
    expect(view.compactLabels).toBe(true);
    expect(view.hiddenLinks).toBeGreaterThan(0);
    expect(view.height).toBeLessThanOrEqual(900);
    expect(view.links.flatMap(link => link.edges)).toHaveLength(model.links.flatMap(link => link.edges).length);
    view.labels.forEach(label => {
        view.labels.filter(other => other.link.id !== label.link.id).forEach(other => expect(Math.abs(label.x - other.x) >= view.geometry.labelWidth ||
            Math.abs(label.y - other.y) >= view.geometry.labelHeight).toBe(true));
        view.nodes.forEach(node => expect(label.x + view.geometry.labelWidth <= node.x || node.x + view.geometry.nodeWidth <= label.x ||
            label.y + view.geometry.labelHeight <= node.y || node.y + view.geometry.nodeHeight <= label.y).toBe(true));
    });
});

test('connection focus exposes an exact off-page reference without inferring a path or changing the source graph', () => {
    const { model, data, edges } = hub(); const bytes = JSON.stringify(model);
    const selected = edges[900];
    expect(model.nodes.some(node => node.id === selected.targetId)).toBe(false);
    const focused = viewportGraph(connectionGraph(selected, data), { width: 960, height: 600, zoom: 0.9, offsets: new Map() });
    expect(focused.nodes.map(node => node.id)).toEqual([selected.sourceId, selected.targetId]);
    expect(focused.links[0].edges).toEqual([selected]);
    expect(focused.nodes.every(node => !node.witness && !node.memberIds)).toBe(true);
    expect(focused.width * 0.9).toBeLessThan(960);
    expect(focused.height * 0.9).toBeLessThan(600);
    expect(JSON.stringify(model)).toBe(bytes);
});

test('unresolved and self-referencing endpoints retain uncertainty in focused context', () => {
    const unresolved = { ...edge('root', 'missing'), resolved: false, confidence: 'unknown' as const };
    const focused = connectionGraph(unresolved, index);
    expect(focused.nodes.find(node => node.id === 'missing')).toMatchObject({ resolved: false, status: 'unknown' });
    expect(focused.links[0].edges[0]).toBe(unresolved);
    const self = edge('root', 'root');
    expect(connectionGraph(self, index).nodes).toHaveLength(1);
    expect(connectionGraph(self, index).links[0].edges).toEqual([self]);
});
