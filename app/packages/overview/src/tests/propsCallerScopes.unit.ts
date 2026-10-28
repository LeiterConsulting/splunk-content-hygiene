// Adversarial static contracts only. Never inserted into native Splunk content.
import { analyzeInventory, RawAnalysisSource } from '../services/analysis';
import { parseSpl } from '../services/dependencyParser';
import { buildPropsCallerIndex, mergePropsCallerWitnesses, PROPS_CALLER_ROWS, readPropsCallerWitnesses } from '../services/propsCallerScopes';
import { readFieldProvenance } from '../services/fieldLineage';
import { field, fieldCompleteness } from './fieldFixtures';
import { object } from './milestoneFixtures';
import { PropsCallerWitness } from '../types';

function caller(text: string, app = 'example', id = 'captured-caller', type = 'Report') {
    const item = { ...object(id, type), app };
    const source: RawAnalysisSource = { objectId: id, kind: type === 'Dashboard' ? 'dashboard' : 'spl', text, sourceLocation: `query:${id}` };
    return { item, source };
}
const producer = () => field('field_aliases', 'FIELDALIAS-user', 'actor AS principal', 'example', 'app', 'host::node*');
const consumer = () => field('calculated_fields', 'EVAL-user', 'principal');
const run = (rows: Array<{ item: ReturnType<typeof object>; source: RawAnalysisSource }>, visibility?: Parameters<typeof analyzeInventory>[4]) =>
    analyzeInventory(rows.map(row => row.item), rows.map(row => row.source), fieldCompleteness, undefined, visibility);
const inputs = (result: ReturnType<typeof run>) => result.edges.filter(edge => edge.fieldProvenance?.kind === 'field_input');
const witness = (id = 'captured-caller'): PropsCallerWitness => ({ callerObjectId: id, app: 'example', sourceLocation: 'query', selectors: [
    { field: 'sourcetype', value: 'example:events', sourceLocation: 'query:0' }, { field: 'host', value: 'node1', sourceLocation: 'query:26' }] });

test.each([
    ['host::node*', 'example:events', 'host=node1 sourcetype=example:events'],
    ['example:*', 'host::node1', 'host=node1 sourcetype=example:events'],
    ['source::/var/...', 'example:events', 'source=/var/a/b.log sourcetype=example:events'],
    ['example:*', 'source::/var/a.log', 'source=/var/a.log sourcetype=example:events'],
    ['host::NODE*', 'source::/var/a.log', 'source=/var/a.log host=node1'],
    ['source::/var/*.log', 'host::NODE1', 'source=/var/a.log host=node1'],
])('one strict query supports %s -> %s without runtime promotion', (a, b, text) => {
    const p = field('field_aliases', 'FIELDALIAS-user', 'actor AS principal', 'example', 'app', a);
    const c = field('calculated_fields', 'EVAL-user', 'principal', 'example', 'app', b);
    const q = caller(text); const result = run([p, c, q]); const edges = inputs(result);
    expect(edges).toHaveLength(1); expect(edges[0]).toMatchObject({ sourceId: c.item.objectId, targetId: p.item.objectId, relation: 'may_read_aliased_field', confidence: 'medium',
        fieldProvenance: { invocation: 'fixed_app', contextApps: ['example'], scopeCompatibility: { version: 1, basis: 'captured_conjunction',
            consumer: c.item.fieldLineage!.scope, producer: p.item.fieldLineage!.scope, callerWitnesses: [{ callerObjectId: q.item.objectId, app: 'example', sourceLocation: 'query:captured-caller' }] } } });
    expect(readFieldProvenance(edges[0].fieldProvenance)).toEqual(edges[0].fieldProvenance);
    expect(result.parserCounts.props_domain_captured_conjunction).toBe(1);
    expect(edges[0].evidence).toContain('not observed events'); expect(result.coverageGaps.length).toBeGreaterThan(0);
});

test.each([
    'sourcetype=example:events', 'host=node1', 'sourcetype=example:events OR host=node1',
    'sourcetype=example:events NOT host=node1', 'sourcetype=example:events host IN (node1)',
    '(sourcetype=example:events host=node1)', 'sourcetype=example:events host=node*',
    'sourcetype=example:events `choose_host`', 'sourcetype=example:events [search host=node1]',
    'sourcetype=example:events host=node1 host=node2', 'sourcetype=EXAMPLE:EVENTS host=node1',
    'sourcetype=example:events | search host=node1', '| makeresults | eval sourcetype="example:events",host="node1"',
])('unsupported/independent selectors never become a conjunction: %s', text => {
    expect(inputs(run([producer(), consumer(), caller(text)]))).toEqual([]);
});

