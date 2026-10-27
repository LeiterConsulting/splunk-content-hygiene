// Synthetic parser contracts only; never collected or displayed as customer data.
import { automaticLookupMapping, parseAutomaticLookup } from '../services/automaticLookups';
import { analyzeInventory, RawAnalysisSource } from '../services/analysis';
import { calculatedFieldInputs, readFieldLineageFacts, readFieldProvenance } from '../services/fieldLineage';
import { object } from './milestoneFixtures';
import { fieldCompleteness } from './fieldFixtures';

test.each(['OUTPUT', 'OUTPUTNEW'] as const)('literal %s mappings retain both column and event identity', mode => {
    const mapping = automaticLookupMapping(`owners "lookup key" AS event_key ${mode} "lookup owner" AS event_owner status`);
    expect(mapping).toEqual({ version: 1, outputMode: mode,
        inputs: [{ lookupField: 'lookup key', eventField: 'event_key', position: 1 }],
        outputs: [{ lookupField: 'lookup owner', eventField: 'event_owner', position: 1 }, { lookupField: 'status', eventField: 'status', position: 2 }] });
});
test('implicit outputs are unknown, not discovered by sampling a lookup', () => {
    expect(automaticLookupMapping('owners key AS event_key')).toMatchObject({ outputMode: 'implicit', outputs: [] });
});
test.each(['owners key OUTPUT', 'owners key OUTPUT owner OUTPUTNEW other', 'owners key AS OUTPUT owner',
    'owners key OUTPUT a AS result b AS result', 'owners key OUTPUT $dynamic$', 'owners key OUTPUT value*',
    'owners key AS key other AS key OUTPUT owner', 'owners key OUTPUT "unterminated', 'owners OUTPUT owner',
    `owners key OUTPUT ${'ü'.repeat(33000)}`, `owners key OUTPUT ${Array.from({ length: 251 }, (_, i) => `f${i}`).join(' ')}`])(
    'ambiguous, dynamic or over-budget mapping fails closed: %s', text => expect(automaticLookupMapping(text)).toBeNull(),
);
test('literal keyword fields must be quoted', () => {
    expect(automaticLookupMapping('owners "OUTPUT" OUTPUT "AS" AS "OUTPUTNEW"')).toMatchObject({
        inputs: [{ eventField: 'OUTPUT' }], outputs: [{ lookupField: 'AS', eventField: 'OUTPUTNEW' }],
    });
});

const automatic = (app = 'origin', sharing = 'global', text = 'owners key AS actor OUTPUTNEW owner AS owner_name') => {
    const item = { ...object('access_log : LOOKUP-owner', 'Automatic Lookup'), app, sharing,
        objectId: `automatic_lookup::${app}::access_log : LOOKUP-owner` };
    const source: RawAnalysisSource = { objectId: item.objectId, kind: 'automatic_lookup', sourceLocation: 'props.conf', text: JSON.stringify({
        stanza: 'access_log', attribute: 'LOOKUP-owner', type: 'LOOKUP', transform: 'owners', value: text }) };
    return { item, source };
};
test('configured lookup outputs and contexts survive strict cache projection without raw content', () => {
    const rule = automatic();
    const target = { ...object('owners', 'Lookup Definition'), app: 'origin' };
    const caller = { ...object('Caller', 'Saved Search'), app: 'origin' };
    const data = analyzeInventory([rule.item, target, caller], [rule.source,
        { objectId: caller.objectId, kind: 'spl', text: 'sourcetype=ACCESS_LOG', sourceLocation: 'search' }], fieldCompleteness);
    const facts = data.objects.find(row => row.objectId === rule.item.objectId)!.fieldLineage!;
    expect(facts).toMatchObject({ outputs: ['owner_name'], inputs: ['actor'], lookupMapping: { outputMode: 'OUTPUTNEW' } });
    expect(readFieldLineageFacts({ ...facts, rawValue: rule.source.text })).toEqual(facts);
    expect(readFieldLineageFacts({ ...facts, outputs: ['invented'] })).toBeUndefined();
    const proof = data.edges.find(row => row.relation === 'may_apply_automatic_lookup')!.fieldProvenance!;
    expect(proof.contexts).toMatchObject([{ declaringApp: 'origin', dependencyApp: 'origin', invokingApp: 'origin',
        declaration: 'local_candidate', dependency: 'local_candidate', selector: { field: 'sourcetype', value: 'ACCESS_LOG' } }]);
    expect(readFieldProvenance(proof)).toEqual(proof);
    expect(readFieldProvenance({ ...proof, contexts: [{ ...proof.contexts![0], dependencyApp: null }] })).toBeUndefined();
    expect(readFieldProvenance({ ...proof, contexts: {} })).toBeUndefined();
});
test('automatic lookup output does not create a same-phase producer chain', () => {
    const first = automatic('origin', 'app');
    const second = automatic('origin', 'app', 'owners owner_name OUTPUT owner AS result');
    second.item = { ...second.item, canonicalName: 'access_log : LOOKUP-next', objectId: 'automatic_lookup::origin::next' };
    second.source = { ...second.source, objectId: second.item.objectId };
    const data = analyzeInventory([first.item, second.item], [first.source, second.source], fieldCompleteness);
    expect(data.edges.some(row => row.relation.startsWith('may_read_'))).toBe(false);
});
test('local or opaque automatic source override withholds an exported foreign binding', () => {
    const source = automatic(); const local = automatic('caller', 'app', '$opaque$ key');
    const target = { ...object('owners', 'Lookup Definition'), app: 'caller' };
    const data = analyzeInventory([source.item, local.item, target], [source.source, local.source], fieldCompleteness);
    expect(data.edges.filter(row => row.sourceId === source.item.objectId && row.relation === 'may_use_lookup')).toEqual([]);
    expect(data.coverageGaps.some(row => row.message.includes('exported source'))).toBe(true);
    expect(parseAutomaticLookup(local.source.text, 'props.conf').automaticLookup).toBeUndefined();
});
test.each(['mvappend(actor,split(other,","))', 'mvindex(actor,0,2)', 'mvjoin(mvdedup(actor),";")', 'mvcount(actor)'])(
    'bounded multivalue calculated input names without evaluation: %s', expression => {
        expect(calculatedFieldInputs(expression)).toMatchObject({ complete: true });
        expect(calculatedFieldInputs(expression).inputs).toContain('actor');
    },
);
test.each(['mvmap(actor,lookup("private",actor))', 'mvfilter(actor)', 'mvindex(actor)', 'mvcount(actor,other)', 'unknown(actor)'])(
    'dynamic, binding or malformed expression stays unsupported: %s', expression =>
        expect(calculatedFieldInputs(expression)).toEqual({ inputs: [], complete: false }),
);
