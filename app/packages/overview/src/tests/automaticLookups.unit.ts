// Synthetic contracts only; no test definitions are loaded by the application.
import { analyzeInventory, AnalysisCompleteness, RawAnalysisSource } from '../services/analysis';
import { AUTOMATIC_MATCH_LIMIT, AUTOMATIC_SCAN_EDGE_LIMIT, buildAutomaticLookupMatcher, parseAutomaticLookup } from '../services/automaticLookups';
import { parseDashboard, parseSpl } from '../services/dependencyParser';
import { buildInUseReport } from '../services/inUseContent';
import { analyzeRemovalImpact } from '../services/removalImpact';
import { attachReviewEvidence, compareReviewEvidence, configurationFingerprint } from '../services/reviewEvidence';
import { buildCoverageResolver } from '../services/dependencyCoverage';
import { ContentObject } from '../types';
import { now, object, review, snapshot } from './milestoneFixtures';

const complete: AnalysisCompleteness = { macros: true, lookup_definitions: true, lookup_files: true,
    saved_searches: true, data_models: true, indexes: true, sourcetypes: false, automatic_lookups: true };
function item(name: string, type: string, app = 'example', sharing = 'app'): ContentObject {
    return { ...object(name, type), objectId: `${type}::${app}::${name}`, canonicalName: name, app, sharing,
        configurationFingerprint: configurationFingerprint({ name }, { app, sharing, owner: 'reviewer', perms: { read: ['user'], write: ['admin'] } }) };
}
function automatic(stanza = 'access_log', transform = 'owners', app = 'example', sharing = 'app', extra = {}) {
    const name = `${stanza} : LOOKUP-enrich`;
    const value = item(name, 'Automatic Lookup', app, sharing);
    const content = { stanza, transform, attribute: 'LOOKUP-enrich', type: 'LOOKUP', value: `"${transform}" key OUTPUT owner`, ...extra };
    const source: RawAnalysisSource = { objectId: value.objectId, kind: 'automatic_lookup', text: JSON.stringify(content), sourceLocation: 'props.conf' };
    return { value, source, parsed: parseAutomaticLookup(source.text, source.sourceLocation) };
}
function search(value: ContentObject, text: string): RawAnalysisSource {
    return { objectId: value.objectId, kind: 'spl', text, sourceLocation: 'search' };
}

test('canonical REST rule fields preserve spaced lookup names and props provenance without execution', () => {
    const rule = automatic('access_log', 'Owner Directory');
    expect(rule.parsed.references[0]).toMatchObject({ targetType: 'lookup', targetName: 'Owner Directory', relation: 'uses_lookup', confidence: 'high' });
    expect(rule.parsed.references[0].sourceLocation).toBe('props.conf.LOOKUP-enrich');
    expect(rule.parsed.automaticLookup).toMatchObject({ scopeField: 'sourcetype', scopeValue: 'access_log', exactScope: true });
    expect(rule.parsed.warnings).toEqual([]);
});

test.each([
    { stanza: 'access_log', query: 'index=main sourcetype=access_log', matched: true },
    { stanza: 'Access_Log', query: 'index=main sourcetype=access_log', matched: true },
    { stanza: 'host::Server-A', query: 'index=main host=SERVER-A', matched: true },
    { stanza: 'source::/var/log/access.log', query: 'index=main source="/var/log/access.log"', matched: true },
    { stanza: 'source::/var/log/Access.log', query: 'index=main source="/var/log/access.log"', matched: true },
    { stanza: 'source::/var/log/...', query: 'index=main source="/var/log/access.log"', matched: false },
    { stanza: 'host::(?-i)Server-A', query: 'index=main host=Server-A', matched: false },
    { stanza: 'access_*', query: 'index=main sourcetype=access_log', matched: false },
    { stanza: 'access_+', query: 'index=main sourcetype=access_log', matched: false },
])('exact selector matching respects scope semantics: $stanza', ({ stanza, query, matched }) => {
    const rule = automatic(stanza); const caller = item('Caller', 'Saved Search'); const target = item('owners', 'Lookup Definition');
    const result = analyzeInventory([caller, rule.value, target], [search(caller, query), rule.source], complete);
    expect(result.edges.some((edge) => edge.relation === 'may_apply_automatic_lookup')).toBe(matched);
    expect(result.edges.find((edge) => edge.relation === 'uses_lookup')?.targetId).toBe(target.objectId);
});

