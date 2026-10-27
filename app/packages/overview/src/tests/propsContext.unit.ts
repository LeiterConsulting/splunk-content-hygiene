// Synthetic invocation-context contracts only; never imported by production.
import { analyzeInventory, AnalysisVisibility } from '../services/analysis';
import { field, fieldCompleteness } from './fieldFixtures';
import { object } from './milestoneFixtures';

const analyze = (items: ReturnType<typeof field>[], visibility?: AnalysisVisibility) =>
    analyzeInventory(items.map(row => row.item), items.map(row => row.source), fieldCompleteness, undefined, visibility);
const contextsFrom = (result: ReturnType<typeof analyze>, id: string) =>
    result.edges.filter(edge => edge.sourceId === id && edge.resolved);

test.each(['different', '$dynamic$'])('an exported REPORT cannot bind through a local source-rule override: %s', localValue => {
    const exported = field('field_extractions', 'REPORT-example', 'named', 'definitions', 'global');
    const override = field('field_extractions', 'REPORT-example', localValue, 'caller');
    const shadowed = field('field_transforms', 'named', 'actor::$1', 'caller');
    const clean = field('field_transforms', 'named', 'actor::$1', 'clean-caller');
    const different = field('field_transforms', 'different', 'other::$1', 'caller');
    const result = analyze([exported, override, shadowed, clean, different]);
    expect(contextsFrom(result, exported.item.objectId)).toEqual([
        expect.objectContaining({ targetId: clean.item.objectId, fieldProvenance: expect.objectContaining({ contextApps: ['clean-caller'] }) }),
    ]);
    expect(result.coverageGaps.some(gap => gap.sourceId === exported.item.objectId && /invoking.*context/i.test(gap.message))).toBe(true);
    if (localValue === 'different') {
        expect(contextsFrom(result, override.item.objectId)).toEqual([expect.objectContaining({ targetId: different.item.objectId })]);
    }
});

test.each(['"constant"', 'lookup("synthetic_table", actor)'])('an exported EVAL cannot read through a local source-rule override: %s', localValue => {
    const exported = field('calculated_fields', 'EVAL-user', 'principal', 'definitions', 'global');
    const override = field('calculated_fields', 'EVAL-user', localValue, 'caller');
    const producer = field('field_aliases', 'FIELDALIAS-principal', 'actor AS principal', 'caller');
    const result = analyze([exported, override, producer]);
    expect(contextsFrom(result, exported.item.objectId)).toEqual([]);
    expect(result.coverageGaps.some(gap => gap.sourceId === exported.item.objectId && /invoking.*context/i.test(gap.message))).toBe(true);
});

test('an exported alias cannot borrow an inline producer from its overridden invoking app', () => {
    const exported = field('field_aliases', 'FIELDALIAS-user', 'actor AS user', 'definitions', 'global');
    const override = field('field_aliases', 'FIELDALIAS-user', 'other AS user', 'caller');
    const producer = field('field_extractions', 'EXTRACT-actor', '(?<actor>synthetic)', 'caller');
    const result = analyze([exported, override, producer]);
    expect(contextsFrom(result, exported.item.objectId)).toEqual([]);
});

test('a private REPORT source shadow withholds an otherwise unique shared transform context', () => {
    const exported = field('field_extractions', 'REPORT-example', 'named', 'definitions', 'global');
    const producer = field('field_transforms', 'named', 'actor::$1', 'caller');
    const result = analyze([exported, producer], {
        privateObjects: [{ collector: 'field_extractions', app: 'caller', count: 1 }],
        privateTargets: [{ collector: 'field_extractions', app: 'caller', name: exported.item.canonicalName }],
    });
    expect(contextsFrom(result, exported.item.objectId)).toEqual([]);
    expect(result.findings.some(row => row.findingType === 'repair_required')).toBe(false);
    expect(result.coverageGaps.some(gap => gap.sourceId === exported.item.objectId && /invoking.*context/i.test(gap.message))).toBe(true);
});

test.each(['known', 'omitted', 'unmapped'])('private source applicability stays unknown: %s', mode => {
    const exported = field('calculated_fields', 'EVAL-user', 'principal', 'definitions', 'global');
    const producer = field('field_aliases', 'FIELDALIAS-principal', 'actor AS principal', 'caller');
    const visibility: AnalysisVisibility = { privateObjects: [{ collector: 'calculated_fields', app: 'caller', count: 1 }],
        ...(mode === 'known' ? { privateTargets: [{ collector: 'calculated_fields', app: 'caller', name: exported.item.canonicalName }] } : {}),
        ...(mode === 'unmapped' ? { privateTargets: [], privateTargetGaps: [{ collector: 'calculated_fields', app: 'caller' }] } : {}),
    };
    const result = analyze([exported, producer], visibility);
    expect(contextsFrom(result, exported.item.objectId)).toEqual([]);
    expect(result.coverageGaps.some(gap => gap.sourceId === exported.item.objectId && /invoking.*context/i.test(gap.message))).toBe(true);
});

