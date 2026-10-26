// Synthetic contract data only; not imported by a production entry.
import { analyzeInventory, RawAnalysisSource } from '../services/analysis';
import { readFieldLineageFacts, readFieldProvenance } from '../services/fieldLineage';
import { buildFieldDependencyMatcher, FIELD_MATCH_LIMIT, FIELD_INDEX_ENTRY_LIMIT, FIELD_SCAN_EDGE_LIMIT } from '../services/fieldDependencies';
import { automaticLookupInputs } from '../services/automaticLookups';
import { normalizeFieldEntries } from '../services/inventory';
import { parseEventType, parseSpl } from '../services/dependencyParser';
import { object } from './milestoneFixtures';
import { field, fieldCompleteness as complete } from './fieldFixtures';

const analyze = (...items: ReturnType<typeof field>[]) => analyzeInventory(items.map(row => row.item), items.map(row => row.source), complete);

test('REPORT edges retain repeated native positions and compact provenance, not raw regex or expression', () => {
    const report = field('field_extractions', 'REPORT-example', 'first second first');
    const first = field('field_transforms', 'first', 'actor::$1'); const second = field('field_transforms', 'second', 'status::$1');
    const result = analyze(report, first, second);
    expect(result.edges).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceId: report.item.objectId, targetId: first.item.objectId, relation: 'may_use_field_transform', resolved: true,
            fieldProvenance: expect.objectContaining({ transformPositions: [1, 3], kind: 'report_binding', invocation: 'fixed_app' }) }),
        expect.objectContaining({ targetId: second.item.objectId, fieldProvenance: expect.objectContaining({ transformPositions: [2] }) }),
    ]));
    expect(result.edges).toHaveLength(2);
    expect(result.findings.some(row => row.findingType === 'repair_required')).toBe(false);
});

test('declared REPORT outputs feed aliases, aliases feed calculated fields, never alias/EVAL chains', () => {
    const transform = field('field_transforms', 'extract_actor', 'actor::$1');
    const report = field('field_extractions', 'REPORT-actor', 'extract_actor');
    const alias = field('field_aliases', 'FIELDALIAS-actor', 'actor ASNEW principal');
    const aliasChain = field('field_aliases', 'FIELDALIAS-unsafe-chain', 'principal ASNEW chained');
    const calc = field('calculated_fields', 'EVAL-normalized', 'lower(principal)');
    const calcChain = field('calculated_fields', 'EVAL-chained', 'lower(normalized)');
    const result = analyze(transform, report, alias, aliasChain, calc, calcChain);
    expect(result.edges).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceId: alias.item.objectId, targetId: report.item.objectId, relation: 'may_read_extracted_field',
            fieldProvenance: expect.objectContaining({ fields: ['actor'], viaObjectIds: [transform.item.objectId], consumerPhase: 'alias', producerPhase: 'extraction' }) }),
        expect.objectContaining({ sourceId: calc.item.objectId, targetId: alias.item.objectId, relation: 'may_read_aliased_field' }),
    ]));
    expect(result.edges.some(edge => edge.sourceId === aliasChain.item.objectId)).toBe(false);
    expect(result.edges.some(edge => edge.sourceId === calcChain.item.objectId)).toBe(false);
    expect(result.coverageGaps.length).toBeGreaterThan(0);
});

test('inline producers expose exact named-capture evidence, not a same-phase extraction chain', () => {
    const inline = field('field_extractions', 'EXTRACT-actor', '(prefix)(?<actor>customer-pattern)');
    const consumer = field('field_aliases', 'FIELDALIAS-user', 'actor AS user');
    const samePhase = field('field_extractions', 'EXTRACT-next', '(?<other>.+) in actor');
    const result = analyze(inline, consumer, samePhase);
    expect(result.edges).toEqual([expect.objectContaining({ sourceId: consumer.item.objectId, targetId: inline.item.objectId,
        relation: 'may_read_extracted_field', confidence: 'medium', fieldProvenance: expect.objectContaining({ fields: ['actor'],
            outputDeclarations: [{ field: 'actor', capture: 2, offset: 8, attribute: 'value', objectId: inline.item.objectId, method: 'inline_named_captures' }] }) })]);
    expect(result.edges.some(row => row.sourceId === samePhase.item.objectId)).toBe(false);
    expect(JSON.stringify(result)).not.toContain('customer-pattern');
    const proof = result.edges[0].fieldProvenance!;
    expect(readFieldProvenance(proof)).toEqual(proof);
    expect(readFieldProvenance({ ...proof, kind: 'event_scope' })).toBeUndefined();
    expect(readFieldProvenance({ ...proof, producerPhase: 'alias' })).toBeUndefined();
    expect(readFieldProvenance({ ...proof, outputDeclarations: [{ ...proof.outputDeclarations![0], attribute: 'REGEX' }] })).toBeUndefined();
    expect(readFieldProvenance({ ...proof, outputDeclarations: [{ ...proof.outputDeclarations![0], secret: 'not projected' }] })).toEqual(proof);
});