test('no caller, separate searches and separate dashboard panels never join', () => {
    expect(inputs(run([producer(), consumer()]))).toEqual([]);
    expect(inputs(run([producer(), consumer(), caller('sourcetype=example:events', 'example', 'a'), caller('host=node1', 'example', 'b')]))).toEqual([]);
    const dash = caller('<dashboard><row><panel><chart><search><query>sourcetype=example:events</query></search></chart></panel><panel><chart><search><query>host=node1</query></search></chart></panel></row></dashboard>', 'example', 'dashboard', 'Dashboard');
    expect(inputs(run([producer(), consumer(), dash]))).toEqual([]);
});

test.each(['Macro', 'Data Model', 'Event Type', 'Workflow Action'])('reusable %s ownership is not a fixed caller app', type => {
    expect(inputs(run([producer(), consumer(), caller('sourcetype=example:events host=node1', 'example', 'reusable', type)]))).toEqual([]);
});

test('caller app governs exported consumer, producer and exact REPORT output binding', () => {
    const transform = field('field_transforms', 'actor', 'actor::$1', 'example');
    const report = field('field_extractions', 'REPORT-actor', 'actor', 'definitions', 'global', 'host::node*');
    const alias = field('field_aliases', 'FIELDALIAS-user', 'actor AS principal', 'definitions', 'global');
    const q = caller('sourcetype=example:events host=node1');
    const result = run([transform, report, alias, q]);
    expect(inputs(result)).toEqual([expect.objectContaining({ sourceId: alias.item.objectId, targetId: report.item.objectId,
        fieldProvenance: expect.objectContaining({ contextApps: ['example'], viaObjectIds: [transform.item.objectId],
            outputDeclarations: [expect.objectContaining({ objectId: transform.item.objectId, field: 'actor' })] }) })]);
    const localShadow = field('field_extractions', 'REPORT-actor', 'different', 'example', 'app', 'host::node*');
    expect(inputs(run([transform, report, alias, q, localShadow]))).toEqual([]);
});

test.each(['field_aliases', 'calculated_fields'])('private %s identities suppress guessed cross-scope bindings', collector => {
    const p = producer(); const c = consumer();
    const hidden = collector === 'field_aliases' ? p.item.canonicalName : c.item.canonicalName;
    expect(inputs(run([p, c, caller('sourcetype=example:events host=node1')], { privateObjects: [{ collector, app: 'example', count: 1 }],
        privateTargets: [{ collector, app: 'example', name: hidden }] }))).toEqual([]);
});

test('no inaccessible app fallback, same-phase alias/eval chain or later-phase lookup output', () => {
    expect(inputs(run([producer(), consumer(), caller('sourcetype=example:events host=node1', 'other')]))).toEqual([]);
    const alias = field('field_aliases', 'FIELDALIAS-chain', 'principal AS chained');
    const calc = field('calculated_fields', 'EVAL-user', 'principal', 'example', 'app', 'host::node1');
    const calcChain = field('calculated_fields', 'EVAL-chain', 'user');
    expect(inputs(run([producer(), alias, caller('sourcetype=example:events host=node1')]))).toEqual([]);
    expect(inputs(run([calc, calcChain, caller('sourcetype=example:events host=node1')]))).toEqual([]);
});

test('same-domain/default paths keep their independent contract, not a new caller prerequisite', () => {
    const p = field('field_aliases', 'FIELDALIAS-user', 'actor AS principal', 'example', 'app', 'default');
    expect(inputs(run([p, consumer()]))[0].fieldProvenance?.scopeCompatibility?.basis).toBe('captured_default');
});

test('automatic lookup inputs can use earlier cross-scope calculated fields, never lookup outputs in reverse', () => {
    const calc = field('calculated_fields', 'EVAL-normalized', 'principal', 'example', 'app', 'host::node*');
    const lookup = { ...object('example:events : LOOKUP-user', 'Automatic Lookup'), canonicalName: 'example:events : LOOKUP-user' };
    const source: RawAnalysisSource = { objectId: lookup.objectId, kind: 'automatic_lookup', sourceLocation: 'props.conf', text: JSON.stringify({
        stanza: 'example:events', attribute: 'LOOKUP-user', type: 'LOOKUP', transform: 'named', value: 'named key AS normalized OUTPUT user' }) };
    const reverse = field('calculated_fields', 'EVAL-reverse', 'user', 'example', 'app', 'host::node*');
    const result = run([calc, reverse, { item: lookup, source }, caller('sourcetype=example:events host=node1')]);
    expect(inputs(result)).toEqual([expect.objectContaining({ sourceId: lookup.objectId, targetId: calc.item.objectId,
        relation: 'may_read_calculated_field', fieldProvenance: expect.objectContaining({ consumerPhase: 'lookup', producerPhase: 'calculated', fields: ['normalized'],
            scopeCompatibility: expect.objectContaining({ basis: 'captured_conjunction' }) }) })]);
});

