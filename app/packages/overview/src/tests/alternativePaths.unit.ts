// Synthetic contracts only. Never installed as native content or review state.
import { buildDependencyIndex } from '../services/dependencyGraph';
import { ALTERNATIVE_PATH_LIMITATION, ALTERNATIVE_PATH_LIMITS, investigateAlternativePaths, pathInvestigationCsv } from '../services/alternativePaths';
import { buildInUseReport } from '../services/inUseContent';
import { analyzeRemovalImpact } from '../services/removalImpact';
import { investigatedPathGraph } from '../services/graphPresentation';
import { callerReceipt, pathFixture, scopedEdge } from './pathContextFixtures';
import { edge, now, object, review } from './milestoneFixtures';

function fixture() {
    const original = pathFixture();
    const extra = object('z', 'Field Alias');
    const edges = [...original.edges, scopedEdge('a', 'z'), scopedEdge('z', 'c')];
    const objects = [...original.objects, extra];
    return { ...original, objects, edges, index: buildDependencyIndex(objects, edges), baseline: original.edges.map(item => item.edgeId) };
}

test('keeps the original witness and exact independent alternative receipts', () => {
    const { index, baseline } = fixture();
    const result = investigateAlternativePaths(index, 'caller', 'c', baseline);
    expect(result.paths).toHaveLength(2);
    expect(result.paths[0]).toMatchObject({ baseline: true, edgeIds: baseline, context: { status: 'shared_caller' } });
    expect(result.paths[1]).toMatchObject({ baseline: false, objectIds: ['caller', 'a', 'z', 'c'], confidence: 'medium', conditional: true, context: { status: 'shared_caller', callerWitnesses: [callerReceipt()] } });
    expect(result.limits).toEqual([]);
});

test('retains a mixed original and displays a caller-supported alternative independently', () => {
    const { objects, edges, baseline } = fixture();
    const mixed = edges.map(item => item.sourceId === 'b' ? scopedEdge('b', 'c', [callerReceipt({ sourceLocation: 'dashboard.panel[1].query' })]) : item);
    const result = investigateAlternativePaths(buildDependencyIndex(objects, mixed), 'caller', 'c', baseline);
    expect(result.paths[0].context.status).toBe('mixed');
    expect(result.paths[1].context.status).toBe('shared_caller');
    expect(result.paths[0].edgeIds).toEqual(baseline);
    expect(result.paths[0].confidence).toBe('medium');
});

test('does not union independent queries or app namespaces into one stronger path', () => {
    const { objects, edges, baseline } = fixture();
    const changed = edges.map(item => item.sourceId === 'z' ? scopedEdge('z', 'c', [callerReceipt({ callerObjectId: 'other-caller' })]) : item);
    const result = investigateAlternativePaths(buildDependencyIndex(objects, changed), 'caller', 'c', baseline);
    expect(result.paths[1].context.status).toBe('mixed');
    expect(result.paths[1].context.callerWitnesses).toEqual([]);
    const apps = changed.map(item => item.sourceId === 'z' ? scopedEdge('z', 'c', [callerReceipt()], ['other']) : item);
    expect(investigateAlternativePaths(buildDependencyIndex(objects, apps), 'caller', 'c', baseline).paths[1].context.status).toBe('mixed');
});

test('is deterministic under object, adjacency and duplicate-identical input reordering', () => {
    const { objects, edges, index, baseline } = fixture();
    const first = investigateAlternativePaths(index, 'caller', 'c', baseline);
    const reordered = buildDependencyIndex([...objects].reverse(), [...edges].reverse().concat(edges[0]));
    const other = investigateAlternativePaths(reordered, 'caller', 'c', baseline);
    expect(other.paths).toEqual(first.paths);
    expect(other.relationships).toEqual(first.relationships);
});