test.each(['other:events', 'source::example:events', 'example:*'])('inline capture names do not join unrelated or pattern scopes: %s', scope => {
    const inline = field('field_extractions', 'EXTRACT-actor', '(?<actor>.+)', 'example', 'app', scope);
    const consumer = field('field_aliases', 'FIELDALIAS-user', 'actor AS user');
    expect(analyze(inline, consumer).edges).toEqual([]);
});

test('inline namespace overrides suppress ghost outputs, including overrides with opaque syntax', () => {
    const exported = field('field_extractions', 'EXTRACT-actor', '(?<actor>.+)', 'definitions', 'global');
    const override = field('field_extractions', 'EXTRACT-actor', '(?<other>.+)');
    const opaqueOverride = field('field_extractions', 'EXTRACT-actor', '(?<bad');
    const consumer = field('field_aliases', 'FIELDALIAS-user', 'actor AS user');
    expect(analyze(exported, override, consumer).edges).toEqual([]);
    expect(analyze(exported, opaqueOverride, consumer).edges).toEqual([]);
});

test('private inline shadows suppress producer and caller paths without exporting private identities', () => {
    const exported = field('field_extractions', 'EXTRACT-actor', '(?<actor>.+)', 'definitions', 'global');
    const consumer = field('field_aliases', 'FIELDALIAS-user', 'actor AS user');
    const caller = { ...object('Caller', 'Saved Search'), app: 'example' };
    const result = analyzeInventory([exported.item, consumer.item, caller], [exported.source, consumer.source,
        { objectId: caller.objectId, kind: 'spl', text: 'sourcetype=example:events', sourceLocation: 'search' }], complete, undefined,
    { privateObjects: [{ collector: 'field_extractions', app: 'example', count: 1 }], privateTargets: [
        { collector: 'field_extractions', app: 'example', name: exported.item.canonicalName }] });
    expect(result.edges.some(row => row.targetId === exported.item.objectId)).toBe(false);
    expect(result.coverageGaps.some(row => /Private or omitted field/.test(row.message))).toBe(true);
});

test('REPORT named outputs retain transform identity and exact REGEX capture positions', () => {
    const transform = field('field_transforms', 'extract_actor', '', 'example', 'app', 'example:events', { REGEX: '(prefix)(?<actor>.+)' });
    const report = field('field_extractions', 'REPORT-actor', 'extract_actor extract_actor');
    const consumer = field('field_aliases', 'FIELDALIAS-user', 'actor AS user');
    const result = analyze(transform, report, consumer);
    const edge = result.edges.find(row => row.sourceId === consumer.item.objectId)!;
    expect(edge).toMatchObject({ targetId: report.item.objectId, relation: 'may_read_extracted_field', fieldProvenance: {
        fields: ['actor'], viaObjectIds: [transform.item.objectId], outputDeclarations: [{ field: 'actor', capture: 2, offset: 8,
            attribute: 'REGEX', method: 'transform_named_captures', objectId: transform.item.objectId }] } });
    expect(result.edges.find(row => row.sourceId === report.item.objectId)?.fieldProvenance?.transformPositions).toEqual([1, 2]);
});

test.each([{ REGEX: '(?<broken' }, { REGEX: '(one)', FORMAT: 'actor::$2' }, { REGEX: '(one)', FORMAT: 'actor.name::$1' },
    { REGEX: '', FIELDS: 'actor', FORMAT: '' }])('unattributed literal transform names cannot create producer links: %j', native => {
    const transform = field('field_transforms', 'extract_actor', 'actor::$1', 'example', 'app', 'example:events', native);
    const report = field('field_extractions', 'REPORT-actor', 'extract_actor');
    const consumer = field('field_aliases', 'FIELDALIAS-user', 'actor AS user');
    const result = analyze(transform, report, consumer);
    expect(result.edges.filter(row => row.sourceId === consumer.item.objectId)).toEqual([]);
    expect(result.edges.find(row => row.sourceId === report.item.objectId)?.targetId).toBe(transform.item.objectId);
});

