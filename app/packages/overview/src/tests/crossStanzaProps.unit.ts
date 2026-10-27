// Adversarial synthetic contracts only. Native qualification is separate.
import { analyzeInventory } from '../services/analysis';
import { parseDashboard, parseSpl } from '../services/dependencyParser';
import { compareCrossStanzaProps } from '../services/crossStanzaProps';
import { readCrossStanzaProps } from '../services/crossStanzaEvidence';
import { checkPropsPrecedence, PropsRead } from '../services/propsPrecedence';
import { readFieldLineageFacts, readFieldProvenance } from '../services/fieldLineage';
import { attachReviewEvidence, compareReviewEvidence, parseReviewBaseline } from '../services/reviewEvidence';
import { field, fieldCompleteness } from './fieldFixtures';
import { now, object, review, snapshot } from './milestoneFixtures';
import { ContentObject, DependencyEdge } from '../types';
import { buildInUseReport } from '../services/inUseContent';
import { analyzeRemovalImpact } from '../services/removalImpact';

export function crossStanzaFixture(query = 'index=main sourcetype=events host=server source=/var/log/app.log', stanzas = ['events', 'host::server', 'source::/var/log/app.log']) {
    const caller = { ...object('caller', 'Saved Search'), app: 'example' };
    const rules = stanzas.map(stanza => field('field_aliases', 'FIELDALIAS-owner', 'actor AS owner', 'example', 'app', stanza));
    const analysis = analyzeInventory([caller, ...rules.map(row => row.item)], [{ objectId: caller.objectId, kind: 'spl', text: query, sourceLocation: 'search' },
        ...rules.map(row => row.source)], fieldCompleteness);
    analysis.objects = analysis.objects.map(item => !item.fieldLineage ? item : { ...item, fieldLineage: { ...item.fieldLineage,
        propsContexts: [{ version: 1, objectId: item.objectId, app: 'example', status: 'local', selectedObjectId: item.objectId,
            valueDigest: 'a'.repeat(64), reason: 'matched', stanzaPriority: 100 }] } });
    const edges = analysis.edges.filter(edge => edge.fieldProvenance?.kind === 'event_scope');
    return { ...analysis, edges, caller, rules };
}
const compare = (data: ReturnType<typeof crossStanzaFixture>, options = {}) => compareCrossStanzaProps(data.objects, data.edges, data.propsEventScopes, { catalogsComplete: true, ...options });
const observations = (edges: DependencyEdge[]) => edges.flatMap(edge => edge.fieldProvenance?.crossStanzaProps ?? []);