test('finds separate routes through a shared node without a global visited-node false negative', () => {
    const objects = ['a', 'b', 'c', 'd', 'e'].map(id => object(id));
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd'), edge('d', 'e')];
    expect(investigateAlternativePaths(buildDependencyIndex(objects, edges), 'a', 'e').paths.map(item => item.objectIds)).toEqual([
        ['a', 'b', 'd', 'e'], ['a', 'c', 'd', 'e'],
    ]);
});

test('excludes cycles, reversals and app containment without changing original containment witnesses', () => {
    const objects = ['a', 'b', 'c'].map(id => object(id));
    const contained = edge('a', 'c', 'belongs_to');
    const index = buildDependencyIndex(objects, [edge('a', 'a'), edge('a', 'b'), edge('b', 'a'), edge('c', 'b'), contained]);
    expect(investigateAlternativePaths(index, 'a', 'c').paths).toEqual([]);
    expect(investigateAlternativePaths(index, 'a', 'c', [contained.edgeId]).paths).toMatchObject([{ baseline: true, edgeIds: [contained.edgeId] }]);
});

test('parallel captured references remain distinct by exact edge identity', () => {
    const objects = ['a', 'b'].map(id => object(id));
    const index = buildDependencyIndex(objects, [edge('a', 'b'), edge('a', 'b', 'uses_lookup')]);
    expect(investigateAlternativePaths(index, 'a', 'b').paths).toHaveLength(2);
});

test('ambiguous duplicate edge IDs remain unknown, not a last-write-wins path', () => {
    const objects = ['a', 'b', 'c'].map(id => object(id));
    const first = edge('a', 'b'); const ambiguous = { ...edge('a', 'c'), edgeId: first.edgeId };
    const result = investigateAlternativePaths(buildDependencyIndex(objects, [first, ambiguous]), 'a', 'b', [first.edgeId]);
    expect(result.paths).toEqual([]); expect(result.limits).toEqual(['baseline', 'identity']);
});

test.each(['missing', 'same'] as const)('missing or identical endpoints do not imply absence: %s', kind => {
    const { index } = fixture();
    const result = investigateAlternativePaths(index, 'caller', kind === 'same' ? 'caller' : 'missing');
    expect(result.paths).toEqual([]); expect(result.limits).toContain('identity');
    expect(result.limitation).toBe(ALTERNATIVE_PATH_LIMITATION);
});

test('unresolved and hidden intermediates do not become supported alternatives', () => {
    const objects = ['a', 'c'].map(id => object(id));
    const result = investigateAlternativePaths(buildDependencyIndex(objects, [edge('a', 'hidden'), edge('hidden', 'c'), { ...edge('a', 'c'), resolved: false }]), 'a', 'c');
    expect(result.paths).toEqual([]); expect(result.limits).toContain('identity');
});

test.each([{ edgeVisits: 0 }, { edgeVisits: 1 }, { states: 0 }, { states: 1 }, { hops: 0 }, { candidates: 0 }, { edgeVisits: Number.NaN }])('every rejected/preparation step is bounded and disclosed: %j', options => {
    const { index } = fixture(); const result = investigateAlternativePaths(index, 'caller', 'c', [], options);
    expect(result.paths).toEqual([]); expect(result.limits.length).toBeGreaterThan(0);
    expect(result.diagnostics.edgeVisits).toBeLessThanOrEqual(options.edgeVisits && Number.isFinite(options.edgeVisits) ? options.edgeVisits : ALTERNATIVE_PATH_LIMITS.edgeVisits);
    expect(result.diagnostics.states).toBeLessThanOrEqual(options.states ?? ALTERNATIVE_PATH_LIMITS.states);
});

test('depth limit does not drop a longer existing witness or label it a new alternative', () => {
    const objects = Array.from({ length: 9 }, (_, i) => object(String(i)));
    const edges = objects.slice(1).map((item, i) => edge(String(i), item.objectId));
    const result = investigateAlternativePaths(buildDependencyIndex(objects, edges), '0', '8', edges.map(item => item.edgeId));
    expect(result.paths).toHaveLength(1); expect(result.paths[0].baseline).toBe(true); expect(result.limits).toContain('depth');
});

