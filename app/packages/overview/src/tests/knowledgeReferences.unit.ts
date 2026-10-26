// Synthetic parser/resolver contracts, never a runtime inventory data source.
import { analyzeInventory, AnalysisCompleteness, RawAnalysisSource } from '../services/analysis';
import { KNOWLEDGE_REFERENCE_LIMIT, parseEventType, parseSpl, SPL_SOURCE_LIMIT } from '../services/dependencyParser';
import { buildKnowledgeReferenceMatcher, KNOWLEDGE_MATCH_LIMIT, KNOWLEDGE_SCAN_EDGE_LIMIT,
    parseTagBinding, tagBindingIdentity } from '../services/knowledgeReferences';
import { isPotentialRelation } from '../utils/dependencySemantics';
import { ContentObject } from '../types';

const complete: AnalysisCompleteness = { macros: true, lookup_definitions: true, lookup_files: true,
    saved_searches: true, data_models: true, indexes: false, sourcetypes: false, automatic_lookups: true,
    event_types: true, tag_bindings: true };
const object = (name: string, type = 'Event Type', app = 'example', sharing = 'app', extra: Partial<ContentObject> = {}): ContentObject => ({
    objectId: `${type}::${app}::${name}`, canonicalName: name, name, objectType: type, app, sharing,
    owner: null, enabled: true, scheduled: null, updated: null, lastUsed: null, usageEvidence: null,
    healthStatus: 'unknown', abandonmentConfidence: null, removalImpact: null, inboundReferences: 0,
    outboundReferences: 0, protected: false, evidence: [], suggestedAction: 'Investigate', ...extra,
});
const source = object('example-search', 'Saved Search');
const binding = (field: string, value: string, tag = 'exampleTag', app = 'example', sharing = 'app', extra: Partial<ContentObject> = {}) =>
    object(JSON.stringify([`${field}=${value}`, tag]), 'Tag Binding', app, sharing, extra);
const named = (text: string) => parseSpl(text).references.filter(reference => ['event_type', 'tag_binding'].includes(reference.targetType));
const analyze = (objects: ContentObject[], text: string, overrides: Partial<AnalysisCompleteness> = {}) => analyzeInventory(
    [source, ...objects], [{ objectId: source.objectId, kind: 'spl', text, sourceLocation: 'search' }], { ...complete, ...overrides });

test.each(['eventtype="Example Purchase"', 'eventtype = "Example Purchase"', 'eventtype ="Example Purchase"'])('literal event-type filter retains identity and provenance: %s', text => {
    expect(named(text)).toEqual([expect.objectContaining({ targetType: 'event_type', targetName: 'Example Purchase',
        relation: 'matches_event_type', sourceLocation: 'search:0' })]);
});

test('negative and nested Boolean filters retain exclusion dependencies instead of treating them as positive scopes', () => {
    expect(named('NOT (eventtype=A OR NOT eventtype=B) eventtype!=C NOT eventtype!=D').map(reference =>
        [reference.targetName, reference.relation])).toEqual([
        ['A', 'excludes_event_type'], ['B', 'matches_event_type'], ['C', 'excludes_event_type'], ['D', 'matches_event_type'],
    ]);
});

test('literal IN lists preserve quoted names, field qualifiers and exclusion polarity', () => {
    expect(named('eventtype IN (A,"Purchase, Complete") NOT tag::eventtype IN (exampleTag,"other tag")').map(reference =>
        [reference.targetType, reference.targetName, reference.relation, reference.tagField])).toEqual([
        ['event_type', 'A', 'matches_event_type', undefined], ['event_type', 'Purchase, Complete', 'matches_event_type', undefined],
        ['tag_binding', 'exampleTag', 'excludes_tag', 'eventtype'], ['tag_binding', 'other tag', 'excludes_tag', 'eventtype'],
    ]);
});

test('quoted keyword names remain literal identities rather than Boolean operators or directives', () => {
    expect(named('eventtype="AND" tag ="CASE" eventtype IN ("NOT", "TERM")').map(reference => reference.targetName)).toEqual(['AND', 'CASE', 'NOT', 'TERM']);
});

