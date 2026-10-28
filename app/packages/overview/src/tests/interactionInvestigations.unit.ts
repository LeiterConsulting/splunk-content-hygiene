// Synthetic contracts only; no lab data, external calls or seeded objects.
import { analyzeInventory, AnalysisCompleteness, RawAnalysisSource } from '../services/analysis';
import { normalizeInteractionEntries } from '../services/inventory';
import { createInteractionParser, INTERACTION_SCAN_CHARACTER_LIMIT, INTERACTION_SCAN_REFERENCE_LIMIT } from '../services/interactiveSources';
import { attachReviewEvidence, configurationFingerprint, parseReviewBaseline } from '../services/reviewEvidence';
import { buildInUseReport } from '../services/inUseContent';
import { analyzeRemovalImpact } from '../services/removalImpact';
import { buildDependencyIndex, buildGraphModel, GRAPH_NODE_BUDGET } from '../services/dependencyGraph';
import { buildCoverageResolver } from '../services/dependencyCoverage';
import { ContentObject } from '../types';
import { now, object, review, snapshot } from './milestoneFixtures';

jest.mock('@splunk/splunk-utils/config', () => ({ username: 'operator', splunkdPath: '/splunkd' }));
jest.mock('@splunk/splunk-utils/fetch', () => ({ createFetchInit: (init: RequestInit) => init }));
jest.mock('@splunk/splunk-utils/url', () => ({ createRESTURL: (path: string) => `/services/${path}` }));
const definition = (id: 'navigation' | 'workflow_actions') => ({ id, label: id, endpoint: id === 'navigation' ? 'data/ui/nav' : 'data/ui/workflow-actions', objectType: id === 'navigation' ? 'Navigation Menu' : 'Workflow Action' });
const acl = (app = 'example', sharing = 'app') => ({ app, sharing, owner: 'reviewer', perms: { read: ['user'], write: ['admin'] } });
const item = (name: string, type: string, app = 'example', sharing = 'app'): ContentObject => ({ ...object(`${type}::${app}::${name}`, type), name, canonicalName: name, app, sharing,
    configurationFingerprint: configurationFingerprint({ name, disabled: false }, acl(app, sharing)) });
const complete: AnalysisCompleteness = { apps: true, dashboards: true, macros: true, lookup_definitions: true, lookup_files: true, saved_searches: true, data_models: true, indexes: true, sourcetypes: true };
const source = (center: ContentObject, text: string): RawAnalysisSource => ({ objectId: center.objectId, kind: center.objectType === 'Navigation Menu' ? 'navigation' : 'workflow_action', text, contextApp: center.app, sourceLocation: 'declared-metadata' });
const workflow = (changes: Record<string, unknown>) => JSON.stringify({ label: 'Investigate', type: 'search', disabled: false, ...changes });

test('normalization retains exact shared interaction identities, state and fingerprints, never raw definitions', () => {
    const inputs = [{ name: 'default', acl: acl(), content: { disabled: 'False', 'eai:data': '<nav><a href="/app/example/View?secret=synthetic-private-value">Open</a></nav>' } }];
    const nav = normalizeInteractionEntries(inputs, definition('navigation'), 'scan', '2026-10-27T12:00:00Z');
    expect(nav.records).toHaveLength(1); expect(nav.records[0]).toMatchObject({ object_type: 'Navigation Menu', name: 'default', app: 'example', enabled: true });
    expect(nav.sources[0]).toMatchObject({ kind: 'navigation', contextApp: 'example', text: inputs[0].content['eai:data'] });
    expect(JSON.stringify(nav.records)).not.toMatch(/synthetic-private-value|<nav>|href=/);
    const actions = normalizeInteractionEntries([{ name: 'Action', acl: acl(), content: { type: 'link', label: 'Investigate', disabled: 'True', 'link.uri': 'https://outside.example/private-value' } }], definition('workflow_actions'), 'scan', 'now');
    expect(actions.records[0].enabled).toBe(false);
    expect(JSON.stringify(actions.records)).not.toContain('private-value');
});