test.each([
    'index=main NOT sourcetype=access_log',
    'index=main sourcetype!=access_log',
    'index=main NOT (host IN (server-a,server-b))',
    '| makeresults | eval text="sourcetype=access_log" | search sourcetype=access_log',
    '| tstats count WHERE index=main sourcetype=access_log',
    '| inputlookup table | search source="/var/log/access.log"',
    'index=main "sourcetype=access_log"',
    'index=main | eval sourcetype="access_log" | search sourcetype=access_log',
    'index=main | stats count | search host=server-a',
    '`unknown_base` sourcetype=access_log',
    'index=main SOURCETYPE=access_log',
    'index=main sourcetype=CASE(access_log)',
    'index=main source=TERM(/var/log/access.log)',
])('non-event/negative/literal contexts do not manufacture caller selectors: %s', (text) => {
    expect(parseSpl(text).eventSelectors).toEqual([]);
});

test('positive IN values and executed subsearches retain selector provenance', () => {
    const parsed = parseSpl('index=main NOT [search index=other sourcetype=access_log] host IN (server-a,"server b")');
    expect(parsed.eventSelectors?.map((row) => [row.field, row.value])).toEqual([
        ['sourcetype', 'access_log'], ['host', 'server-a'], ['host', 'server b'],
    ]);
    expect(parsed.eventSelectors?.every((row) => row.sourceLocation.startsWith('search:'))).toBe(true);
});

test('post-process dashboard queries do not become new event searches', () => {
    expect(parseDashboard('<dashboard><search base="base"><query>search sourcetype=access_log</query></search></dashboard>').eventSelectors).toEqual([]);
    expect(parseDashboard(JSON.stringify({ dataSources: { post: { type: 'ds.chain', options: { query: 'search sourcetype=access_log' } } } })).hasEventSearch).toBe(false);
});

test.each([{ transform: '' }, { transform: '$runtime$' }, { value: 'different key OUTPUT owner' }, { attribute: 'EVAL-owner' }, { stanza: '' }])(
    'malformed/dynamic rule %j remains a gap, not a proven broken lookup', (change) => {
        const rule = automatic('access_log', 'owners', 'example', 'app', change);
        const result = analyzeInventory([rule.value], [rule.source], complete);
        expect(result.edges).toEqual([]);
        expect(result.findings.some((finding) => finding.findingType === 'repair_required')).toBe(false);
        expect(result.coverageGaps.length).toBeGreaterThan(0);
    },
);

test('disabled rules do not gain caller or backing-definition edges', () => {
    const rule = automatic('access_log', 'owners', 'example', 'app', { disabled: true }); const caller = item('Caller', 'Saved Search');
    const result = analyzeInventory([caller, rule.value, item('owners', 'Lookup Definition')], [rule.source, search(caller, 'index=main sourcetype=access_log')], complete);
    expect(result.edges.some((edge) => edge.sourceId === rule.value.objectId || edge.targetId === rule.value.objectId)).toBe(false);
});

test.each(['True', 'TRUE', 'true', true, 1, '1'])('native disabled encoding %s never creates an enabled lookup binding', disabled => {
    const rule = automatic('access_log', 'owners', 'example', 'app', { disabled });
    expect(rule.parsed.automaticLookup?.disabled).toBe(true);
    expect(rule.parsed.references).toEqual([]);
});

test('withheld exported bindings have a candidate-visit budget, not only an emitted-edge budget', () => {
    const source = automatic('access_log', 'owners', 'origin', 'global');
    const definitions = Array.from({ length: 6000 }, (_, i) => item('owners', 'Lookup Definition', `scope_${i}`));
    const shadows = definitions.map(target => ({ ...source.value, app: target.app, sharing: 'app', objectId: `local::${target.app}` }));
    const matcher = buildAutomaticLookupMatcher([{ object: source.value, rule: source.parsed.automaticLookup! }], [source.value, ...shadows, ...definitions], { complete: true, privatePossible: false });
    const result = matcher.bindings(source.value, source.parsed);
    expect(result.references.filter(row => row.relation === 'may_use_lookup')).toEqual([]);
    expect(result.gaps?.some(row => row.message.includes('candidate-visit budget'))).toBe(true);
    expect(result.warnings.filter(row => row.includes('guessed binding is withheld'))).toHaveLength(1);
});