test('comments, quoted examples, macro arguments and unrelated case-sensitive field names do not create named dependencies', () => {
    expect(named('index=main "eventtype=example" ``` tag=example ``` EventType=example TAG=example | eval example="tag=example" | `example("eventtype=example")`')).toEqual([]);
});

test.each(['index=main | eval eventtype="A" | search eventtype=A', '| inputlookup example | search tag=exampleTag',
    '| stats count | search eventtype=A', '`unknown_context` eventtype=A', '| tstats count WHERE tag=exampleTag'])('transformed or unestablished event contexts remain gaps: %s', text => {
    const parsed = parseSpl(text);
    expect(named(text)).toEqual([]);
    expect(parsed.gaps?.some(gap => gap.targets !== 'all' && gap.targets.some(target => ['event_type', 'tag_binding'].includes(target)))).toBe(true);
});

test.each(['tag=example*', 'eventtype=$runtime$', 'eventtype=CASE(A)', 'eventtype IN ()', 'eventtype IN (A', 'eventtype="unterminated'])('unsupported literal syntax does not invent a resolved identity: %s', text => {
    expect(named(text)).toEqual([]);
    expect(parseSpl(text).warnings.length).toBeGreaterThan(0);
});

test('a missing named value does not consume a later executable command boundary', () => {
    const parsed = parseSpl('eventtype= | lookup example key');
    expect(parsed.references).toEqual([expect.objectContaining({ targetType: 'lookup', targetName: 'example' })]);
    expect(parsed.warnings.join(' ')).toMatch(/missing|unsupported/i);
});

test('named parser reference count and total source size have explicit limits', () => {
    const parsed = parseSpl(`eventtype IN (${Array.from({ length: KNOWLEDGE_REFERENCE_LIMIT + 5 }, (_value, i) => `example${i}`).join(',')})`);
    expect(parsed.references).toHaveLength(KNOWLEDGE_REFERENCE_LIMIT);
    expect(parsed.warnings.join(' ')).toMatch(/reference limit/);
    expect(parseSpl('x'.repeat(SPL_SOURCE_LIMIT + 1))).toMatchObject({ references: [], warnings: [expect.stringContaining('parse budget')] });
});

test.each(['index=main | search eventtype=A', 'index=main [search eventtype=A]', 'index=main tag=exampleTag', 'index=main tag=*'])('invalid event-type definitions fail closed: %s', text => {
    expect(parseEventType(text)).toMatchObject({ references: [], warnings: expect.arrayContaining([expect.stringContaining('cannot contain')]) });
});

test('a local exact event type wins over an exported same-name definition, including exclusions', () => {
    const local = object('A'); const global = object('A', 'Event Type', 'other', 'global');
    const result = analyze([local, global], 'NOT eventtype=A');
    expect(result.edges).toEqual([expect.objectContaining({ targetId: local.objectId, relation: 'excludes_event_type', resolved: true })]);
});

test('a tag name expands to distinct visible field/value assignments, not one fabricated tag object', () => {
    const first = binding('eventtype', 'A'); const second = binding('host', 'example-host', 'exampleTag', 'other', 'global');
    const hidden = binding('host', 'hidden-host', 'exampleTag', 'hidden', 'app');
    const result = analyze([first, second, hidden], 'tag=exampleTag');
    expect(result.edges.map(edge => edge.targetId).sort()).toEqual([first.objectId, second.objectId].sort());
    expect(result.edges.every(edge => edge.resolved && edge.relation === 'matches_tag')).toBe(true);
});

test('tag field qualifiers, local overrides and disabled definitions remain distinct', () => {
    const local = binding('eventtype', 'A', 'exampleTag', 'example', 'app', { enabled: false });
    const exported = binding('eventtype', 'A', 'exampleTag', 'other', 'global');
    const host = binding('host', 'example-host');
    const result = analyze([local, exported, host], 'tag::eventtype=exampleTag');
    expect(result.edges).toEqual([expect.objectContaining({ targetId: local.objectId, relation: 'may_match_tag', resolved: true })]);
    expect(result.coverageGaps.length).toBeGreaterThan(0);
    expect(isPotentialRelation(result.edges[0].relation)).toBe(true);
});