test('same-app and unshadowed exported contexts remain potential and input records are preserved', () => {
    const exported = field('calculated_fields', 'EVAL-user', 'principal', 'definitions', 'global');
    const ownProducer = field('field_aliases', 'FIELDALIAS-own', 'actor AS principal', 'definitions');
    const foreignProducer = field('field_aliases', 'FIELDALIAS-foreign', 'actor AS principal', 'clean-caller');
    const unrelated = field('calculated_fields', 'EVAL-different', '"constant"', 'clean-caller');
    const otherAppOverride = field('calculated_fields', 'EVAL-user', '"constant"', 'unrelated-app');
    const items = [exported, ownProducer, foreignProducer, unrelated, otherAppOverride];
    const before = JSON.stringify(items);
    const result = analyze(items);
    expect(contextsFrom(result, exported.item.objectId).map(row => row.targetId).sort()).toEqual([ownProducer.item.objectId, foreignProducer.item.objectId].sort());
    expect(contextsFrom(result, exported.item.objectId).every(row => row.relation.startsWith('may_') && row.fieldProvenance?.invocation === 'invoking_app_unverified')).toBe(true);
    expect(JSON.stringify(items)).toBe(before);
});

test('unrelated private identities and families cannot suppress a visible source context', () => {
    const exported = field('calculated_fields', 'EVAL-user', 'principal', 'definitions', 'global');
    const producer = field('field_aliases', 'FIELDALIAS-principal', 'actor AS principal', 'caller');
    const result = analyze([exported, producer], {
        privateObjects: [{ collector: 'calculated_fields', app: 'caller', count: 1 }, { collector: 'field_extractions', app: 'caller', count: 1 }],
        privateTargets: [{ collector: 'calculated_fields', app: 'caller', name: 'synthetic_private_identity_not_exported' }],
        privateTargetGaps: [{ collector: 'field_extractions', app: 'caller' }],
    });
    expect(contextsFrom(result, exported.item.objectId)).toEqual([expect.objectContaining({ targetId: producer.item.objectId })]);
    expect(JSON.stringify(result)).not.toContain('synthetic_private_identity_not_exported');
});

test('private same-name configuration also prevents a guessed source context in the owning app', () => {
    const consumer = field('calculated_fields', 'EVAL-user', 'principal');
    const producer = field('field_aliases', 'FIELDALIAS-principal', 'actor AS principal');
    const result = analyze([consumer, producer], { privateObjects: [{ collector: 'calculated_fields', app: 'example', count: 1 }],
        privateTargets: [{ collector: 'calculated_fields', app: 'example', name: consumer.item.canonicalName }] });
    expect(contextsFrom(result, consumer.item.objectId)).toEqual([]);
    expect(result.coverageGaps.some(gap => gap.sourceId === consumer.item.objectId && /invoking.*context/i.test(gap.message))).toBe(true);
});

test('a disabled local REPORT declaration still withholds an inherited source context', () => {
    const exported = field('field_extractions', 'REPORT-example', 'named', 'definitions', 'global');
    const override = field('field_extractions', 'REPORT-example', 'different', 'caller', 'app', 'example:events', { disabled: '1' });
    const producer = field('field_transforms', 'named', 'actor::$1', 'caller');
    expect(contextsFrom(analyze([exported, override, producer]), exported.item.objectId)).toEqual([]);
});

test('the same attribute in a different event scope does not override a source identity', () => {
    const exported = field('field_extractions', 'REPORT-example', 'named', 'definitions', 'global');
    const otherScope = field('field_extractions', 'REPORT-example', 'different', 'caller', 'app', 'other:events');
    const producer = field('field_transforms', 'named', 'actor::$1', 'caller');
    expect(contextsFrom(analyze([exported, otherScope, producer]), exported.item.objectId)).toEqual([
        expect.objectContaining({ targetId: producer.item.objectId, fieldProvenance: expect.objectContaining({ contextApps: ['caller'] }) }),
    ]);
});

test('lookup-input context uses automatic-lookup visibility, not unrelated extraction gaps', () => {
    const calc = field('calculated_fields', 'EVAL-normalized', 'lower(actor)');
    const lookup = { ...object('example:events : LOOKUP-example', 'Automatic Lookup'), app: 'example', sharing: 'app' };
    const result = analyzeInventory([calc.item, lookup], [calc.source, {
        objectId: lookup.objectId, kind: 'automatic_lookup', sourceLocation: 'props.conf', text: JSON.stringify({
            stanza: 'example:events', attribute: 'LOOKUP-example', type: 'LOOKUP', transform: 'named', value: 'named key AS normalized OUTPUT user' }),
    }], fieldCompleteness, undefined, { privateObjects: [{ collector: 'field_extractions', app: 'example', count: 1 }],
        privateTargets: [], privateTargetGaps: [{ collector: 'field_extractions', app: 'example' }] });
    expect(contextsFrom(result, lookup.objectId).filter(edge => edge.relation === 'may_read_calculated_field')).toEqual([
        expect.objectContaining({ targetId: calc.item.objectId }),
    ]);
});