test.each(['user', 'system', 'unknown'])('unsupported %s visibility cannot leak identities or raw content into shared normalization', sharing => {
    const result = normalizeInteractionEntries([{ name: 'private-sensitive-name', acl: acl('private-sensitive-app', sharing), content: { 'eai:data': 'private-sensitive-body' } }], definition('navigation'), 'scan', 'now');
    expect(result.records).toEqual([]); expect(result.sources).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('private-sensitive');
});

test('duplicate native identities are omitted, not silently replaced', () => {
    const first = { name: 'default', acl: acl(), content: { disabled: false, 'eai:data': '<nav><view name="First"/></nav>' } };
    const other = { ...first, content: { disabled: false, 'eai:data': '<nav><view name="Second"/></nav>' } };
    const result = normalizeInteractionEntries([first, other, first], definition('navigation'), 'scan', 'now');
    expect(result.records).toEqual([]); expect(result.inventoryComplete).toBe(false); expect(result.complete).toBe(false);
});

test('exact namespace links cannot bind an exported same-name view in another app', () => {
    const nav = item('default', 'Navigation Menu'); const local = item('View', 'Dashboard');
    const exported = item('View', 'Dashboard', 'other', 'global');
    const result = analyzeInventory([nav, local, exported], [source(nav, '<nav><view name="View"/></nav>')], complete);
    expect(result.edges.find(row => row.relation === 'navigates_to')).toMatchObject({ targetId: local.objectId, resolved: true });
    const absent = analyzeInventory([nav, exported], [source(nav, '<nav><view name="View"/></nav>')], complete);
    expect(absent.edges.find(row => row.relation === 'navigates_to')).toMatchObject({ resolved: false, confidence: 'unknown' });
    expect(absent.findings.some(row => row.findingType === 'repair_required')).toBe(false);
});

test('an explicit cross-app route and its app namespace stay distinct from owning-app names', () => {
    const nav = item('default', 'Navigation Menu'); const own = item('Same', 'Dashboard');
    const target = item('Same', 'Dashboard', 'Target'); const app = item('Target', 'App', 'Target');
    const result = analyzeInventory([nav, own, target, app], [source(nav, '<nav><a href="/app/Target/Same">Go</a></nav>')], complete);
    expect(result.edges.filter(row => row.sourceId === nav.objectId).map(row => row.targetId).sort()).toEqual([app.objectId, target.objectId].sort());
});

test('private shadows, duplicates and system-only built-ins remain unknown rather than broken', () => {
    const nav = item('default', 'Navigation Menu'); const view = item('View', 'Dashboard');
    [[view, { ...view, objectId: 'duplicate' }], [{ ...view, sharing: 'system' }]].forEach(values => {
        const result = analyzeInventory([nav, ...values], [source(nav, '<nav><view name="View"/></nav>')], complete);
        expect(result.edges.find(row => row.relation === 'navigates_to')?.confidence).toBe('unknown');
        expect(result.findings.some(row => row.findingType === 'repair_required')).toBe(false);
    });
    const hidden = analyzeInventory([nav, view], [source(nav, '<nav><view name="View"/></nav>')], complete, undefined,
        { privateObjects: [{ collector: 'dashboards', app: 'example', count: 1 }], privateTargets: [{ collector: 'dashboards', app: 'example', name: 'View' }] });
    expect(hidden.edges.find(row => row.relation === 'navigates_to')?.resolved).toBe(false);
});

test('a runtime-inherited workflow cannot acquire owning-app search or event-type bindings', () => {
    const action = item('Inspect', 'Workflow Action', 'example', 'global');
    const report = item('Report', 'Saved Search'); const event = item('Classification', 'Event Type');
    const result = analyzeInventory([action, report, event], [source(action, workflow({ 'search.search_string': 'eventtype=Classification | savedsearch Report' }))], { ...complete, event_types: true });
    expect(result.edges.filter(row => row.sourceId === action.objectId).every(row => !row.resolved && row.confidence === 'unknown')).toBe(true);
    expect(result.coverageGaps.some(row => row.invocationNamespaceUnverified)).toBe(true);
});

