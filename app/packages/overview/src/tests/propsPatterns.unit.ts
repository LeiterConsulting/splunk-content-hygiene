// Synthetic adversarial contracts only. Never loaded into a native inventory.
import { compilePropsPattern, createPropsPatternIndex, matchPropsPattern, propsScopeLabel } from '../services/propsPatterns';
import { analyzeInventory } from '../services/analysis';
import { buildFieldDependencyMatcher } from '../services/fieldDependencies';
import { parseSpl } from '../services/dependencyParser';
import { checkPropsPrecedence, PropsRead } from '../services/propsPrecedence';
import { compareCrossStanzaProps } from '../services/crossStanzaProps';
import { readCrossStanzaProps } from '../services/crossStanzaEvidence';
import { attachReviewEvidence, compareReviewEvidence, parseReviewBaseline } from '../services/reviewEvidence';
import { buildInUseReport } from '../services/inUseContent';
import { analyzeRemovalImpact } from '../services/removalImpact';
import { FieldScope } from '../types';
import { field, fieldCompleteness } from './fieldFixtures';
import { now, object, review, snapshot } from './milestoneFixtures';

const scope = (value: string, fieldName: FieldScope['field'] = 'source'): FieldScope => ({ field: fieldName, value, exact: false });
test.each([
    ['/var/log/*.log', '/var/log/app.log', 'match'], ['/var/log/*.log', '/var/log/a/b.log', 'no_match'],
    ['/var/.../app.log', '/var/a/b/app.log', 'match'], ['/var/.../app.log', '/var/app.log', 'no_match'],
    ['...app.log', 'app.log', 'match'], ['...app.log', 'x/app.log', 'match'],
    ['*.log', '.log', 'match'], ['*.log', 'app.log.bak', 'no_match'], ['app.*', 'Xapp.log', 'no_match'],
    ['app.*', 'appXlog', 'no_match'], ['....log', 'app.log', 'match'], ['a*...z', 'a/b/z', 'match'],
    ['a...*z', 'a/b/z', 'match'], ['a*b', 'ab', 'match'], ['a*b', 'a/x/b', 'no_match'],
    ['App.*', 'app.log', 'case_ambiguous'], ['*.LOG', 'app.log', 'case_ambiguous'],
])('whole-name, separator-aware bounded match %s against %s', (pattern, value, expected) => {
    expect(matchPropsPattern(compilePropsPattern(scope(pattern)), { field: 'source', value })).toBe(expected);
});
test.each(['(?i)foo*', '(?-i)foo', '*[abc]', '*foo|bar', 'a+b*', '^foo*', 'foo*$', 'foo?*', 'foo{2}*',
    'source%3A%3Afoo*', 'foo\\bar*', 'föö*', 'rule::named', 'delayedrule::named', `${'x'.repeat(257)}*`])('unsupported %s is not a non-match', pattern => {
    const compiled = compilePropsPattern(scope(pattern)); expect(compiled.kind).toBe('unsupported');
    expect(matchPropsPattern(compiled, { field: 'source', value: 'anything' })).toBe('unsupported');
});
test('host is ASCII-insensitive; other fields and identities retain exact case', () => {
    expect(matchPropsPattern(compilePropsPattern(scope('Server-*', 'host')), { field: 'host', value: 'server-A' })).toBe('match');
    expect(matchPropsPattern(compilePropsPattern(scope('Server-*', 'sourcetype')), { field: 'sourcetype', value: 'server-A' })).toBe('case_ambiguous');
    expect(matchPropsPattern(compilePropsPattern(scope('Server-*', 'host')), { field: 'source', value: 'Server-A' })).toBe('no_match');
});
test('only the actual default stanza is a default, not a prefixed or case-variant literal', () => {
    expect(compilePropsPattern(scope('default', 'sourcetype')).kind).toBe('default');
    expect(compilePropsPattern(scope('default', 'host')).kind).toBe('literal');
    expect(compilePropsPattern(scope('Default', 'sourcetype')).kind).toBe('literal');
    expect(propsScopeLabel(scope('default', 'sourcetype'))).toContain('potential shared fallback');
});
test('character work, oversized values and whole-scan budgets fail closed', () => {
    const pattern = compilePropsPattern(scope('a*...z'));
    const local = { remaining: 4 }; const scan = { remaining: 100 };
    expect(matchPropsPattern(pattern, { field: 'source', value: 'a/b/z' }, [local, scan])).toBe('budget');
    expect(local.remaining).toBe(4); expect(scan.remaining).toBe(100);
    expect(matchPropsPattern(pattern, { field: 'source', value: 'a'.repeat(1025) })).toBe('budget');
    expect(matchPropsPattern(pattern, { field: 'source', value: 'a/z' }, [{ remaining: 100 }, { remaining: 0 }])).toBe('budget');
    expect(matchPropsPattern(pattern, { field: 'source', value: 'a\\z' })).toBe('unsupported');
});
test('prefix and namespace indexes do not inspect an estate of unrelated pattern prefixes', () => {
    const index = createPropsPatternIndex<string>();
    for (let n = 0; n < 5000; n += 1) { index.add(scope(`unrelated${n}*`), 'example', false, String(n)); }
    index.add(scope('/var/*'), 'foreign', false, 'hidden'); index.add(scope('/var/*'), 'foreign', true, 'exported');
    index.add(scope('default', 'sourcetype'), 'example', false, 'default');
    const candidates = [...index.candidates({ field: 'source', value: '/var/log' }, 'example')];
    expect(candidates.map(row => row.item).sort()).toEqual(['default', 'exported']);
});
test('non-matching pattern work consumes per-source and whole-scan budgets even when no edge emits', () => {
    const rules = Array.from({ length: 600 }, (_, n) => field('field_aliases', `FIELDALIAS-${n}`, 'actor AS owner', 'example', 'app', `source::*tail${n}`));
    const matcher = buildFieldDependencyMatcher(rules.map(row => row.item), true);
    const caller = { ...object('long selector caller', 'Saved Search'), app: 'example' };
    const parsed = parseSpl(`source=${'x'.repeat(1024)}`);
    Array.from({ length: 12 }).forEach(() => {
        const result = matcher(caller, parsed);
        expect(result.references.filter(row => row.fieldProvenance?.kind === 'event_scope')).toEqual([]);
        expect(result.gaps?.some(row => row.message.includes('pattern-work budget'))).toBe(true);
    });
});
test('default/pattern namespace shadows and foreign app-only declarations do not gain guessed caller links', () => {
    const exported = field('field_aliases', 'FIELDALIAS-owner', 'actor AS owner', 'foreign', 'global', 'default');
    const local = field('field_aliases', 'FIELDALIAS-owner', 'actor AS local_owner', 'example', 'app', 'default');
    const hidden = field('field_aliases', 'FIELDALIAS-foreign', 'actor AS other', 'foreign', 'app', 'source::*');
    const caller = { ...object('namespaced caller', 'Saved Search'), app: 'example' }; const rules = [exported, local, hidden];
    const result = analyzeInventory([caller, ...rules.map(row => row.item)], [{ objectId: caller.objectId, kind: 'spl', text: 'source=/var/log/app.log', sourceLocation: 'search' }, ...rules.map(row => row.source)], fieldCompleteness);
    expect(result.edges.filter(edge => edge.fieldProvenance?.kind === 'event_scope').map(edge => edge.targetId)).toEqual([local.item.objectId]);
    const privateResult = analyzeInventory([caller, exported.item], [{ objectId: caller.objectId, kind: 'spl', text: 'source=/var/log/app.log', sourceLocation: 'search' }, exported.source], fieldCompleteness, undefined,
        { privateObjects: [{ collector: 'field_aliases', app: 'example', count: 1 }], privateTargets: [{ collector: 'field_aliases', app: 'example', name: exported.item.canonicalName }] });
    expect(privateResult.edges.filter(edge => edge.fieldProvenance?.kind === 'event_scope')).toEqual([]);
    expect(privateResult.coverageGaps.length).toBeGreaterThan(0);
});
test('separate dashboard query locations retain separate default caller witnesses, not a fabricated conjunction', () => {
    const rule = field('field_aliases', 'FIELDALIAS-owner', 'actor AS owner', 'example', 'app', 'default');
    const caller = { ...object('dashboard', 'Dashboard'), app: 'example' };
    const result = analyzeInventory([caller, rule.item], [{ objectId: caller.objectId, kind: 'dashboard', sourceLocation: 'dashboard',
        text: '<dashboard><search><query>source=/var/log/app.log</query></search><search><query>sourcetype=events</query></search></dashboard>' }, rule.source], fieldCompleteness);
    const edge = result.edges.find(row => row.fieldProvenance?.kind === 'event_scope')!;
    expect(edge.fieldProvenance?.contexts).toHaveLength(2); expect(result.propsEventScopes).toHaveLength(2);
    expect(result.propsEventScopes.every(row => row.selectors.length === 1)).toBe(true);
});