test('multiple dense transform proofs remain bounded on one REPORT input edge with an explicit evidence gap', () => {
    const REGEX = `(?J)${'(?<actor>x)'.repeat(FIELD_MATCH_LIMIT)}`;
    const first = field('field_transforms', 'first', '', 'example', 'app', 'example:events', { REGEX });
    const second = field('field_transforms', 'second', '', 'example', 'app', 'example:events', { REGEX });
    const report = field('field_extractions', 'REPORT-actor', 'first second');
    const consumer = field('field_aliases', 'FIELDALIAS-user', 'actor AS user');
    const result = analyze(first, second, report, consumer);
    const edge = result.edges.find(row => row.sourceId === consumer.item.objectId)!;
    expect(edge.fieldProvenance?.outputDeclarations).toHaveLength(FIELD_MATCH_LIMIT);
    expect(edge.fieldProvenance?.viaObjectIds.slice().sort()).toEqual([first.item.objectId, second.item.objectId].sort());
    expect(result.coverageGaps.some(row => row.sourceId === consumer.item.objectId && /per-edge budget/.test(row.message))).toBe(true);
    expect(readFieldProvenance(edge.fieldProvenance)).toEqual(edge.fieldProvenance);
});

test('constant calculated output has no invented input; opaque expressions and PCRE stay explicit gaps', () => {
    const constant = field('calculated_fields', 'EVAL-status', '"customer-literal-not-cached"');
    const unknown = field('calculated_fields', 'EVAL-user', 'lookup("customer-table", user)');
    const opaque = field('field_extractions', 'EXTRACT-actor', '(?<actor>customer-pattern)');
    const result = analyze(constant, unknown, opaque);
    expect(result.edges).toEqual([]);
    expect(constant.item.fieldLineage).toMatchObject({ inputs: [], outputs: ['status'], syntax: 'declared' });
    expect(JSON.stringify(result)).not.toContain('customer-literal');
    expect(JSON.stringify(result)).not.toContain('customer-pattern');
    expect(result.coverageGaps.some(row => row.sourceId === unknown.item.objectId && row.targets.includes('lookup'))).toBe(true);
    expect(result.coverageGaps.some(row => row.sourceId === constant.item.objectId && row.targets.includes('lookup'))).toBe(false);
});

test.each(['other:events', 'source::example:events', 'host::example:events', 'example:*', 'default'])('field names do not join unrelated or pattern scopes: %s', scope => {
    const producer = field('field_aliases', 'FIELDALIAS-source', 'actor AS principal');
    const consumer = field('calculated_fields', 'EVAL-user', 'principal', 'example', 'app', scope);
    expect(analyze(producer, consumer).edges).toEqual([]);
});

test('field names remain case-sensitive values; same event-scope case variants are potential witnesses', () => {
    const alias = field('field_aliases', 'FIELDALIAS-source', 'Actor AS Principal', 'example', 'app', 'Example:Events');
    const wrong = field('calculated_fields', 'EVAL-wrong', 'principal');
    const right = field('calculated_fields', 'EVAL-right', 'Principal');
    const result = analyze(alias, wrong, right);
    expect(result.edges.filter(row => row.relation === 'may_read_aliased_field')).toEqual([
        expect.objectContaining({ sourceId: right.item.objectId, targetId: alias.item.objectId, fieldProvenance: expect.objectContaining({ fields: ['Principal'] }) }),
    ]);
});

test('app-only producers do not leak to foreign callers; exported producers remain potential', () => {
    const local = field('field_aliases', 'FIELDALIAS-local', 'actor AS principal', 'foreign');
    const global = field('field_aliases', 'FIELDALIAS-global', 'actor AS principal', 'definitions', 'global');
    const consumer = field('calculated_fields', 'EVAL-user', 'principal');
    const result = analyze(local, global, consumer);
    expect(result.edges).toEqual([expect.objectContaining({ targetId: global.item.objectId, relation: 'may_read_aliased_field' })]);
});