test('invalid/disconnected/oversized original paths are explicitly withheld, never guessed', () => {
    const { index } = fixture();
    [['missing'], [edge('b', 'c').edgeId], Array(33).fill('missing')].forEach(baseline => {
        expect(investigateAlternativePaths(index, 'caller', 'c', baseline).limits).toContain('baseline');
    });
});

test('candidate fanout is capped, output is three alternatives and scale work remains finite', () => {
    const objects = ['a', 'z', ...Array.from({ length: 100 }, (_, i) => `b-${i}`)].map(id => object(id));
    const edges = objects.slice(2).flatMap(item => [edge('a', item.objectId), edge(item.objectId, 'z')]);
    const result = investigateAlternativePaths(buildDependencyIndex(objects, edges), 'a', 'z');
    expect(result.paths).toHaveLength(3); expect(result.diagnostics.completedCandidates).toBe(64); expect(result.limits).toContain('candidates');
    expect(result.diagnostics.edgeVisits).toBeLessThanOrEqual(20000);
    const broad = buildDependencyIndex(objects, Array.from({ length: 20001 }, (_, i) => ({ ...edge('a', 'z'), edgeId: `wide-${i}` })));
    expect(investigateAlternativePaths(broad, 'a', 'z')).toMatchObject({ paths: [], limits: ['edge_visits'] });
});

test('CSV and JSON retain exact ordered provenance/context and zero-path limitations', () => {
    const { index, baseline } = fixture(); const result = investigateAlternativePaths(index, 'caller', 'c', baseline);
    const csv = pathInvestigationCsv(result);
    expect(csv.rows).toHaveLength(6);
    result.paths.forEach(item => {
        const rows = csv.rows.filter(row => row[csv.columns.indexOf('Path ID')] === item.id);
        expect(rows.map(row => row[csv.columns.indexOf('Edge ID')])).toEqual(item.edgeIds);
        expect(rows.every(row => JSON.stringify(item.context) === row[csv.columns.indexOf('Path context')])).toBe(true);
        rows.forEach(row => expect(JSON.parse(String(row[csv.columns.indexOf('Field provenance')]))).toEqual(index.edgeById.get(String(row[csv.columns.indexOf('Edge ID')]))?.fieldProvenance ?? null));
    });
    expect(pathInvestigationCsv(investigateAlternativePaths(index, 'missing', 'c')).rows).toHaveLength(1);
});

test('path focus is exactly the selected path, not an inferred or re-centered graph', () => {
    const { index, baseline } = fixture(); const report = investigateAlternativePaths(index, 'caller', 'c', baseline);
    const chosen = report.paths[1]; const graph = investigatedPathGraph(chosen.edgeIds.map(id => index.edgeById.get(id)!), index);
    expect(graph.nodes.map(node => node.id)).toEqual(chosen.objectIds);
    expect(graph.links.map(link => link.id)).toEqual(chosen.edgeIds);
    expect(graph.links.flatMap(link => link.edges)).toEqual(chosen.edgeIds.map(id => index.edgeById.get(id)));
});

test('comparison does not change graph facts, report membership, impact blockers or saved decisions', () => {
    const { data, objects, edges, index, baseline } = fixture(); const saved = review('caller');
    const snapshot = { ...data, objects, edges }; const before = JSON.stringify([snapshot, saved]);
    const required = buildInUseReport(snapshot, [saved], { activity: 'none', includeRetained: true, successfulOnly: false }, now);
    const selected = objects.find(item => item.objectId === 'c')!;
    const impact = analyzeRemovalImpact(selected, objects, edges, [saved], snapshot.scan, 5, now);
    investigateAlternativePaths(index, 'caller', 'c', baseline);
    expect(JSON.stringify([snapshot, saved])).toBe(before);
    expect(buildInUseReport(snapshot, [saved], { activity: 'none', includeRetained: true, successfulOnly: false }, now)).toEqual(required);
    expect(analyzeRemovalImpact(selected, objects, edges, [saved], snapshot.scan, 5, now)).toEqual(impact);
});