export async function patternFixture(stanzas = ['source::/var/log/app.log', 'source::/var/log/*.log', 'default'], priorities: Array<number | undefined> = []) {
    const caller = { ...object('pattern caller', 'Saved Search'), app: 'example' };
    const rules = stanzas.map(stanza => field('field_aliases', 'FIELDALIAS-owner', 'actor AS owner', 'example', 'app', stanza));
    const analysis = analyzeInventory([caller, ...rules.map(row => row.item)], [{ objectId: caller.objectId, kind: 'spl',
        text: 'index=main source=/var/log/app.log sourcetype=events', sourceLocation: 'search' }, ...rules.map(row => row.source)], fieldCompleteness);
    const read: PropsRead = async request => {
        const index = rules.findIndex(row => row.entry.name === request.name); const row = rules[index];
        return { status: 200, data: request.kind === 'rule' ? { entry: [row.entry] } : { entry: [{ name: request.stanza, content: {
            [request.attribute]: (row.entry.content as Record<string, unknown>).value, 'eai:appName': request.app, 'eai:userName': 'nobody',
            ...(priorities[index] !== undefined ? { priority: priorities[index] } : {}) } }] } };
    };
    const native = await checkPropsPrecedence(analysis.objects, analysis.edges, read);
    const result = await compareCrossStanzaProps(native.objects, native.edges.filter(edge => edge.fieldProvenance?.kind === 'event_scope'), analysis.propsEventScopes, { catalogsComplete: true });
    return { ...result, caller, rules, scopes: analysis.propsEventScopes };
}
test('native literal/pattern priority defaults and default fallback ordering retain every possible edge', async () => {
    const result = await patternFixture(undefined, [undefined, undefined, 999999]);
    const rows = result.edges.flatMap(edge => edge.fieldProvenance?.crossStanzaProps ?? []);
    expect(rows).toHaveLength(3); expect(result.edges.every(edge => edge.confidence === 'medium' && edge.resolved)).toBe(true);
    expect(rows.find(row => row.objectId === result.rules[0].item.objectId)).toMatchObject({ status: 'highest', stanzaPriority: 100 });
    expect(rows.find(row => row.objectId === result.rules[1].item.objectId)).toMatchObject({ status: 'lower', reason: 'priority', stanzaPriority: 0 });
    expect(rows.find(row => row.objectId === result.rules[2].item.objectId)).toMatchObject({ status: 'lower', reason: 'category', stanzaPriority: 999999 });
    expect(readCrossStanzaProps(rows)).toEqual(rows);
});
test('explicit pattern priority may exceed a literal without pruning the literal/default fallback', async () => {
    const result = await patternFixture(undefined, [undefined, 101]);
    const rows = result.edges.flatMap(edge => edge.fieldProvenance?.crossStanzaProps ?? []);
    expect(rows.filter(row => row.status === 'highest').map(row => row.objectId)).toEqual([result.rules[1].item.objectId]);
    expect(result.edges).toHaveLength(3);
});
test('case-sensitive pattern uncertainty and incomplete native catalogs prevent a highest claim', async () => {
    const result = await patternFixture(['source::/var/log/App.log', 'source::/var/log/*.log', 'default']);
    expect(result.edges.flatMap(edge => edge.fieldProvenance?.crossStanzaProps ?? []).every(row => row.status === 'unverified')).toBe(true);
    const unknown = await compareCrossStanzaProps(result.objects, result.edges, result.scopes, { catalogsComplete: false });
    expect(unknown.edges.flatMap(edge => edge.fieldProvenance?.crossStanzaProps ?? []).every(row => row.status === 'unverified')).toBe(true);
});
test('default needs a positive selector witness, not app containment or generated events', () => {
    const fallback = field('field_aliases', 'FIELDALIAS-owner', 'actor AS owner', 'example', 'app', 'default');
    const caller = { ...object('broad', 'Saved Search'), app: 'example' };
    ['index=main', '| makeresults | eval source="/var/log/app.log"', '`runtime` sourcetype=events'].forEach(text => {
        const result = analyzeInventory([caller, fallback.item], [{ objectId: caller.objectId, kind: 'spl', text, sourceLocation: 'search' }, fallback.source], fieldCompleteness);
        expect(result.edges.filter(edge => edge.fieldProvenance?.kind === 'event_scope')).toEqual([]);
        expect(result.coverageGaps.length).toBeGreaterThan(0);
    });
});
test('captured defaults retain potential earlier-phase pattern producers with domain evidence', () => {
    const first = field('field_extractions', 'EXTRACT-actor', '(?<actor>synthetic)', 'example', 'app', 'source::*.log');
    const second = field('field_aliases', 'FIELDALIAS-owner', 'actor AS owner', 'example', 'app', 'default');
    const result = analyzeInventory([first.item, second.item], [first.source, second.source], fieldCompleteness);
    expect(result.edges.filter(edge => edge.fieldProvenance?.kind === 'field_input')).toEqual([
        expect.objectContaining({ sourceId: second.item.objectId, targetId: first.item.objectId, relation: 'may_read_extracted_field',
            fieldProvenance: expect.objectContaining({ scopeCompatibility: { version: 1, consumer: second.item.fieldLineage!.scope,
                producer: first.item.fieldLineage!.scope, basis: 'captured_default' } }) }),
    ]);
});
test('v7 baseline/decision bytes are preserved; new policy requests review and report builders retain fallbacks', async () => {
    const result = await patternFixture(); const data = snapshot(result.objects, result.edges);
    const context = { scanId: data.scan.scanId, observedAt: new Date(now).toISOString(), principal: 'operator', roles: ['operator'], mode: 'full', collectionComplete: true, analysisComplete: false, collectors: {} };
    const current = (await attachReviewEvidence(result.objects, result.edges, context)).find(row => row.objectId === result.rules[1].item.objectId)!;
    const legacy = JSON.parse(JSON.stringify(current.reviewEvidence)); legacy.coverage.policy = 'shared-static-v7';
    const baseline = { capturedAt: new Date(now).toISOString(), capturedBy: 'reviewer', evidence: legacy }; expect(parseReviewBaseline(baseline)).toEqual(baseline);
    const saved = review(current.objectId, { stage: 'retain', note: 'Keep original decision', evidenceBaseline: baseline }); const bytes = JSON.stringify(saved);
    expect(current.reviewEvidence?.coverage?.policy).toBe('shared-static-v10');
    expect(compareReviewEvidence(saved, current, data.scan, now).status).toBe('needs_review');
    const report = buildInUseReport(data, [], { selectedIds: [result.caller.objectId], activity: 'none', includeRetained: false, successfulOnly: false }, now);
    expect(report.relationships).toHaveLength(3); expect(report.rows.filter(row => row.objectId !== result.caller.objectId).every(row => row.via?.conditional)).toBe(true);
    const impact = analyzeRemovalImpact(current, result.objects, result.edges, [], data.scan, 5, now);
    expect(impact.readiness).toBe('blocked'); expect(impact.directDependents[0].fieldProvenance?.scope?.exact).toBe(false);
    expect(JSON.parse(JSON.stringify(report)).relationships).toEqual(report.relationships); expect(JSON.stringify(saved)).toBe(bytes);
});
