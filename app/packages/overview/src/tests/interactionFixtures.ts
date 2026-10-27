// Synthetic cross-view contracts only. Never imported by a production entry.
import { analyzeInventory, AnalysisCompleteness, RawAnalysisSource } from '../services/analysis';
import { attachReviewEvidence, configurationFingerprint } from '../services/reviewEvidence';
import { ContentObject, InventorySnapshot, ReviewRecord } from '../types';
import { now, object, review, snapshot } from './milestoneFixtures';

const collectors = Object.fromEntries(['apps', 'saved_searches', 'dashboards', 'macros', 'lookup_definitions',
    'lookup_files', 'automatic_lookups', 'event_types', 'tag_bindings', 'data_models', 'indexes', 'sourcetypes',
    'field_extractions', 'field_aliases', 'calculated_fields', 'field_transforms', 'workflow_actions', 'navigation'].map(name => [name, true]));
const item = (name: string, type: string): ContentObject => ({ ...object(`${type}::example::${name}`, type), name, canonicalName: name,
    configurationFingerprint: configurationFingerprint({ name, disabled: false }, { app: 'example', owner: 'reviewer', sharing: 'app',
        perms: { read: ['user'], write: ['admin'] } }) });

export async function interactionFixture(): Promise<{ data: InventorySnapshot; saved: ReviewRecord;
    nav: ContentObject; view: ContentObject; report: ContentObject; action: ContentObject }> {
    const nav = { ...item('default', 'Navigation Menu'), name: 'Primary navigation' };
    const view = item('Overview', 'Dashboard');
    const report = item('Weekly Report', 'Report');
    const action = item('Inspect', 'Workflow Action');
    const sources: RawAnalysisSource[] = [
        { objectId: nav.objectId, kind: 'navigation', contextApp: 'example', sourceLocation: 'eai:data',
            text: '<nav><view name="Overview"/><saved name="Weekly Report"/><view source="all"/></nav>' },
        { objectId: action.objectId, kind: 'workflow_action', contextApp: 'example', sourceLocation: 'workflow_actions.conf',
            text: JSON.stringify({ label: 'Inspect', type: 'search', disabled: false, 'search.app': 'example',
                'search.view': 'Overview', 'search.search_string': '| savedsearch "Weekly Report"' }) },
    ];
    const completeness: AnalysisCompleteness = { ...collectors, apps: true, dashboards: true, macros: true,
        lookup_definitions: true, lookup_files: true, saved_searches: true, data_models: true, indexes: true, sourcetypes: true };
    const analysis = analyzeInventory([nav, view, report, action, item('example', 'App')], sources, completeness);
    const enriched = await attachReviewEvidence(analysis.objects, analysis.edges, { scanId: 'scan-fixture',
        observedAt: new Date(now).toISOString(), principal: 'operator', roles: ['operator'], mode: 'full',
        collectionComplete: true, analysisComplete: false, collectors, coverageContext: {
            collectors, gaps: analysis.coverageGaps, privateObjects: [], identityKnown: true,
        } });
    const byId = new Map(enriched.map(value => [value.objectId, value]));
    const baseline = JSON.parse(JSON.stringify(byId.get(nav.objectId)!.reviewEvidence));
    baseline.coverage.policy = 'shared-static-v4';
    const saved = review(nav.objectId, { objectName: nav.name, canonicalName: nav.canonicalName, objectType: nav.objectType,
        stage: 'investigating', evidenceBaseline: { capturedAt: new Date(now).toISOString(), capturedBy: 'reviewer', evidence: baseline } });
    const data = snapshot(enriched, analysis.edges);
    data.scan = { ...data.scan, status: 'partial', analysisStatus: 'partial',
        collectorCounts: Object.fromEntries(Object.keys(collectors).map(key => [key, ['navigation', 'workflow_actions'].includes(key) ? 1 : 0])),
        collectorTotals: { navigation: 1, workflow_actions: 1 }, collectorNativeCounts: { navigation: 1, workflow_actions: 1 },
        collectorVersions: { dependency_analysis: '1.6.1', interaction_dependencies: '1.0.1', field_lineage: '1.2.0' } };
    return { data, saved, nav: byId.get(nav.objectId)!, view: byId.get(view.objectId)!, report: byId.get(report.objectId)!, action: byId.get(action.objectId)! };
}