test('encoded tag field values retain exact assignment identity but never become unconditional applicability', () => {
    const target = binding('eventtype', 'Example%20Encoded');
    const result = analyze([target], 'tag=exampleTag');
    expect(result.edges[0]).toMatchObject({ targetId: target.objectId, resolved: true, relation: 'may_match_tag' });
    expect(result.coverageGaps.some(gap => gap.message.includes('encoded or dynamic'))).toBe(true);
});

test('multiple exported event-type candidates are ambiguous, not broken', () => {
    const result = analyze([object('A', 'Event Type', 'other', 'global'), object('A', 'Event Type', 'another', 'global')], 'eventtype=A');
    expect(result.edges[0]).toMatchObject({ resolved: false, confidence: 'unknown' });
    expect(result.findings).toEqual([]);
});

test('partial catalogs and case-only identities do not justify missing-definition findings', () => {
    const partial = analyze([], 'eventtype=A', { event_types: false });
    expect(partial.edges[0]).toMatchObject({ resolved: false, confidence: 'unknown' });
    expect(partial.findings).toEqual([]);
    const caseOnly = analyze([object('Example')], 'eventtype=example');
    expect(caseOnly.edges[0]).toMatchObject({ resolved: false, confidence: 'unknown' });
    expect(caseOnly.findings).toEqual([]);
});

test('visible case collisions cannot silently favor the spelling identical to the filter', () => {
    const result = analyze([object('Example'), object('example')], 'eventtype=Example');
    expect(result.edges[0]).toMatchObject({ resolved: false, confidence: 'unknown' });
    expect(result.findings).toEqual([]);
    expect(result.coverageGaps.some(gap => gap.message.includes('case-variant'))).toBe(true);
    const outside = analyze([object('Example'), object('example', 'Event Type', 'unrelated', 'app')], 'eventtype=Example');
    expect(outside.edges[0]).toMatchObject({ targetId: object('Example').objectId, resolved: true });
});

test('control characters do not become ordinary literal target identities', () => {
    expect(named('eventtype="Example\u0000Value"')).toEqual([]);
    expect(parseSpl('eventtype="Example\u0000Value"').warnings.join(' ')).toMatch(/unsupported/);
});

test('a complete authoritative catalog can establish a missing literal event type', () => {
    const result = analyze([], 'eventtype=absent');
    expect(result.edges[0]).toMatchObject({ resolved: false, confidence: 'medium', relation: 'matches_event_type' });
    expect(result.findings[0].findingType).toBe('repair_required');
});

test('excluded private event-type shadows prevent global fallback without exposing private metadata', () => {
    const global = object('A', 'Event Type', 'other', 'global');
    const result = analyzeInventory([source, global], [{ objectId: source.objectId, kind: 'spl', text: 'eventtype=A', sourceLocation: 'search' }], complete, undefined,
        { privateObjects: [{ collector: 'event_types', app: 'example', count: 1 }], privateTargets: [{ collector: 'event_types', app: 'example', name: 'A' }] });
    expect(result.edges.every(edge => !edge.resolved && edge.confidence === 'unknown')).toBe(true);
    expect(result.findings).toEqual([]);
});