test('explicit workflow search namespace binds normal static references in that app, not the declaration app', () => {
    const action = item('Inspect', 'Workflow Action', 'owner', 'global');
    const own = item('Report', 'Saved Search', 'owner'); const target = item('Report', 'Saved Search', 'Run');
    const result = analyzeInventory([action, own, target, item('Run', 'App', 'Run')], [source(action, workflow({ 'search.app': 'Run', 'search.search_string': '| savedsearch Report' }))], complete);
    expect(result.edges.find(row => row.relation === 'invokes')).toMatchObject({ targetId: target.objectId, resolved: true });
});

test('static workflow missing targets never become falsely broken shared-content assertions', () => {
    const action = item('Inspect', 'Workflow Action');
    const result = analyzeInventory([action], [source(action, workflow({ 'search.app': 'example', 'search.search_string': '| savedsearch Missing' }))], complete);
    expect(result.edges.filter(row => row.sourceId === action.objectId).every(row => !row.resolved && row.confidence === 'unknown')).toBe(true);
    expect(result.findings.some(row => row.findingType === 'repair_required')).toBe(false);
});

test('configured navigation reaches existing investigations/reports with distinct reasons and no observed activity', () => {
    const nav = item('default', 'Navigation Menu'); const view = item('Overview', 'Dashboard'); const report = item('Weekly Report', 'Report');
    const analysis = analyzeInventory([nav, view, report], [source(nav, '<nav><view name="Overview"/><saved name="Weekly Report"/></nav>')], complete);
    const data = snapshot(analysis.objects, analysis.edges);
    const required = buildInUseReport(data, [], { activity: 'none', includeRetained: false, successfulOnly: false, selectedIds: [nav.objectId] }, now);
    expect(required.rows.map(row => row.objectId).sort()).toEqual([nav.objectId, view.objectId, report.objectId].sort());
    expect(required.coverage).toBe('partial'); expect(required.rows.every(row => row.usage === null)).toBe(true);
    expect(required.gaps.join(' ')).toMatch(/configured interactions are not observed activity/);
    const impact = analyzeRemovalImpact(view, data.objects, data.edges, [], data.scan, 3, now);
    expect(impact.affectedObjects.map(row => row.objectId)).toContain(nav.objectId);
    expect(JSON.stringify(impact)).toMatch(/menu\/workflow destination/);
    const graph = buildGraphModel(view.objectId, buildDependencyIndex(data.objects, data.edges), data.edges.filter(row => row.targetId === view.objectId), { grouping: 'app', expandedGroups: new Map(), expandedNodes: new Set() });
    expect(graph.nodes.length).toBeLessThanOrEqual(GRAPH_NODE_BUDGET);
});

test('old v4 decisions and captured evidence remain readable, never migrated to v5 implicitly', async () => {
    const target = item('Target', 'Macro'); const app = item('example', 'App');
    const collectors = Object.fromEntries(['apps', 'saved_searches', 'dashboards', 'macros', 'data_models', 'event_types', 'workflow_actions', 'navigation'].map(name => [name, true]));
    const objects = await attachReviewEvidence([target, app], [], { scanId: 'scan-fixture', observedAt: new Date(now).toISOString(), principal: 'operator', roles: ['operator'], mode: 'full', collectionComplete: true, analysisComplete: true, collectors, coverageContext: { collectors, gaps: [], privateObjects: [], identityKnown: true } });
    const baseline = JSON.parse(JSON.stringify(objects[0].reviewEvidence)); baseline.coverage.policy = 'shared-static-v4';
    const saved = review(target.objectId, { stage: 'confirmed_eligible', note: 'Original decision', evidenceBaseline: { capturedAt: new Date(now).toISOString(), capturedBy: 'reviewer', evidence: baseline } });
    const before = JSON.stringify(saved);
    expect(parseReviewBaseline(saved.evidenceBaseline)?.evidence.coverage?.policy).toBe('shared-static-v4');
    expect(objects[0].reviewEvidence?.coverage?.policy).toBe('shared-static-v9');
    expect(JSON.stringify(saved)).toBe(before);
});