test('duplicate caller candidates consume per-source and whole-scan visit budgets', () => {
    const rules = Array.from({ length: 6000 }, (_, i) => automatic('access_log', 'owners', `scope_${i}`, 'global'));
    const matcher = buildAutomaticLookupMatcher(rules.map(row => ({ object: row.value, rule: row.parsed.automaticLookup! })), rules.map(row => row.value), { complete: true, privatePossible: false });
    const caller = item('Caller', 'Saved Search');
    for (let i = 0; i < 20; i += 1) {
        const result = matcher.callers(caller, parseSpl('index=main sourcetype=access_log'));
        expect(result.references.filter(row => row.targetType === 'automatic_lookup')).toHaveLength(1);
        expect(result.gaps?.some(row => row.message.includes('candidate-visit budget'))).toBe(true);
    }
    const exhausted = matcher.callers(caller, parseSpl('index=main sourcetype=access_log'));
    expect(exhausted.references.filter(row => row.targetType === 'automatic_lookup')).toEqual([]);
    expect(exhausted.gaps?.some(row => row.message.includes('candidate-visit budget'))).toBe(true);
});

test('namespace-local rule overrides an exported same-name rule; foreign app-only rules are not callers', () => {
    const local = automatic(); const exported = automatic('access_log', 'owners', 'other', 'global'); const foreign = automatic('host::server-a', 'owners', 'other');
    const caller = item('Caller', 'Saved Search'); const result = analyzeInventory([caller, local.value, exported.value, foreign.value, item('owners', 'Lookup Definition')],
        [search(caller, 'index=main sourcetype=access_log host=server-a'), local.source, exported.source, foreign.source], complete);
    const links = result.edges.filter((edge) => edge.relation === 'may_apply_automatic_lookup');
    expect(links.map((edge) => edge.targetId)).toEqual([local.value.objectId]);
});

test('exported rule retains possible caller-app lookup overrides without pretending one runtime binding', () => {
    const rule = automatic('access_log', 'owners', 'origin', 'global');
    const first = item('owners', 'Lookup Definition', 'origin'); const second = item('owners', 'Lookup Definition', 'consumer');
    const result = analyzeInventory([rule.value, first, second], [rule.source], complete);
    expect(result.edges.find((edge) => edge.relation === 'uses_lookup')?.targetId).toBe(first.objectId);
    expect(result.edges.find((edge) => edge.relation === 'may_use_lookup')).toMatchObject({ targetId: second.objectId, resolved: true });
    expect(result.coverageGaps.some((gap) => gap.message.includes('invoking app'))).toBe(true);
});

test('an exported rule with only a foreign app-local definition is not declared broken in its originating app', () => {
    const rule = automatic('access_log', 'owners', 'origin', 'global');
    const result = analyzeInventory([rule.value, item('owners', 'Lookup Definition', 'consumer')], [rule.source], complete);
    expect(result.edges.find((row) => row.relation === 'uses_lookup')).toMatchObject({ resolved: false, confidence: 'unknown' });
    expect(result.edges.find((row) => row.relation === 'may_use_lookup')?.resolved).toBe(true);
    expect(result.findings.some((row) => row.findingType === 'repair_required')).toBe(false);
});