test('multiple callers retain independent receipts and merge app contexts deterministically', () => {
    const p = field('field_aliases', 'FIELDALIAS-user', 'actor AS principal', 'definitions', 'global', 'host::node*');
    const c = field('calculated_fields', 'EVAL-user', 'principal', 'definitions', 'global');
    const result = run([p, c, ...['example', 'other'].flatMap(app => [caller('sourcetype=example:events host=node1', app, `${app}-a`), caller('sourcetype=example:events host=node2', app, `${app}-b`)])]);
    const [edge] = inputs(result); expect(inputs(result)).toHaveLength(1); expect(edge.fieldProvenance?.contextApps).toEqual(['example', 'other']);
    expect(edge.fieldProvenance?.scopeCompatibility?.callerWitnesses).toHaveLength(4); expect(readFieldProvenance(edge.fieldProvenance)).toEqual(edge.fieldProvenance);
});

test('index limits account for rejected candidates, avoid unrelated literal buckets and remain partial', () => {
    const p = producer(); const c = consumer(); const q = caller('unused'); const scopes = [witness()];
    const declarations = [p, c].map(row => ({ object: row.item, facts: row.item.fieldLineage! }));
    [{ visits: 1 }, { projections: 0 }, { work: 0 }, { bytes: 1 }].forEach(limits => {
        const result = buildPropsCallerIndex([p.item, c.item, q.item], declarations, scopes, () => true, limits);
        expect(result.limited).toBe(true); expect(result.counts.props_caller_index_limited).toBe(1);
    });
    const denied = buildPropsCallerIndex([p.item, c.item, q.item], declarations, scopes, () => false);
    expect(denied.byObject.size).toBe(0); expect(denied.counts.props_caller_visits).toBeGreaterThan(0);
    const unrelated = Array.from({ length: 1000 }, (_v, i) => field('field_aliases', `FIELDALIAS-${i}`, 'actor AS principal', 'example', 'app', `host::other-${i}`));
    const direct = buildPropsCallerIndex([q.item, ...unrelated.map(row => row.item)], unrelated.map(row => ({ object: row.item, facts: row.item.fieldLineage! })), scopes, () => true);
    expect(direct.counts.props_caller_visits).toBe(0);
});

test('per-declaration and merged receipt limits are explicit, never unbounded arrays', () => {
    const p = producer(); const c = consumer();
    const callers = Array.from({ length: PROPS_CALLER_ROWS + 2 }, (_v, i) => caller('sourcetype=example:events host=node1', 'example', `caller-${i}`));
    const result = run([p, c, ...callers]); const proof = inputs(result)[0].fieldProvenance!;
    expect(proof.scopeCompatibility?.callerWitnesses).toHaveLength(PROPS_CALLER_ROWS);
    expect(result.coverageGaps.some(row => row.message.includes('Caller-conjunction indexing'))).toBe(true);
    const merged = mergePropsCallerWitnesses([], callers.map(row => witness(row.item.objectId)));
    expect(merged.rows).toHaveLength(PROPS_CALLER_ROWS); expect(merged.truncated).toBe(true);
    expect(mergePropsCallerWitnesses([witness()], [witness()])).toEqual({ rows: [witness()], truncated: false });
});

test('cached conjunction evidence rejects missing/foreign/duplicate/malformed receipts and drops extras', () => {
    const proof = inputs(run([producer(), consumer(), caller('sourcetype=example:events host=node1')]))[0].fieldProvenance!;
    const domain = proof.scopeCompatibility!; const row = domain.callerWitnesses![0];
    [undefined, [], [row, row], [{ ...row, app: 'foreign' }], [{ ...row, selectors: [row.selectors[0]] }],
        [{ ...row, selectors: [row.selectors[0], row.selectors[0]] }]].forEach(callerWitnesses => {
        expect(readFieldProvenance({ ...proof, scopeCompatibility: { ...domain, callerWitnesses } })).toBeUndefined();
    });
    expect(readFieldProvenance({ ...proof, invocation: 'invoking_app_unverified' })).toBeUndefined();
    expect(readFieldProvenance({ ...proof, scopeCompatibility: { ...domain, producer: domain.consumer } })).toBeUndefined();
    expect(readPropsCallerWitnesses([{ ...row, secret: 'discarded', selectors: row.selectors.map(item => ({ ...item, expression: 'discarded' })) }])).toEqual([row]);
});

test('strict parser receipts keep query and selector offsets, never execute captured text', () => {
    const parsed = parseSpl('search sourcetype=example:events AND host=node1 | stats count', 'query');
    expect(parsed.propsEventScopes).toEqual([{ sourceLocation: 'query', selectors: [
        { field: 'sourcetype', value: 'example:events', sourceLocation: 'query:7' }, { field: 'host', value: 'node1', sourceLocation: 'query:37' }] }]);
});