test('local same-name field definitions shadow exported declarations without merging identities', () => {
    const exported = field('field_aliases', 'FIELDALIAS-source', 'actor AS principal', 'definitions', 'global');
    const local = field('field_aliases', 'FIELDALIAS-source', 'other AS principal');
    const consumer = field('calculated_fields', 'EVAL-user', 'principal');
    expect(analyze(exported, local, consumer).edges).toEqual([expect.objectContaining({ targetId: local.item.objectId })]);
});

test('a local override with different outputs still suppresses an exported producer', () => {
    const exported = field('field_aliases', 'FIELDALIAS-source', 'actor AS principal', 'definitions', 'global');
    const local = field('field_aliases', 'FIELDALIAS-source', 'actor AS differently_named');
    const consumer = field('calculated_fields', 'EVAL-user', 'principal');
    expect(analyze(exported, local, consumer).edges).toEqual([]);
});

test('native app named all cannot collide with internal index namespaces', () => {
    const producer = field('field_aliases', 'FIELDALIAS-source', 'actor AS principal', 'foreign');
    const consumer = field('calculated_fields', 'EVAL-user', 'principal', 'all');
    expect(analyze(producer, consumer).edges).toEqual([]);
});

test('global REPORT considers possible invoking-app transform bindings, not a guessed owning-app failure', () => {
    const report = field('field_extractions', 'REPORT-example', 'named', 'definitions', 'global');
    const a = field('field_transforms', 'named', 'actor::$1', 'caller-a');
    const b = field('field_transforms', 'named', 'other::$1', 'caller-b');
    const result = analyze(report, a, b);
    expect(result.edges).toHaveLength(2);
    expect(result.edges.every(row => row.resolved && row.fieldProvenance?.invocation === 'invoking_app_unverified')).toBe(true);
    expect(result.edges.map(row => row.targetId).sort()).toEqual([a.item.objectId, b.item.objectId].sort());
    expect(result.findings).not.toEqual(expect.arrayContaining([expect.objectContaining({ findingType: 'repair_required' })]));
});

test('REPORT-derived producer output is checked against the actual consumer namespace', () => {
    const report = field('field_extractions', 'REPORT-example', 'named', 'definitions', 'global');
    const a = field('field_transforms', 'named', 'actor::$1', 'caller-a');
    const b = field('field_transforms', 'named', 'other::$1', 'caller-b');
    const consumer = field('field_aliases', 'FIELDALIAS-user', 'actor AS user', 'caller-b');
    expect(analyze(report, a, b, consumer).edges.some(row => row.sourceId === consumer.item.objectId)).toBe(false);
});

test('private transform shadows suppress guessed REPORT outputs and private identities are never exported', () => {
    const report = field('field_extractions', 'REPORT-example', 'named');
    const transform = field('field_transforms', 'named', 'actor::$1');
    const consumer = field('field_aliases', 'FIELDALIAS-user', 'actor AS user');
    const result = analyzeInventory([report.item, transform.item, consumer.item], [report.source, transform.source, consumer.source], complete,
        undefined, { privateObjects: [{ collector: 'field_transforms', app: 'example', count: 1 }],
            privateTargets: [{ collector: 'field_transforms', app: 'example', name: 'named' }] });
    expect(result.edges.some(row => row.sourceId === consumer.item.objectId)).toBe(false);
    expect(result.edges[0]).toMatchObject({ resolved: false, confidence: 'unknown' });
    expect(result.objects.find(row => row.objectId === report.item.objectId)?.healthStatus).not.toBe('broken');
});

test('missing and multiply exported transform targets remain unresolved, not broken-content claims', () => {
    const report = field('field_extractions', 'REPORT-example', 'absent duplicate');
    const a = field('field_transforms', 'duplicate', 'a::$1', 'one', 'global');
    const b = field('field_transforms', 'duplicate', 'b::$1', 'two', 'global');
    const result = analyze(report, a, b);
    expect(result.edges).toHaveLength(2);
    expect(result.edges.every(row => !row.resolved && row.confidence === 'unknown')).toBe(true);
    expect(result.findings.some(row => row.findingType === 'repair_required')).toBe(false);
});