test('private rule/definition shadows are uncertain without persisting private identities or arbitrarily resolving', () => {
    const rule = automatic('access_log', 'owners', 'other', 'global'); const caller = item('Caller', 'Saved Search');
    const result = analyzeInventory([caller, rule.value, item('owners', 'Lookup Definition', 'other', 'global'), item('main', 'Index'), item('access_log', 'Sourcetype')],
        [search(caller, 'index=main sourcetype=access_log'), rule.source], complete, undefined, {
            privateObjects: [{ collector: 'automatic_lookups', app: 'example', count: 1 }, { collector: 'lookup_definitions', app: 'hidden-app', count: 1 }],
            privateTargets: [{ collector: 'automatic_lookups', app: 'example', name: rule.value.canonicalName }, { collector: 'lookup_definitions', app: 'hidden-app', name: 'owners' }],
        });
    expect(result.edges.filter((edge) => ['may_apply_automatic_lookup', 'uses_lookup'].includes(edge.relation)).every((edge) => !edge.resolved)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('hidden-app');
    expect(result.findings.some((finding) => finding.findingType === 'repair_required')).toBe(false);
});

test('broad scopes retain an explicit gap rather than joining every automatic rule', () => {
    const rule = automatic(); const caller = item('Caller', 'Saved Search');
    const result = analyzeInventory([caller, rule.value], [search(caller, 'index=main'), rule.source], complete);
    expect(result.edges.some((edge) => edge.sourceId === caller.objectId && edge.relation === 'may_apply_automatic_lookup')).toBe(false);
    expect(result.coverageGaps.some((gap) => gap.sourceId === caller.objectId && gap.targets.includes('automatic_lookup'))).toBe(true);
});

test('reusable macro event scope is not assigned the definition app as its invoking app', () => {
    const rule = automatic(); const macro = item('shared_macro', 'Macro');
    const result = analyzeInventory([macro, rule.value], [search(macro, 'index=main sourcetype=access_log'), rule.source], complete);
    expect(result.edges.some((edge) => edge.relation === 'may_apply_automatic_lookup')).toBe(false);
    expect(result.coverageGaps.some((gap) => gap.sourceId === macro.objectId && gap.message.includes('invoking search namespace'))).toBe(true);
});

test('missing definition is asserted only with a complete target catalog; collection failures remain unknown', () => {
    const rule = automatic();
    expect(analyzeInventory([rule.value], [rule.source], complete).findings.some((finding) => finding.findingType === 'repair_required')).toBe(true);
    const partial = analyzeInventory([rule.value], [rule.source], { ...complete, lookup_definitions: false });
    expect(partial.edges[0]).toMatchObject({ resolved: false, confidence: 'unknown' });
    expect(partial.findings.some((finding) => finding.findingType === 'repair_required')).toBe(false);
});

test('potential applicability and weakest confidence propagate through footprint and impact paths', () => {
    const caller = item('Caller', 'Saved Search'); const rule = automatic(); const definition = item('owners', 'Lookup Definition'); const file = item('owners.csv', 'Lookup File');
    const result = analyzeInventory([caller, rule.value, definition, file], [search(caller, 'index=main sourcetype=access_log'), rule.source,
        { objectId: definition.objectId, kind: 'lookup', text: 'owners.csv', sourceLocation: 'filename' }], complete);
    const data = snapshot(result.objects, result.edges); data.scan.collectorCounts.automatic_lookups = 1;
    const report = buildInUseReport(data, [], { activity: 'none', includeRetained: false, successfulOnly: false, selectedIds: [caller.objectId] }, now);
    [rule.value.objectId, definition.objectId, file.objectId].forEach((id) => {
        expect(report.rows.find((row) => row.objectId === id)?.via).toMatchObject({ conditional: true, confidence: 'medium' });
    });
    expect(report.gaps.some((gap) => gap.includes('potential configuration relationship'))).toBe(true);
    const impact = analyzeRemovalImpact(file, result.objects, result.edges, [], data.scan, 5, now);
    expect(impact.affectedObjects.find((row) => row.objectId === caller.objectId)).toMatchObject({ conditional: true, confidence: 'medium' });
    expect(impact.affectedObjects.find((row) => row.objectId === caller.objectId)?.likelyOutcome).toContain('Potential impact only');
    expect(impact.potentialConsequences.join(' ')).toContain('potential implicit paths');
    const directImpact = analyzeRemovalImpact(rule.value, result.objects, result.edges, [], data.scan, 5, now);
    expect(directImpact.potentialConsequences.join(' ')).toContain('potential implicit matches');
    expect(directImpact.removalPlan[2].detail).toContain('not confirmed consumers');
    expect(directImpact.readinessLabel).toBe('Potential dependencies require verification');
});

test('a potential-only consumer cannot prove a dependency will become orphaned', () => {
    const caller = item('Caller', 'Saved Search'); const rule = automatic();
    const result = analyzeInventory([caller, rule.value, item('owners', 'Lookup Definition')], [search(caller, 'index=main sourcetype=access_log'), rule.source], complete);
    const impact = analyzeRemovalImpact(caller, result.objects, result.edges, [], snapshot(result.objects, result.edges).scan, 3, now);
    const followUp = impact.dependencyFollowUps.find((row) => row.objectId === rule.value.objectId);
    expect(followUp).toMatchObject({ knownDependentCount: 0, potentialDependentCount: 1, potentiallyOrphaned: false });
    expect(followUp?.recommendation).toContain('Verify implicit applicability');
});

test('bounded matcher discloses per-object and whole-scan limits instead of producing an unbounded graph', () => {
    const caller = item('Caller', 'Saved Search');
    const rules = Array.from({ length: AUTOMATIC_MATCH_LIMIT + 1 }, (_, index) => {
        const entry = automatic(); entry.value.canonicalName += index;
        return { object: entry.value, rule: entry.parsed.automaticLookup! };
    });
    const matcher = buildAutomaticLookupMatcher(rules, [], { complete: true, privatePossible: false });
    const parsed = parseSpl('index=main sourcetype=access_log');
    const first = matcher.callers(caller, parsed);
    expect(first.references.filter((ref) => ref.targetType === 'automatic_lookup')).toHaveLength(AUTOMATIC_MATCH_LIMIT);
    expect(first.warnings.some((message) => message.includes('safety limit'))).toBe(true);
    for (let count = AUTOMATIC_MATCH_LIMIT; count < AUTOMATIC_SCAN_EDGE_LIMIT; count += AUTOMATIC_MATCH_LIMIT) { matcher.callers(caller, parsed); }
    const exhausted = matcher.callers(caller, parsed);
    expect(exhausted.references.filter((ref) => ref.targetType === 'automatic_lookup')).toEqual([]);
    expect(exhausted.warnings.some((message) => message.includes('safety limit'))).toBe(true);
});

test('new catalog/relationships change evidence assessment, never the existing decision or baseline', async () => {
    const definition = item('owners', 'Lookup Definition'); const parent = item('example', 'App'); const rule = automatic();
    const scope = { scanId: 'scan-fixture', observedAt: new Date(now).toISOString(), principal: 'operator', roles: ['operator'], mode: 'full', collectionComplete: true, analysisComplete: true,
        collectors: { apps: true, macros: true, saved_searches: true, dashboards: true, data_models: true, indexes: true, sourcetypes: true, lookup_definitions: true, lookup_files: true, automatic_lookups: true, event_types: true, tag_bindings: true } };
    const before = await attachReviewEvidence([definition, parent], [], scope);
    const saved = review(definition.objectId, { evidenceBaseline: { capturedAt: scope.observedAt, capturedBy: 'reviewer', evidence: before[0].reviewEvidence! } });
    const bytes = JSON.stringify(saved);
    const result = analyzeInventory([definition, parent, rule.value], [rule.source], complete);
    const after = await attachReviewEvidence(result.objects, result.edges, { ...scope, coverageContext: { gaps: result.coverageGaps, privateObjects: [], collectors: scope.collectors, identityKnown: true } });
    const current = after.find((row) => row.objectId === definition.objectId)!;
    expect(compareReviewEvidence(saved, current, snapshot(after, result.edges).scan, now).status).toBe('needs_review');
    expect(JSON.stringify(saved)).toBe(bytes);
    expect(saved.stage).toBe('retain'); expect(saved.note).toBe('Original rationale');
});

test('automatic lookup and other implicit props coverage stays separate from unrelated macro coverage', () => {
    const rule = automatic(); const lookup = item('owners', 'Lookup Definition'); const macro = item('unrelated', 'Macro');
    const resolver = buildCoverageResolver({ gaps: [], privateObjects: [], identityKnown: true,
        collectors: { apps: true, macros: true, saved_searches: true, dashboards: true, data_models: true, automatic_lookups: false, event_types: true, tag_bindings: true, workflow_actions: true, navigation: true } });
    expect(resolver(rule.value, [], true).inbound.status).toBe('partial');
    expect(resolver(lookup, [], true).inbound.reasons.join(' ')).toContain('automatic_lookups');
    expect(resolver(macro, [], true).inbound.status).toBe('complete');
});
