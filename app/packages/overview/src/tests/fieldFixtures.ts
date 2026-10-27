// Synthetic cross-view contracts only. Never imported by production code.
import { analyzeInventory, AnalysisCompleteness, RawAnalysisSource } from '../services/analysis';
import { decodeFieldLineage, FieldCatalog, fieldLineageFacts } from '../services/fieldLineage';
import { attachReviewEvidence, configurationFingerprint } from '../services/reviewEvidence';
import { ContentObject, InventorySnapshot, ReviewRecord } from '../types';
import { now, object, review, snapshot } from './milestoneFixtures';

export const fieldCompleteness: AnalysisCompleteness = { macros: true, lookup_definitions: true, lookup_files: true,
    automatic_lookups: true, saved_searches: true, data_models: true, indexes: true, sourcetypes: false,
    event_types: true, tag_bindings: true, field_extractions: true, field_aliases: true, calculated_fields: true, field_transforms: true };
export function field(catalog: FieldCatalog, attribute: string, value: string, app = 'example', sharing = 'app', stanza = 'example:events', native: Record<string, unknown> = {}) {
    const acl = { app, sharing, owner: 'reviewer', perms: { read: ['user'], write: ['admin'] } };
    const type = { field_extractions: attribute.startsWith('REPORT-') ? 'Uses transform' : 'Inline', field_aliases: 'FIELDALIAS', calculated_fields: 'EVAL', field_transforms: 'transform' }[catalog];
    const content = catalog === 'field_transforms' ? { SOURCE_KEY: '_raw', REGEX: '(.*?)', FORMAT: value, disabled: '0', ...native }
        : { stanza, attribute, type, value, 'field.name': attribute.slice(5), ...native };
    const entry = { name: catalog === 'field_transforms' ? attribute : `${stanza} : ${attribute}`, acl, content };
    const decoded = decodeFieldLineage(entry, catalog); const facts = fieldLineageFacts(decoded.records[0], decoded.issues);
    const item: ContentObject = { ...object(entry.name, decoded.records[0].objectType),
        objectId: `${decoded.records[0].objectType}::${app}::${entry.name}`, app, sharing, canonicalName: entry.name,
        enabled: facts.enabled, fieldLineage: facts, configurationFingerprint: configurationFingerprint(content, acl, catalog) };
    const source: RawAnalysisSource = { objectId: item.objectId, kind: 'field_lineage', text: '', sourceLocation: facts.sourceLocation, fieldLineage: facts };
    return { item, source, entry };
}

export async function fieldInvestigationFixture(mode: 'format' | 'named_transform' | 'inline' = 'format'): Promise<{ data: InventorySnapshot; saved: ReviewRecord;
    transform: ContentObject; extraction: ContentObject; alias: ContentObject; calculated: ContentObject }> {
    const transform = field('field_transforms', 'extract_actor', mode === 'named_transform' ? '' : 'actor::$1', 'example', 'app', 'example:events',
        { REGEX: mode === 'named_transform' ? '(?<actor>synthetic-pattern)' : '(.*?)' });
    const extraction = field('field_extractions', mode === 'inline' ? 'EXTRACT-actor' : 'REPORT-actor',
        mode === 'inline' ? '(?<actor>synthetic-pattern)' : 'extract_actor extract_actor');
    const alias = field('field_aliases', 'FIELDALIAS-actor', 'actor ASNEW principal');
    const calculated = field('calculated_fields', 'EVAL-normalized', 'lower(principal)');
    const definitions = [transform, extraction, alias, calculated];
    const parent = { ...object('example', 'App'), configurationFingerprint: configurationFingerprint({}, { app: 'example', sharing: 'app', owner: 'reviewer', perms: { read: ['user'], write: ['admin'] } }) };
    const analysis = analyzeInventory([...definitions.map(row => row.item), parent], definitions.map(row => row.source), fieldCompleteness);
    const collectors = Object.fromEntries(['apps', 'saved_searches', 'dashboards', 'macros', 'lookup_definitions', 'lookup_files', 'automatic_lookups',
        'event_types', 'tag_bindings', 'data_models', 'indexes', 'sourcetypes', 'field_extractions', 'field_aliases', 'calculated_fields', 'field_transforms', 'workflow_actions', 'navigation'].map(name => [name, true]));
    const objects = await attachReviewEvidence(analysis.objects, analysis.edges, { scanId: 'scan-fixture', observedAt: new Date(now).toISOString(),
        principal: 'operator', roles: ['operator'], mode: 'full', collectionComplete: true, analysisComplete: false, collectors,
        coverageContext: { gaps: analysis.coverageGaps, privateObjects: [], identityKnown: true, collectors } });
    const byId = new Map(objects.map(item => [item.objectId, item]));
    const current = byId.get(calculated.item.objectId)!;
    const baseline = JSON.parse(JSON.stringify(current.reviewEvidence)); baseline.coverage.policy = 'shared-static-v2';
    const saved = review(current.objectId, { objectName: current.name, canonicalName: current.canonicalName, objectType: current.objectType,
        evidenceBaseline: { capturedAt: new Date(now).toISOString(), capturedBy: 'reviewer', evidence: baseline } });
    const data = snapshot(objects, analysis.edges);
    data.scan = { ...data.scan, analysisStatus: 'partial', collectorCounts: Object.fromEntries(Object.keys(collectors).map(id => [id, 0])) };
    ['apps', 'field_extractions', 'field_aliases', 'calculated_fields', 'field_transforms'].forEach(id => { data.scan.collectorCounts[id] = 1; });
    data.scan.collectorTotals = { ...data.scan.collectorCounts }; data.scan.collectorNativeCounts = { ...data.scan.collectorCounts };
    return { data, saved, transform: byId.get(transform.item.objectId)!, extraction: byId.get(extraction.item.objectId)!,
        alias: byId.get(alias.item.objectId)!, calculated: current };
}
