// Synthetic cross-view contracts only. Never imported by a production entry.
import { analyzeInventory, AnalysisCompleteness, RawAnalysisSource } from '../services/analysis';
import { attachReviewEvidence, configurationFingerprint } from '../services/reviewEvidence';
import { ContentObject, InventorySnapshot, ReviewRecord } from '../types';
import { now, review, snapshot } from './milestoneFixtures';

const collectors = Object.fromEntries(['apps', 'saved_searches', 'dashboards', 'macros', 'lookup_definitions',
    'lookup_files', 'automatic_lookups', 'event_types', 'tag_bindings', 'data_models', 'indexes', 'sourcetypes', 'workflow_actions', 'navigation'].map(name => [name, true]));
const complete: AnalysisCompleteness = { macros: true, lookup_definitions: true, lookup_files: true,
    automatic_lookups: true, saved_searches: true, data_models: true, indexes: true, sourcetypes: false,
    event_types: true, tag_bindings: true };
function object(name: string, type: string, app = 'example', sharing = 'app'): ContentObject {
    return { objectId: `${type}::${app}::${name}`, canonicalName: name, name, objectType: type, app, sharing,
        owner: 'reviewer', enabled: true, scheduled: false, updated: null, lastUsed: null, usageEvidence: null,
        healthStatus: 'unknown', abandonmentConfidence: null, removalImpact: null, inboundReferences: 0,
        outboundReferences: 0, protected: false, evidence: [], suggestedAction: 'Investigate',
        configurationFingerprint: configurationFingerprint({ name, disabled: '0' }, { app, owner: 'reviewer', sharing,
            perms: { read: ['user'], write: ['admin'] } }),
    };
}
export async function knowledgeFixture(): Promise<{ data: InventorySnapshot; saved: ReviewRecord;
    root: ContentObject; tag: ContentObject; event: ContentObject; macro: ContentObject }> {
    const root = object('Example Search', 'Saved Search');
    const tag = { ...object(JSON.stringify(['eventtype=ExampleClassification', 'exampleTag']), 'Tag Binding', 'definitions', 'global'),
        name: 'exampleTag · eventtype=ExampleClassification' };
    const event = object('ExampleClassification', 'Event Type');
    const inactiveTag = { ...object(JSON.stringify(['eventtype=ExampleClassification', 'otherTag']), 'Tag Binding', 'definitions', 'global'),
        name: 'otherTag · eventtype=ExampleClassification', enabled: false };
    const alternative = object('ExampleClassification', 'Event Type', 'definitions');
    const macro = object('example_base', 'Macro');
    const index = object('main', 'Index', 'example', 'global');
    const objects = [root, tag, inactiveTag, event, alternative, macro, index, object('example', 'App'), object('definitions', 'App', 'definitions')];
    const sources: RawAnalysisSource[] = [
        { objectId: root.objectId, kind: 'spl', text: 'index=main NOT tag::eventtype=exampleTag', sourceLocation: 'search' },
        { objectId: tag.objectId, kind: 'tag_binding', text: JSON.stringify({ field: 'eventtype', tag: 'exampleTag',
            literalFieldValue: 'ExampleClassification', enabled: true }), sourceLocation: 'tags.conf["eventtype=ExampleClassification"]["exampleTag"]' },
        { objectId: inactiveTag.objectId, kind: 'tag_binding', text: JSON.stringify({ field: 'eventtype', tag: 'otherTag',
            literalFieldValue: 'ExampleClassification', enabled: false }), sourceLocation: 'tags.conf["eventtype=ExampleClassification"]["otherTag"]' },
        { objectId: event.objectId, kind: 'event_type', text: 'index=main `example_base`', sourceLocation: 'eventtypes.conf["ExampleClassification"].search' },
        { objectId: alternative.objectId, kind: 'event_type', text: 'index=main', sourceLocation: 'eventtypes.conf["ExampleClassification"].search' },
        { objectId: macro.objectId, kind: 'spl', text: 'index=main', sourceLocation: 'definition' },
    ];
    const analysis = analyzeInventory(objects, sources, complete);
    const enriched = await attachReviewEvidence(analysis.objects, analysis.edges, { scanId: 'scan-fixture',
        observedAt: new Date(now).toISOString(), principal: 'operator', roles: ['operator'], mode: 'full',
        collectionComplete: true, analysisComplete: false, collectors, coverageContext: {
            collectors, gaps: analysis.coverageGaps, identityKnown: true, privateObjects: [],
        } });
    const byId = new Map(enriched.map(item => [item.objectId, item]));
    const currentMacro = byId.get(macro.objectId)!;
    const baseline = JSON.parse(JSON.stringify(currentMacro.reviewEvidence));
    baseline.coverage.policy = 'shared-static-v1';
    const saved = review(macro.objectId, { objectName: macro.name, canonicalName: macro.canonicalName,
        evidenceBaseline: { capturedAt: new Date(now).toISOString(), capturedBy: 'reviewer', evidence: baseline } });
    const data = snapshot(enriched, analysis.edges);
    data.scan = { ...data.scan, status: 'partial', analysisStatus: 'partial',
        collectorCounts: Object.fromEntries(Object.keys(collectors).map(key => [key, 0])),
        collectorTotals: { event_types: 2, tag_bindings: 1 }, collectorNativeCounts: { event_types: 2, tag_bindings: 1 } };
    data.scan.collectorCounts.event_types = 2; data.scan.collectorCounts.tag_bindings = 2;
    return { data, saved, root: byId.get(root.objectId)!, tag: byId.get(tag.objectId)!,
        event: byId.get(event.objectId)!, macro: currentMacro };
}