test.each(['index=main sourcetype=example:events', 'index=main sourcetype IN (example:events)', 'index=main sourcetype=EXAMPLE:EVENTS'])('positive exact original-event selectors expose potential caller paths: %s', text => {
    const alias = field('field_aliases', 'FIELDALIAS-user', 'actor AS user'); const caller = { ...object('Caller', 'Saved Search'), app: 'example' };
    const source: RawAnalysisSource = { objectId: caller.objectId, kind: 'spl', text, sourceLocation: 'search' };
    const result = analyzeInventory([alias.item, caller], [alias.source, source], complete);
    expect(result.edges).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: caller.objectId, targetId: alias.item.objectId,
        relation: 'may_apply_field_alias', fieldProvenance: expect.objectContaining({ kind: 'event_scope' }) })]));
});

test.each(['index=main NOT sourcetype=example:events', 'index=main sourcetype=example:*', '| makeresults | eval sourcetype="example:events"', 'index=main | stats count | search sourcetype=example:events'])('non-witness contexts do not invent field caller paths: %s', text => {
    const alias = field('field_aliases', 'FIELDALIAS-user', 'actor AS user');
    const caller = { ...object('Caller', 'Saved Search'), app: 'example' };
    expect(analyzeInventory([alias.item, caller], [alias.source, { objectId: caller.objectId, kind: 'spl', text, sourceLocation: 'search' }], complete)
        .edges.some(row => row.relation === 'may_apply_field_alias')).toBe(false);
});

test('reusable search owning app is never treated as a fixed props caller', () => {
    const alias = field('field_aliases', 'FIELDALIAS-user', 'actor AS user'); const caller = { ...object('Reusable', 'Event Type'), app: 'example', sharing: 'global' };
    const result = analyzeInventory([alias.item, caller], [alias.source, { objectId: caller.objectId, kind: 'event_type', text: 'index=main sourcetype=example:events', sourceLocation: 'search' }], complete);
    expect(result.edges.some(row => row.relation === 'may_apply_field_alias')).toBe(false);
    expect(result.coverageGaps.some(row => row.sourceId === caller.objectId && row.invocationNamespaceUnverified)).toBe(true);
});

test.each(['savedsearch', 'inputlookup', 'outputlookup', 'datamodel', 'rest'])('command-like leading event-type word %s remains an implicit base-search term', keyword => {
    const result = parseEventType(`${keyword} LiteralName index=main sourcetype=example:events`);
    expect(result.references.some(row => ['saved_search', 'lookup', 'lookup_file', 'data_model'].includes(row.targetType))).toBe(false);
    expect(result.eventSelectors).toHaveLength(1);
});

test.each([
    ['named key AS actor OUTPUT owner', ['actor'], true], ['"Named Table" "field.with.dots" AS "actor name" OUTPUTNEW result AS enriched', ['actor name'], true],
    ['named key other', ['key', 'other'], true], ['named key AS', [], false], ['named $runtime$ OUTPUT x', [], false],
    ['named key OUTPUT', [], false], ['named key OUTPUT x OUTPUT y', [], false], ['named key AS OUTPUT out', [], false],
])('automatic lookup literal event-input mapping: %s', (value, inputs, valid) => {
    expect(automaticLookupInputs(String(value))).toEqual({ inputs, complete: valid });
});

test('automatic lookup input phase can depend on a calculated output, never the reverse', () => {
    const calc = field('calculated_fields', 'EVAL-normalized', 'lower(actor)');
    const lookup = { ...object('example:events : LOOKUP-example', 'Automatic Lookup'), app: 'example', sharing: 'app' };
    const source: RawAnalysisSource = { objectId: lookup.objectId, kind: 'automatic_lookup', sourceLocation: 'props.conf', text: JSON.stringify({
        stanza: 'example:events', attribute: 'LOOKUP-example', type: 'LOOKUP', transform: 'named', value: 'named key AS normalized OUTPUT user' }) };
    const result = analyzeInventory([calc.item, lookup], [calc.source, source], complete);
    expect(result.edges).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: lookup.objectId, targetId: calc.item.objectId,
        relation: 'may_read_calculated_field', fieldProvenance: expect.objectContaining({ consumerPhase: 'lookup', producerPhase: 'calculated', fields: ['normalized'] }) })]));
});

