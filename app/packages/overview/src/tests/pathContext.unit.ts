import { createPathContextTracker, PATH_CONTEXT_HOPS } from '../services/pathContext';
import { buildInUseReport } from '../services/inUseContent';
import { analyzeRemovalImpact } from '../services/removalImpact';
import { buildDependencyIndex, buildGraphModel } from '../services/dependencyGraph';
import { edge, now, object, review } from './milestoneFixtures';
import { callerReceipt, pathFixture, scopedEdge } from './pathContextFixtures';
import { analyzeInventory } from '../services/analysis';
import { field, fieldCompleteness } from './fieldFixtures';

test('one exact receipt is intersected across scoped hops without changing source facts', () => {
    const { byId, edges } = pathFixture(); const original = JSON.stringify(edges);
    const tracker = createPathContextTracker(byId); const result = tracker.path('caller', edges);
    expect(result).toMatchObject({ status: 'shared_caller', hopCount: 3, scopedHopCount: 3, apps: ['example'], callerWitnesses: [callerReceipt()], reasons: [] });
    expect(JSON.stringify(edges)).toBe(original);
});
test.each(['query', 'panel', 'caller', 'selectors'] as const)('different %s receipts never become a shared query by union', difference => {
    const { byId } = pathFixture();
    let changes = { sourceLocation: `dashboard.${difference}[1].query` };
    if (difference === 'caller') { changes = { ...callerReceipt({ callerObjectId: 'other-caller' }) }; }
    if (difference === 'selectors') { changes = { ...callerReceipt({ selectors: [...callerReceipt().selectors.slice(0, 1), { field: 'host', value: 'web-02', sourceLocation: 'dashboard.panel[0].query:18' }] }) }; }
    const next = callerReceipt(changes);
    const result = createPathContextTracker(byId).path('a', [scopedEdge('a', 'b'), scopedEdge('b', 'c', [next])]);
    expect(result).toMatchObject({ status: 'mixed', callerWitnesses: [], reasons: expect.arrayContaining(['different_callers']) });
});
test('app alternatives are intersected, not interpreted as all apps or all combinations', () => {
    const { byId } = pathFixture();
    const receipt = callerReceipt({ callerObjectId: 'other-app-caller', app: 'other' });
    expect(createPathContextTracker(byId).path('a', [scopedEdge('a', 'b', [callerReceipt(), receipt], ['example', 'other']),
        scopedEdge('b', 'c', [receipt], ['other'])])).toMatchObject({ status: 'shared_caller', apps: ['other'], callerWitnesses: [receipt] });
    expect(createPathContextTracker(byId).path('a', [scopedEdge('a', 'b'), scopedEdge('b', 'c', [receipt], ['other'])])).toMatchObject({ status: 'mixed', apps: [], callerWitnesses: [] });
    expect(createPathContextTracker(byId).path('a', [scopedEdge('a', 'b', [callerReceipt(), receipt], ['example', 'other']),
        scopedEdge('b', 'c', [receipt], ['example', 'other'])])).toMatchObject({ status: 'shared_caller', apps: ['other'], callerWitnesses: [receipt] });
});
test('a fixed starting caller and the exact event selector must agree with the receipt', () => {
    const { byId, edges } = pathFixture();
    expect(createPathContextTracker(byId).path('other-caller', [{ ...edges[0], sourceId: 'other-caller' }, ...edges.slice(1)]).status).toBe('mixed');
    const changed = { ...edges[0], fieldProvenance: { ...edges[0].fieldProvenance!, contexts: [{ ...edges[0].fieldProvenance!.contexts![0],
        selector: { ...callerReceipt().selectors[0], sourceLocation: 'dashboard.panel[1].query:0' } }] } };
    expect(createPathContextTracker(byId).path('caller', [changed, ...edges.slice(1)]).status).toBe('mixed');
});
test('discarding alternative receipts must not invalidate the common exact starting caller', () => {
    const { byId, edges } = pathFixture();
    const alternatives = [callerReceipt({ callerObjectId: 'other-caller' }), callerReceipt()];
    expect(createPathContextTracker(byId).path('caller', [edges[0], scopedEdge('a', 'b', alternatives), scopedEdge('b', 'c', alternatives)])).toMatchObject({
        status: 'shared_caller', callerWitnesses: [callerReceipt()], reasons: [],
    });
});
test('an uncertain alternative cannot hide another fully supported common receipt', () => {
    const { byId } = pathFixture(); const first = scopedEdge('a', 'b');
    first.fieldProvenance!.scopeCompatibility = { version: 1, basis: 'same_literal',
        consumer: { field: 'host', value: 'web-01', exact: true }, producer: { field: 'host', value: 'WEB-01', exact: true } };
    const other = callerReceipt({ callerObjectId: 'other-caller', selectors: [callerReceipt().selectors[0],
        { field: 'source', value: '/var/log/access', sourceLocation: 'query:20' }] });
    expect(createPathContextTracker(byId).path('a', [first, scopedEdge('b', 'c', [other, callerReceipt()])])).toMatchObject({
        status: 'shared_caller', callerWitnesses: [callerReceipt()], reasons: [],
    });
});
test.each(['missing', 'invocation', 'malformed', 'unknown-caller', 'wrong-app'] as const)('%s context cannot become a supported chain', kind => {
    const { byId } = pathFixture(); const first = scopedEdge('a', 'b');
    if (kind === 'missing') { delete first.fieldProvenance; }
    if (kind === 'invocation') { first.fieldProvenance!.invocation = 'invoking_app_unverified'; }
    if (kind === 'malformed') { first.fieldProvenance!.scopeCompatibility!.callerWitnesses = []; }
    if (kind === 'unknown-caller') { first.fieldProvenance!.scopeCompatibility!.callerWitnesses = [callerReceipt({ callerObjectId: 'missing' })]; }
    if (kind === 'wrong-app') { first.fieldProvenance!.scopeCompatibility!.callerWitnesses = [callerReceipt({ app: 'other' })]; }
    const result = createPathContextTracker(byId).path('a', [first, scopedEdge('b', 'c')]);
    expect(['unverified', 'mixed']).toContain(result.status);
    expect(result.reasons.length).toBeGreaterThan(0);
});
test('app-only field metadata does not supply a query receipt; lexical paths do not imply invocation', () => {
    const { byId } = pathFixture(); const first = scopedEdge('a', 'b'); delete first.fieldProvenance!.scopeCompatibility;
    expect(createPathContextTracker(byId).path('a', [first])).toMatchObject({ status: 'app_only', callerWitnesses: [] });
    expect(createPathContextTracker(byId).path('a', [edge('a', 'b')])).toMatchObject({ status: 'static_only', scopedHopCount: 0 });
});
test('unknown invocation never constrains the path to the reusable definition owning app', () => {
    const { byId } = pathFixture(); const binding = scopedEdge('b', 'c', [], ['owning-app-only']);
    binding.fieldProvenance!.invocation = 'invoking_app_unverified';
    binding.fieldProvenance!.kind = 'lookup_binding'; delete binding.fieldProvenance!.scopeCompatibility;
    expect(createPathContextTracker(byId).path('a', [scopedEdge('a', 'b'), binding])).toMatchObject({
        status: 'unverified', apps: ['example'], reasons: ['invoking_app'], callerWitnesses: [callerReceipt()],
    });
});
test.each(['same_literal', 'bounded_intersection', 'captured_default'] as const)('a preceding %s domain is checked conservatively when a receipt arrives', basis => {
    const { byId } = pathFixture(); const first = scopedEdge('a', 'b');
    first.fieldProvenance!.scopeCompatibility = { version: 1, basis, consumer: { field: 'sourcetype', value: 'access', exact: true },
        producer: { field: 'sourcetype', value: 'access', exact: true } };
    const result = createPathContextTracker(byId).path('a', [first, scopedEdge('b', 'c')]);
    expect(result.status).toBe(basis === 'same_literal' ? 'shared_caller' : 'unverified');
    first.fieldProvenance!.scopeCompatibility.consumer.value = 'different';
    expect(createPathContextTracker(byId).path('a', [first, scopedEdge('b', 'c')]).status).toBe(basis === 'same_literal' ? 'mixed' : 'unverified');
});
test('separate branches cannot be passed as a contiguous witness', () => {
    const { byId } = pathFixture();
    expect(createPathContextTracker(byId).path('a', [scopedEdge('a', 'b'), scopedEdge('a', 'c')])).toMatchObject({ status: 'unverified', reasons: ['disconnected'] });
});
test.each([{ work: 0 }, { work: 3 }, { bytes: 0 }])('explicit %j ceiling is uncertainty, never support', limits => {
    const { byId, edges } = pathFixture(); const tracker = createPathContextTracker(byId, limits);
    expect(tracker.path('caller', edges)).toMatchObject({ status: 'bounded', reasons: expect.arrayContaining(['budget']) });
    expect(tracker.diagnostics().bounded).toBe(true);
});
test('excess app and scoped-hop evidence is bounded, while long lexical paths remain finite', () => {
    const { byId } = pathFixture();
    expect(createPathContextTracker(byId).path('a', [scopedEdge('a', 'b', [], Array.from({ length: 33 }, (_, i) => `app-${i}`))]).reasons).toContain('budget');
    const scoped = Array.from({ length: PATH_CONTEXT_HOPS + 1 }, (_, i) => scopedEdge(String(i), String(i + 1)));
    expect(createPathContextTracker(byId).path('0', scoped).reasons).toContain('budget');
    const lexical = Array.from({ length: 2000 }, (_, i) => edge(String(i), String(i + 1)));
    const complete = new Map(Array.from({ length: 2001 }, (_, i) => [String(i), object(String(i))]));
    expect(createPathContextTracker(complete).path('0', lexical)).toMatchObject({ status: 'static_only', hopCount: 2000 });
});
test('unresolved or hidden endpoints stay unverified even with matching caller receipts', () => {
    const { byId } = pathFixture();
    expect(createPathContextTracker(byId).path('a', [{ ...scopedEdge('a', 'b'), resolved: false }])).toMatchObject({ status: 'unverified', reasons: ['unresolved'] });
    expect(createPathContextTracker(byId).path('a', [scopedEdge('a', 'missing')]).status).toBe('unverified');
});
test('actual parser provenance composes a three-dimension earlier-phase chain without executing expressions', () => {
    const extraction = field('field_extractions', 'EXTRACT-user', '(?<actor>[^ ]+)', 'example', 'app', 'source::/var/...');
    const alias = field('field_aliases', 'FIELDALIAS-user', 'actor AS principal', 'example', 'app', 'host::node*');
    const calculated = field('calculated_fields', 'EVAL-user', 'principal'); const caller = object('native-shaped-caller', 'Report');
    const result = analyzeInventory([extraction.item, alias.item, calculated.item, caller], [extraction.source, alias.source, calculated.source,
        { objectId: caller.objectId, kind: 'spl', sourceLocation: 'query', text: 'sourcetype=example:events host=node1 source=/var/log/access.log' }], fieldCompleteness);
    const find = (source: string, target: string) => result.edges.find(item => item.sourceId === source && item.targetId === target)!;
    const path = [find(caller.objectId, calculated.item.objectId), find(calculated.item.objectId, alias.item.objectId), find(alias.item.objectId, extraction.item.objectId)];
    expect(path.every(Boolean)).toBe(true);
    const context = createPathContextTracker(new Map(result.objects.map(item => [item.objectId, item]))).path(caller.objectId, path);
    expect(context).toMatchObject({ status: 'shared_caller', scopedHopCount: 3, callerWitnesses: [expect.objectContaining({ callerObjectId: caller.objectId, selectors: expect.any(Array) })] });
    expect(context.callerWitnesses[0].selectors).toHaveLength(3);
    expect(path.every(item => item.confidence === 'medium' && item.relation.startsWith('may_'))).toBe(true);
});
test('branch states are immutable and a different sibling cannot erase support', () => {
    const { byId } = pathFixture(); const tracker = createPathContextTracker(byId); const parent = tracker.advance(tracker.start('a'), scopedEdge('a', 'b'));
    const sibling = tracker.advance(parent, scopedEdge('b', 'c', [callerReceipt({ callerObjectId: 'other-caller' })]));
    expect(tracker.evidence(sibling).status).toBe('mixed');
    expect(tracker.evidence(tracker.advance(parent, scopedEdge('b', 'c'))).status).toBe('shared_caller');
    expect(parent.callers).toEqual([callerReceipt()]);
});
test('required-content and inbound impact annotate the same ordered path without pruning or rewriting reviews', () => {
    const { data, objects, edges } = pathFixture(); const saved = review('c'); const bytes = JSON.stringify(saved); const input = JSON.stringify(data);
    const options = { selectedIds: ['caller'], activity: 'none' as const, includeRetained: false, successfulOnly: false };
    const report = buildInUseReport(data, [saved], options, now);
    const impact = analyzeRemovalImpact(objects.find(item => item.objectId === 'c')!, objects, edges, [saved], data.scan, 5, now);
    expect(report.rows.find(row => row.objectId === 'c')?.via?.pathContext).toEqual(impact.affectedObjects.find(row => row.objectId === 'caller')?.pathContext);
    expect(impact.affectedObjects.find(row => row.objectId === 'caller')?.pathEdgeIds).toEqual(edges.map(item => item.edgeId));
    expect(report.rows).toHaveLength(4); expect(impact.affectedObjects).toHaveLength(3);
    expect(impact.readiness).toBe('blocked');
    expect(JSON.stringify(saved)).toBe(bytes); expect(JSON.stringify(data)).toBe(input);
    const mixedEdges = [edges[0], edges[1], scopedEdge('b', 'c', [callerReceipt({ callerObjectId: 'other-caller' })])];
    expect(buildInUseReport({ ...data, edges: mixedEdges }, [saved], options, now).rows.find(row => row.objectId === 'c')?.via?.pathContext.status).toBe('mixed');
    expect(analyzeRemovalImpact(objects.find(item => item.objectId === 'c')!, objects, mixedEdges, [saved], data.scan, 5, now).affectedObjects).toHaveLength(3);
});
test('graph expansion preserves ordered inbound/outbound witnesses and does not blend cycles or alternative paths', () => {
    const { objects, edges } = pathFixture(); const all = [...edges, edge('c', 'a')]; const index = buildDependencyIndex(objects, all);
    const options = { grouping: 'none' as const, expandedGroups: new Map<string, number>(), expandedNodes: new Set(['a', 'b']) };
    const forward = buildGraphModel('caller', index, [edges[0]], options);
    expect(forward.nodes.find(node => node.id === 'c')?.witness).toMatchObject({ direction: 'outbound', edgeIds: edges.map(item => item.edgeId), context: { status: 'shared_caller' } });
    const backward = buildGraphModel('c', index, [edges[2]], options);
    expect(backward.nodes.find(node => node.id === 'caller')?.witness).toMatchObject({ direction: 'inbound', objectIds: ['caller', 'a', 'b', 'c'], context: { status: 'shared_caller' } });
    expect(backward.nodes.filter(node => node.id === 'c')).toHaveLength(1);
});
test('multiple report roots retain independent witnesses; an earlier weak witness is not silently replaced', () => {
    const { data, edges } = pathFixture(); const options = { selectedIds: ['a', 'other-caller'], activity: 'none' as const, includeRetained: false, successfulOnly: false };
    const result = buildInUseReport({ ...data, edges: [edge('other-caller', 'b'), ...edges] }, [], options, now);
    expect(result.rows.find(row => row.objectId === 'b')?.via).toMatchObject({ rootId: 'a', pathContext: { status: 'shared_caller' } });
    expect(result.relationships.map(item => item.edgeId)).toContain(edge('other-caller', 'b').edgeId);
    expect(result.rows.find(row => row.objectId === 'c')?.via?.pathContext.callerWitnesses).toEqual([callerReceipt()]);
});