test('private tag assignments add uncertainty without leaking their private field/value identity', () => {
    const publicBinding = binding('host', 'public-example');
    const result = analyzeInventory([source, publicBinding], [{ objectId: source.objectId, kind: 'spl', text: 'tag=exampleTag', sourceLocation: 'search' }], complete, undefined,
        { privateObjects: [{ collector: 'tag_bindings', app: 'example', count: 1 }], privateTargets: [
            { collector: 'tag_bindings', app: 'example', name: JSON.stringify(['host=private-sensitive-value', 'exampleTag']) },
        ] });
    expect(result.edges.some(edge => edge.targetId === publicBinding.objectId && edge.resolved)).toBe(true);
    expect(result.edges.some(edge => !edge.resolved && edge.confidence === 'unknown')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private-sensitive');
    expect(result.findings).toEqual([]);
});

test('bounded or malformed private identity maps fail closed rather than treating an empty exact-name list as authority', () => {
    const target = binding('host', 'public-example');
    const result = analyzeInventory([source, target], [{ objectId: source.objectId, kind: 'spl', text: 'tag=exampleTag', sourceLocation: 'search' }], complete, undefined,
        { privateObjects: [{ collector: 'tag_bindings', app: 'example', count: 1 }], privateTargets: [],
            privateTargetGaps: [{ collector: 'tag_bindings', app: 'example' }] });
    expect(result.edges.every(edge => !edge.resolved && edge.confidence === 'unknown')).toBe(true);
    expect(result.findings).toEqual([]);
});

test('case-variant private shadows remain unverified without publishing the private spelling', () => {
    const target = object('Example');
    const result = analyzeInventory([source, target], [{ objectId: source.objectId, kind: 'spl', text: 'eventtype=Example', sourceLocation: 'search' }], complete, undefined,
        { privateObjects: [{ collector: 'event_types', app: 'example', count: 1 }],
            privateTargets: [{ collector: 'event_types', app: 'example', name: 'eXaMpLe' }] });
    expect(result.edges[0]).toMatchObject({ resolved: false, confidence: 'unknown' });
    expect(result.findings).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('eXaMpLe');
});

test('exported reusable sources expose potential invoking-app targets rather than guessing their own app', () => {
    const reusable = object('example-macro', 'Macro', 'definitions', 'global');
    const first = object('A'); const second = object('A', 'Event Type', 'another');
    const result = analyzeInventory([reusable, first, second], [{ objectId: reusable.objectId, kind: 'spl', text: 'eventtype=A', sourceLocation: 'definition' }], complete);
    expect(result.edges.map(edge => edge.targetId).sort()).toEqual([first.objectId, second.objectId].sort());
    expect(result.edges.every(edge => edge.resolved && edge.relation === 'may_match_event_type' && edge.confidence === 'medium')).toBe(true);
    expect(result.coverageGaps.length).toBeGreaterThan(0);
});

test('event-type cycles are finite declared relationships, never recursive SPL expansion', () => {
    const first = object('A'); const second = object('B');
    const sources: RawAnalysisSource[] = [first, second].map((item, index) => ({ objectId: item.objectId, kind: 'event_type',
        text: `index=main eventtype=${index ? 'A' : 'B'}`, sourceLocation: 'eventtypes.conf.search' }));
    const result = analyzeInventory([first, second], sources, complete);
    expect(result.edges.filter(edge => edge.relation === 'matches_event_type')).toHaveLength(2);
    expect(result.edges.filter(edge => edge.relation === 'matches_event_type').every(edge => edge.resolved)).toBe(true);
});

test('tag-to-event-type parsing retains provenance and inactive-state qualification', () => {
    const metadata = { field: 'eventtype', tag: 'exampleTag', literalFieldValue: 'A', enabled: true };
    expect(parseTagBinding(JSON.stringify(metadata), 'native.tags[0]')).toMatchObject({ warnings: [], references: [
        expect.objectContaining({ targetType: 'event_type', targetName: 'A', relation: 'tags_event_type', sourceLocation: 'native.tags[0]' }),
    ] });
    expect(parseTagBinding(JSON.stringify({ ...metadata, enabled: false })).references[0].relation).toBe('may_tag_event_type');
    expect(parseTagBinding(JSON.stringify({ ...metadata, literalFieldValue: null })).references).toEqual([]);
    expect(parseTagBinding(JSON.stringify({ ...metadata, field: 'host' })).warnings.join(' ')).toMatch(/field availability/);
    expect(parseTagBinding('{').references).toEqual([]);
});

test('binding identity preserves equals signs and rejects malformed canonical forms', () => {
    expect(tagBindingIdentity(JSON.stringify(['custom=one=two', 'exampleTag']))).toEqual({ stanza: 'custom=one=two', field: 'custom', value: 'one=two', tag: 'exampleTag' });
    expect(tagBindingIdentity('exampleTag')).toBeNull();
    expect(tagBindingIdentity('[1,2]')).toBeNull();
});

test('raw tag names cannot collide with a binding canonical identity', () => {
    const target = binding('host', 'example');
    const result = analyze([target], `tag='${target.canonicalName}'`);
    expect(result.edges[0].resolved).toBe(false);
    expect(result.edges[0].targetId).not.toBe(target.objectId);
});

test('unresolved field-qualified tags retain separate target identities and provenance', () => {
    const result = analyze([], 'tag::host=exampleTag tag::eventtype=exampleTag');
    expect(result.edges).toHaveLength(2);
    expect(new Set(result.edges.map(edge => edge.targetId)).size).toBe(2);
    expect(result.edges.map(edge => edge.targetId)).toEqual(expect.arrayContaining([
        expect.stringContaining('tag::host=exampleTag'), expect.stringContaining('tag::eventtype=exampleTag'),
    ]));
});

test('scope indexing avoids visiting unrelated catalog objects for repeated literal tag queries', () => {
    let visits = 0;
    const targets = Array.from({ length: 5000 }, (_value, index) => {
        const item = binding('host', `example${index}`, 'exampleTag', 'outside');
        Object.defineProperty(item, 'app', { get: () => { visits += 1; return 'outside'; } });
        return item;
    });
    const match = buildKnowledgeReferenceMatcher(targets);
    visits = 0;
    const parsed = parseSpl('index=main tag::host=exampleTag');
    Array.from({ length: 250 }).forEach(() => {
        expect(match(source, parsed).references.find(reference => reference.targetType === 'tag_binding')?.targetObjectId).toBeUndefined();
    });
    expect(visits).toBe(0);
});

test('tag matching discloses actual truncation without labeling an exact-budget result incomplete', () => {
    const bindings = Array.from({ length: KNOWLEDGE_MATCH_LIMIT + 1 }, (_value, index) => binding('host', `example${index}`));
    const parsed = parseSpl('index=main tag=exampleTag');
    const exact = buildKnowledgeReferenceMatcher(bindings.slice(0, KNOWLEDGE_MATCH_LIMIT))(source, parsed);
    expect(exact.references.filter(reference => reference.targetType === 'tag_binding')).toHaveLength(KNOWLEDGE_MATCH_LIMIT);
    expect(exact.warnings).toEqual([]);
    const limited = buildKnowledgeReferenceMatcher(bindings)(source, parsed);
    expect(limited.references.filter(reference => reference.targetType === 'tag_binding')).toHaveLength(KNOWLEDGE_MATCH_LIMIT);
    expect(limited.warnings.join(' ')).toMatch(/safety limit/);
});

test('the whole-scan knowledge edge budget stops fan-out across many callers', () => {
    const bindings = Array.from({ length: KNOWLEDGE_MATCH_LIMIT }, (_value, index) => binding('host', `example${index}`));
    const match = buildKnowledgeReferenceMatcher(bindings);
    const parsed = parseSpl('index=main tag=exampleTag');
    let total = 0;
    Array.from({ length: KNOWLEDGE_SCAN_EDGE_LIMIT / KNOWLEDGE_MATCH_LIMIT }).forEach((_value, index) => {
        const result = match({ ...source, objectId: `example${index}` }, parsed);
        total += result.references.filter(reference => reference.targetType === 'tag_binding').length;
    });
    expect(total).toBe(KNOWLEDGE_SCAN_EDGE_LIMIT);
    const exhausted = match(source, parsed);
    expect(exhausted.references.filter(reference => reference.targetType === 'tag_binding')).toEqual([]);
    expect(exhausted.references[0].targetType).toBe('index');
    expect(exhausted.warnings.join(' ')).toMatch(/safety limit/);
});