test.each(['index=main sourcetype=events host=server source=/var/log/app.log', 'search sourcetype = events AND host = "server" source="/var/log/app.log" | stats count'])('preserves one strict initial-search conjunction (%s)', text => {
    const parsed = parseSpl(text); expect(parsed.propsEventScopes).toHaveLength(1);
    expect(parsed.propsEventScopes![0].selectors.map(item => item.field)).toEqual(['sourcetype', 'host', 'source']);
});
test.each(['sourcetype=events OR host=server', 'sourcetype=events NOT host=server', 'sourcetype IN (events,other) host=server',
    '(sourcetype=events host=server)', '`runtime` sourcetype=events host=server', 'inputlookup table | search sourcetype=events host=server',
    '| makeresults | eval sourcetype="events",host="server"', 'sourcetype=events [ search host=server ]',
    'sourcetype=events host=$token$', 'sourcetype=events host=server*', 'sourcetype=events sourcetype=other host=server',
    'sourcetype=events host=server AND', 'sourcetype=events OR=foo host=server OR source=x', 'sourcetype="unterminated" host="ser\\ver"', 'sourcetype="unterminated'])('does not merge ambiguous, dynamic or manufactured scopes (%s)', text => {
    expect(parseSpl(text).propsEventScopes).toEqual([]);
});
test('separate dashboard queries and post-process chains never become a shared event conjunction', () => {
    const parsed = parseDashboard('<dashboard><search><query>sourcetype=events</query></search><search><query>host=server</query></search><search base="x"><query>source=/var/log/app.log</query></search></dashboard>');
    expect(parsed.propsEventScopes).toHaveLength(2); expect(parsed.propsEventScopes!.every(scope => scope.selectors.length === 1)).toBe(true);
    expect(new Set(parsed.propsEventScopes!.map(scope => scope.sourceLocation)).size).toBe(2);
});
test('source precedes host then sourcetype for the same captured attribute; priority cannot reverse categories', async () => {
    const data = crossStanzaFixture(); data.objects.find(item => item.fieldLineage?.scope?.field === 'sourcetype')!.fieldLineage!.propsContexts![0].stanzaPriority = 999;
    const before = JSON.stringify([data.objects, data.edges]); const result = await compare(data); const rows = observations(result.edges);
    expect(rows).toHaveLength(3); expect(rows.filter(row => row.status === 'highest')).toHaveLength(1);
    const selected = data.rules[2].item.objectId;
    expect(rows.every(row => row.selectedObjectId === selected && row.reason === 'category')).toBe(true);
    expect(result.edges.map(edge => ({ ...edge, fieldProvenance: undefined }))).toEqual(data.edges.map(edge => ({ ...edge, fieldProvenance: undefined })));
    expect(JSON.stringify([data.objects, data.edges])).toBe(before);
    result.objects.filter(item => item.fieldLineage).forEach(item => expect(readFieldLineageFacts(item.fieldLineage)?.crossStanzaProps).toEqual(expect.arrayContaining([expect.objectContaining({ selectedObjectId: selected })])));
    result.edges.forEach(edge => expect(readFieldProvenance(edge.fieldProvenance)?.crossStanzaProps).toEqual(edge.fieldProvenance?.crossStanzaProps));
});
test.each([['host::Server', 200, 'priority'], ['host::SERVER', 100, 'ascii']] as const)('same-category literal host collision follows native priority/ASCII (%s)', async (second, priority, reason) => {
    const data = crossStanzaFixture('host=server', ['host::server', second]);
    data.objects.find(item => item.fieldLineage?.stanza === second)!.fieldLineage!.propsContexts![0].stanzaPriority = priority;
    const result = await compare(data); expect(observations(result.edges)).toEqual(expect.arrayContaining([
        expect.objectContaining({ objectId: data.rules[1].item.objectId, status: 'highest', reason }),
        expect.objectContaining({ objectId: data.rules[0].item.objectId, status: 'lower', reason }),
    ]));
});
test.each(['denied', 'missing_priority', 'truncated', 'incomplete', 'case', 'cancel', 'budget'])('%s blocks highest inference and retains every original edge', async mode => {
    const data = mode === 'missing_priority' ? crossStanzaFixture('host=server', ['host::server', 'host::SERVER']) : crossStanzaFixture();
    const facts = data.objects.find(item => item.fieldLineage)!.fieldLineage!;
    if (mode === 'denied') { facts.propsContexts = [{ ...facts.propsContexts![0], status: 'unverified', reason: 'access_denied', selectedObjectId: null, valueDigest: null, stanzaPriority: null }]; }
    if (mode === 'missing_priority') { facts.propsContexts![0].stanzaPriority = null; }
    if (mode === 'truncated') { facts.propsContextsTruncated = true; }
    if (mode === 'case') { facts.scope!.value = 'EVENTS'; }
    const controller = new AbortController(); if (mode === 'cancel') { controller.abort(); }
    const result = await compare(data, { catalogsComplete: mode !== 'incomplete', ...(mode === 'budget' ? { maxVisits: 0 } : {}), signal: controller.signal });
    expect(observations(result.edges).every(row => row.status === 'unverified' && row.selectedObjectId === null)).toBe(true);
    expect(result.edges).toHaveLength(data.edges.length);
});
test('one captured stanza, different attributes and OR branches never establish absence or highest precedence', async () => {
    const single = await compare(crossStanzaFixture('sourcetype=events', ['events']));
    expect(observations(single.edges)[0]).toMatchObject({ status: 'unverified', reason: 'single_stanza' });
    const or = await compare(crossStanzaFixture('sourcetype=events OR host=server', ['events', 'host::server']));
    expect(observations(or.edges).every(row => row.reason === 'no_conjunction')).toBe(true);
    const data = crossStanzaFixture('sourcetype=events host=server', ['events', 'host::server']);
    data.objects.find(item => item.fieldLineage?.scope?.field === 'host')!.fieldLineage!.attribute = 'FIELDALIAS-different';
    data.objects.find(item => item.fieldLineage?.scope?.field === 'host')!.canonicalName = 'host::server : FIELDALIAS-different';
    expect(observations((await compare(data)).edges).every(row => row.reason === 'single_stanza')).toBe(true);
});
test('same-stanza shadow is retained separately and cannot win by export app-name ordering', async () => {
    const data = crossStanzaFixture('sourcetype=events host=server', ['events', 'host::server']);
    const exported = JSON.parse(JSON.stringify(data.objects.find(item => item.fieldLineage?.stanza === 'events'))) as ContentObject;
    exported.objectId = 'exported-fallback'; exported.app = 'z-exporter'; exported.sharing = 'global';
    exported.fieldLineage!.propsContexts = [{ ...exported.fieldLineage!.propsContexts![0], objectId: exported.objectId, status: 'shadowed', reason: 'different_binding', selectedObjectId: data.rules[0].item.objectId }];
    const duplicate = { ...data.edges[0], edgeId: 'fallback-edge', targetId: exported.objectId };
    data.objects.push(exported); data.edges.push(duplicate);
    const result = await compare(data); expect(result.edges).toHaveLength(3);
    expect(result.edges.find(edge => edge.edgeId === 'fallback-edge')?.fieldProvenance?.crossStanzaProps?.[0]).toMatchObject({ reason: 'same_stanza_shadow', status: 'unverified' });
});
test.each([undefined, '', '200', '-2.5', 'unsupported', Infinity])('native priority projection is bounded and has no extra reads (value %s)', async priority => {
    const definition = field('field_aliases', 'FIELDALIAS-owner', 'actor AS owner');
    const read: jest.MockedFunction<PropsRead> = jest.fn(async request => ({ status: 200, data: { entry: request.kind === 'rule' ? [definition.entry] : [{ name: 'example:events', content: {
        'FIELDALIAS-owner': 'actor AS owner', priority, 'eai:appName': 'example', 'eai:userName': 'nobody' } }] } }));
    const result = await checkPropsPrecedence([definition.item], [], read); expect(read).toHaveBeenCalledTimes(2);
    let expected: number | null = null;
    if (priority === undefined || priority === '') { expected = 100; }
    else if (['200', '-2.5'].includes(String(priority))) { expected = Number(priority); }
    expect(result.objects[0].fieldLineage?.propsContexts?.[0].stanzaPriority).toBe(expected);
});
test('strict reader strips raw/unrecognized data and rejects contradictions, duplicates, prototype keys and byte/row overflow', async () => {
    const rows = observations((await compare(crossStanzaFixture())).edges); const row = rows[0];
    expect(readCrossStanzaProps([{ ...row, raw: 'never cache' }])?.[0]).not.toHaveProperty('raw');
    expect(readCrossStanzaProps([row, row])).toBeUndefined(); expect(readCrossStanzaProps(Array(33).fill(row))).toBeUndefined();
    expect(readCrossStanzaProps([{ ...row, reason: '__proto__' }])).toBeUndefined();
    expect(readCrossStanzaProps([{ ...row, status: 'unverified' }])).toBeUndefined();
    expect(readCrossStanzaProps([{ ...row, selectedObjectId: 'not-a-member' }])).toBeUndefined();
    expect(readCrossStanzaProps([{ ...row, selectors: [row.selectors[0], row.selectors[0]] }])).toBeUndefined();
    expect(readCrossStanzaProps([{ ...row, competingObjectIds: Array.from({ length: 16 }, (_, n) => String(n)+'x'.repeat(4096)) }])).toBeUndefined();
});
test('new evidence changes freshness while preserving a v6 baseline/decision byte for byte', async () => {
    const data = crossStanzaFixture(); const scope = { scanId: 'scan-fixture', observedAt: new Date(now).toISOString(), principal: 'operator', roles: ['operator'], mode: 'full', collectionComplete: true, analysisComplete: true, collectors: {} };
    const before = (await attachReviewEvidence(data.objects, data.edges, scope)).find(item => item.objectId === data.rules[0].item.objectId)!;
    const legacy = JSON.parse(JSON.stringify(before.reviewEvidence)); legacy.coverage.policy = 'shared-static-v6';
    const baseline = { capturedAt: new Date(now).toISOString(), capturedBy: 'reviewer', evidence: legacy }; expect(parseReviewBaseline(baseline)).toEqual(baseline);
    const saved = review(before.objectId, { stage: 'retain', note: 'Preserve review', evidenceBaseline: baseline });
    const preserved = JSON.stringify(saved); const compared = await compare(data);
    const after = (await attachReviewEvidence(compared.objects, compared.edges, scope)).find(item => item.objectId === before.objectId)!;
    expect(after.reviewEvidence?.coverage?.policy).toBe('shared-static-v7'); expect(JSON.stringify(saved)).toBe(preserved);
    expect(after.reviewEvidence?.coverage?.outbound.digest).not.toBe(before.reviewEvidence?.coverage?.outbound.digest);
    expect(compareReviewEvidence(saved, after, snapshot(compared.objects, compared.edges).scan, now).status).toBe('needs_review');
});
test('conditional order survives real report builders while lower paths and removal blockers remain', async () => {
    const data = crossStanzaFixture(); const compared = await compare(data); const snapshotData = snapshot(compared.objects, compared.edges);
    const footprint = buildInUseReport(snapshotData, [], { selectedIds: [data.caller.objectId], activity: 'none', includeRetained: false, successfulOnly: true }, now);
    expect(footprint.relationships).toHaveLength(3); expect(footprint.relationships.every(edge => edge.fieldProvenance?.crossStanzaProps?.length === 1)).toBe(true);
    expect(footprint.rows.filter(row => row.objectId !== data.caller.objectId).every(row => row.via?.conditional)).toBe(true);
    const selected = compared.objects.find(item => item.objectId === data.rules[0].item.objectId)!;
    const impact = analyzeRemovalImpact(selected, compared.objects, compared.edges, [], snapshotData.scan, 5, now);
    expect(impact.readiness).toBe('blocked'); expect(impact.directDependents[0].fieldProvenance?.crossStanzaProps?.[0].status).toBe('lower');
    expect(JSON.parse(JSON.stringify(footprint)).relationships).toEqual(footprint.relationships);
    expect(JSON.stringify(observations(compared.edges))).not.toContain('actor AS owner');
});
test('group member ceiling never drops a conflicting declaration then reports a highest binding', async () => {
    const stanzas = Array.from({ length: 17 }, (_, index) => `host::${Array.from('server').map((letter, bit) => Math.floor(index / 2 ** bit) % 2 ? letter.toUpperCase() : letter).join('')}`);
    const data = crossStanzaFixture('host=server', stanzas); const result = await compare(data);
    expect(result.edges).toHaveLength(17); expect(observations(result.edges).every(row => row.status === 'unverified')).toBe(true);
    expect(result.counts.props_cross_stanza_truncated_edges).toBeGreaterThan(0);
});
test.each(['private', 'disabled', 'contradictory_scope'])('unsupported %s cannot become a highest shared binding', async kind => {
    const data = crossStanzaFixture(); const item = data.objects.find(candidate => candidate.fieldLineage?.scope?.field === 'source')!;
    if (kind === 'private') { item.sharing = 'user'; }
    else if (kind === 'disabled') { item.enabled = false; }
    else { item.fieldLineage!.stanza = 'different-stanza'; }
    expect(observations((await compare(data)).edges).every(row => row.status === 'unverified')).toBe(true);
});
test('many query contexts have bounded per-object rows and readable explicit truncation', async () => {
    const data = crossStanzaFixture('sourcetype=events', ['events']); const original = data.edges[0];
    data.edges = Array.from({ length: 100 }, (_, index) => ({ ...original, edgeId: `edge-${index}`, fieldProvenance: { ...original.fieldProvenance!,
        contexts: original.fieldProvenance!.contexts!.map(context => ({ ...context, selector: { ...context.selector!, sourceLocation: `query-${index}:0` } })) } }));
    data.propsEventScopes = Array.from({ length: 100 }, (_, index) => ({ app: 'example', callerObjectId: data.caller.objectId, sourceLocation: `query-${index}`,
        selectors: [{ field: 'sourcetype', value: 'events', sourceLocation: `query-${index}:0` }] }));
    const result = await compare(data); const facts = result.objects.find(item => item.fieldLineage)!.fieldLineage!;
    expect(facts.crossStanzaProps!.length).toBeLessThanOrEqual(32); expect(facts.crossStanzaPropsTruncated).toBe(true);
    expect(readFieldLineageFacts(facts)).toBeDefined(); expect(result.edges).toHaveLength(100);
});
test('valid-shaped oversized evidence is rejected at the UTF-8 byte ceiling, not accepted then truncated silently', async () => {
    const original = observations((await compare(crossStanzaFixture())).edges)[0];
    const id = `object-${'x'.repeat(12000)}`;
    const oversized = { ...original, objectId: id, selectedObjectId: id, status: 'highest', callerObjectId: `caller-${'y'.repeat(12000)}`,
        competingObjectIds: [id, `other-${'z'.repeat(12000)}`] };
    expect(readCrossStanzaProps([oversized])).toBeUndefined();
});
test('a caller with known field/lookup matching limits cannot report a highest compared binding', async () => {
    const data = crossStanzaFixture(); data.objects.find(item => item.objectId === data.caller.objectId)!.analysisWarnings = ['Field matching candidate-visit budget reached; additional possible paths remain unverified.'];
    const result = await compare(data); expect(observations(result.edges).every(row => row.status === 'unverified' && row.reason === 'budget')).toBe(true);
});