test('field normalizer retains every supported identity, fingerprints raw bytes but never caches them', () => {
    const row = field('calculated_fields', 'EVAL-output', 'coalesce(actor,"customer-sensitive-literal")');
    const result = normalizeFieldEntries([row.entry], { id: 'calculated_fields', label: 'Calculated fields', endpoint: 'data/props/calcfields', objectType: 'Calculated Field' }, 'scan-test', '2026-01-01T00:00:00Z');
    expect(result.inventoryComplete).toBe(true);
    expect(result.records[0]).toMatchObject({ name: row.entry.name, enabled: null, field_lineage: { version: 1, inputs: ['actor'], outputs: ['output'] } });
    expect(JSON.stringify(result)).not.toContain('customer-sensitive-literal');
    expect(JSON.stringify(result)).not.toContain('coalesce(');
    expect(result.records[0].configuration_fingerprint).toBeDefined();
    expect(readFieldLineageFacts(result.records[0].field_lineage)).toBeDefined();
    const facts = result.records[0].field_lineage as Record<string, unknown>;
    expect(readFieldLineageFacts({ ...facts, expression: 'must-not-travel' })).not.toHaveProperty('expression');
    expect(readFieldLineageFacts({ ...facts, inputs: { actor: true } })).toBeUndefined();
    expect(readFieldProvenance({ version: 1 })).toBeUndefined();
});

test('opaque syntax retains inventory completeness; duplicate identities and hard caps do not', () => {
    const row = field('field_extractions', 'EXTRACT-example', '(?<opaque)');
    const collector = { id: 'field_extractions', label: 'Field extractions', endpoint: 'data/props/extractions', objectType: 'Field Extraction' };
    expect(normalizeFieldEntries([row.entry], collector, 'scan', 'now')).toMatchObject({ inventoryComplete: true, complete: false });
    expect(normalizeFieldEntries([row.entry, row.entry], collector, 'scan', 'now')).toMatchObject({ inventoryComplete: false, records: [], sources: [] });
    expect(normalizeFieldEntries([row.entry, row.entry], collector, 'scan', 'now', 1).inventoryComplete).toBe(false);
    expect(() => normalizeFieldEntries([row.entry], { ...collector, id: 'constructor' }, 'scan', 'now')).toThrow('Unsupported native field');
});

test('indexed fan-out is bounded with an explicit gap and unrelated estates do not add producer edges', () => {
    const aliases = Array.from({ length: FIELD_MATCH_LIMIT + 10 }, (_v, index) => field('field_aliases', `FIELDALIAS-${index}`, 'actor AS principal'));
    const consumer = field('calculated_fields', 'EVAL-user', 'principal');
    const result = analyze(...aliases, consumer);
    expect(result.edges.filter(row => row.sourceId === consumer.item.objectId)).toHaveLength(FIELD_MATCH_LIMIT);
    expect(result.coverageGaps.some(row => /safety budget/.test(row.message))).toBe(true);
    const unrelated = Array.from({ length: 5000 }, (_v, index) => field('field_aliases', `FIELDALIAS-unrelated-${index}`, 'a AS principal', 'example', 'app', `unrelated_${index}`));
    const match = buildFieldDependencyMatcher(unrelated.map(row => row.item), true);
    expect(match(consumer.item, { references: [], warnings: [], gaps: [], fieldLineage: consumer.item.fieldLineage }).references).toEqual([]);
    expect(FIELD_INDEX_ENTRY_LIMIT).toBe(50000);
    expect(parseSpl('| makeresults').hasEventSearch).toBe(false);
});

test('exhausted whole-scan budgets stop before namespace access or dense candidate allocation', () => {
    const aliases = Array.from({ length: FIELD_MATCH_LIMIT }, (_value, index) => field('field_aliases', `FIELDALIAS-${index}`, 'actor AS principal'));
    const consumer = field('calculated_fields', 'EVAL-user', 'principal');
    const match = buildFieldDependencyMatcher(aliases.map(row => row.item), true);
    const parsed = { references: [], warnings: [], gaps: [], fieldLineage: consumer.item.fieldLineage };
    let emitted = 0;
    for (let run = 0; run < FIELD_SCAN_EDGE_LIMIT / FIELD_MATCH_LIMIT; run += 1) { emitted += match(consumer.item, parsed).references.length; }
    expect(emitted).toBe(FIELD_SCAN_EDGE_LIMIT);
    const afterLimit = { ...consumer.item, get app(): string { throw new Error('Post-budget namespace access'); } };
    expect(match(afterLimit, parsed)).toMatchObject({ references: [], warnings: expect.arrayContaining([expect.stringContaining('scan budget is exhausted')]) });
    expect(parsed.references).toEqual([]);
});