test('report inbound coverage requires navigation, and literal app links never establish all callers', () => {
    const collectors = Object.fromEntries(['apps', 'saved_searches', 'dashboards', 'macros', 'data_models', 'event_types', 'workflow_actions'].map(name => [name, true]));
    const resolve = buildCoverageResolver({ collectors, gaps: [], privateObjects: [], identityKnown: true });
    expect(resolve(item('Report', 'Report'), [], true).inbound.reasons.join(' ')).toMatch(/catalogs are incomplete: navigation/);
    expect(resolve(item('example', 'App'), [], true).inbound.reasons.join(' ')).toMatch(/Runtime-inherited namespaces, custom launchers/);
});

test('uninterpreted route parameters cannot confine possible redirect consumers to one app', () => {
    const nav = item('default', 'Navigation Menu', 'origin');
    const target = item('downstream', 'Macro', 'elsewhere');
    const collectors = Object.fromEntries(['apps', 'saved_searches', 'dashboards', 'macros', 'data_models',
        'event_types', 'workflow_actions', 'navigation'].map(name => [name, true]));
    const analysis = analyzeInventory([nav, target], [source(nav,
        '<nav><a href="/app/origin/Forward?redirect=%2Fapp%2Felsewhere%2FView">Open</a></nav>')], complete);
    const coverage = buildCoverageResolver({ collectors, gaps: analysis.coverageGaps, privateObjects: [], identityKnown: true });
    expect(coverage(target, analysis.edges.filter(edge => edge.targetId === target.objectId), true).inbound.status).toBe('partial');
    expect(analysis.coverageGaps.some(gap => gap.message.startsWith('Link query/fragment') && gap.invocationNamespaceUnverified)).toBe(true);
});

test('whole-scan work budgets count duplicates/withheld references and stop with explicit gaps', () => {
    const parse = createInteractionParser(); const text = workflow({ 'search.app': 'example', 'search.search_string': '`duplicate` '.repeat(250) });
    let references = 0;
    for (let i = 0; i < INTERACTION_SCAN_REFERENCE_LIMIT / 250; i += 1) { references += parse('workflow_action', text, 'example', 'workflow').references.length; }
    expect(references).toBe(INTERACTION_SCAN_REFERENCE_LIMIT);
    const limited = parse('navigation', '<nav><view name="later"/></nav>', 'example', 'eai:data');
    expect(limited.references).toEqual([]); expect(limited.warnings.join(' ')).toMatch(/whole-scan budget/);
    const chars = createInteractionParser();
    chars('workflow_action', 'x'.repeat(INTERACTION_SCAN_CHARACTER_LIMIT), 'example', 'workflow');
    expect(chars('navigation', '<nav/>', 'example', 'nav').warnings.join(' ')).toMatch(/whole-scan budget/);
});

test('same-name views across a thousand apps resolve only through their exact indexed namespace', () => {
    const objects: ContentObject[] = []; const sources: RawAnalysisSource[] = [];
    for (let index = 0; index < 1000; index += 1) {
        const app = `app-${index}`; const nav = item('default', 'Navigation Menu', app); const view = item('Overview', 'Dashboard', app);
        objects.push(nav, view); sources.push(source(nav, '<nav><view name="Overview"/></nav>'));
    }
    const result = analyzeInventory(objects, sources, complete);
    const links = result.edges.filter(row => row.relation === 'navigates_to');
    expect(links).toHaveLength(1000); expect(links.every(row => row.resolved)).toBe(true);
    expect(links.every(row => row.sourceId.split('::')[1] === row.targetId.split('::')[1])).toBe(true);
});
