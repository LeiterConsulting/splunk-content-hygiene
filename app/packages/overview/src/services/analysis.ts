import { ContentFinding, ContentObject, DependencyEdge, FieldLineageFacts, FindingType } from '../types';
import {
    ParsedReference,
    ReferenceTarget,
    ParsedSource,
    parseDashboard,
    parseSpl,
    parseDataModel,
    parseEventType,
} from './dependencyParser';
import { PrivateObjectCount, SourceCoverageGap } from './dependencyCoverage';
import { buildAutomaticLookupMatcher, parseAutomaticLookup } from './automaticLookups';
import { isPotentialRelation, weakestDependencyConfidence } from '../utils/dependencySemantics';
import { buildKnowledgeReferenceMatcher, parseTagBinding } from './knowledgeReferences';
import { buildFieldDependencyMatcher, FIELD_TARGETS } from './fieldDependencies';

export { extractSplReferences, extractDashboardReferences } from './dependencyParser';
export type { ParsedReference } from './dependencyParser';

export interface RawAnalysisSource {
    objectId: string;
    kind: 'spl' | 'dashboard' | 'lookup' | 'data_model' | 'automatic_lookup' | 'event_type' | 'tag_binding' | 'field_lineage';
    text: string;
    sourceLocation: string;
    failure?: string;
    failureTargets?: ReferenceTarget[] | 'all';
    fieldLineage?: FieldLineageFacts;
}
export interface AnalysisCompleteness {
    macros: boolean;
    lookup_definitions: boolean;
    lookup_files: boolean;
    saved_searches: boolean;
    data_models: boolean;
    indexes: boolean;
    sourcetypes: boolean;
    automatic_lookups?: boolean;
    event_types?: boolean;
    tag_bindings?: boolean;
    field_extractions?: boolean;
    field_aliases?: boolean;
    calculated_fields?: boolean;
    field_transforms?: boolean;
}
export interface InventoryAnalysis {
    objects: ContentObject[];
    edges: DependencyEdge[];
    findings: ContentFinding[];
    parserCounts: Record<string, number>;
    parserWarnings: string[];
    coverageGaps: SourceCoverageGap[];
}
export interface AnalysisVisibility {
    privateObjects: PrivateObjectCount[];
    privateTargets?: Array<{ collector: string; app: string; name: string }>;
    privateTargetGaps?: Array<{ collector: string; app: string }>;
}
interface Resolution {
    object: ContentObject | null;
    ambiguous: boolean;
}
interface ReferenceIndex { names: Map<string, ContentObject[]>; objects: Map<string, ContentObject> }

function objectGroup(objectType: string): ReferenceTarget | null {
    if (objectType === 'Macro') {
        return 'macro';
    }
    if (objectType === 'Lookup Definition') {
        return 'lookup';
    }
    if (objectType === 'Lookup File') {
        return 'lookup_file';
    }
    if (objectType === 'Saved Search' || objectType === 'Report' || objectType === 'Alert') {
        return 'saved_search';
    }
    if (objectType === 'Data Model') {
        return 'data_model';
    }
    if (objectType === 'Index') {
        return 'index';
    }
    if (objectType === 'Sourcetype') {
        return 'sourcetype';
    }
    if (objectType === 'Automatic Lookup') { return 'automatic_lookup'; }
    if (objectType === 'Event Type') { return 'event_type'; }
    if (objectType === 'Tag Binding') { return 'tag_binding'; }
    if (objectType === 'Field Extraction') { return 'field_extraction'; }
    if (objectType === 'Field Alias') { return 'field_alias'; }
    if (objectType === 'Calculated Field') { return 'calculated_field'; }
    if (objectType === 'Field Transform') { return 'field_transform'; }
    return null;
}

function referenceKey(type: ReferenceTarget, name: string, arity = 0): string {
    return type === 'macro'
        ? `macro::${name.replace(/\(\d+\)$/, '')}::${arity}`
        : `${type}::${name}`;
}

function buildReferenceIndex(objects: ContentObject[], byId: Map<string, ContentObject>): ReferenceIndex {
    const index = new Map<string, ContentObject[]>();
    objects.forEach((contentObject) => {
        const group = objectGroup(contentObject.objectType);
        if (!group) {
            return;
        }
        const arity = Number(contentObject.canonicalName.match(/\((\d+)\)$/)?.[1] ?? 0);
        const key = referenceKey(group, contentObject.canonicalName, arity);
        const matches = index.get(key) ?? [];
        matches.push(contentObject);
        index.set(key, matches);
    });
    return { names: index, objects: byId };
}

function resolveReference(
    reference: ParsedReference,
    source: ContentObject,
    index: ReferenceIndex,
): Resolution {
    if (reference.resolutionUncertain) { return { object: null, ambiguous: true }; }
    if (reference.targetType === 'tag_binding' && !reference.targetObjectId) {
        // Raw tag names must never collide with a JSON binding identity. Only
        // the bounded field/value matcher can select exact assignment objects.
        return { object: null, ambiguous: false };
    }
    if (source.objectType === 'Event Type' && source.sharing === 'global' && !reference.contextApp &&
        !['index', 'sourcetype'].includes(reference.targetType)) {
        return { object: null, ambiguous: true };
    }
    const app = reference.contextApp ?? source.app;
    if (reference.targetObjectId) {
        const target = index.objects.get(reference.targetObjectId);
        const visible = target && objectGroup(target.objectType) === reference.targetType &&
            ['app', 'global'].includes(target.sharing ?? '') && (target.app === app || target.sharing === 'global');
        return { object: visible ? target : null, ambiguous: !visible };
    }
    const primary =
        index.names.get(referenceKey(reference.targetType, reference.targetName, reference.macroArity)) ??
        [];
    // SPL accepts a CSV file or a same-named definition. Do not guess if both apply.
    const alternatives =
        reference.targetType === 'lookup_file' && reference.relation !== 'uses_file'
            ? (index.names.get(referenceKey('lookup', reference.targetName)) ?? [])
            : [];
    const candidates = [...primary, ...alternatives];
    const sameApp = candidates.filter((item) => item.app === app);
    const privateMatches = source.owner
        ? sameApp.filter((item) => item.sharing === 'user' && item.owner === source.owner)
        : [];
    const shared = sameApp.filter((item) => item.sharing === 'app' || item.sharing === 'global');
    const exported = candidates.filter(
        (item) =>
            item.sharing === 'global' ||
            (['index', 'sourcetype'].includes(reference.targetType) && item.sharing !== 'user'),
    );
    let applicable = exported;
    if (shared.length) {
        applicable = shared;
    }
    if (privateMatches.length) {
        applicable = privateMatches;
    }
    return {
        object: applicable.length === 1 ? applicable[0] : null,
        ambiguous: applicable.length > 1 || (applicable.length === 0 && candidates.length > 0),
    };
}

function parseSource(source: RawAnalysisSource): ParsedSource {
    if (source.failure) {
        return { references: [], warnings: [source.failure],
            gaps: [{ targets: source.failureTargets ?? 'all', message: source.failure, sourceLocation: source.sourceLocation }] };
    }
    if (source.kind === 'field_lineage') {
        return source.fieldLineage ? { references: [], warnings: [], gaps: [], fieldLineage: source.fieldLineage }
            : { references: [], warnings: ['Compact field metadata is unavailable.'],
                gaps: [{ targets: FIELD_TARGETS, message: 'Compact field metadata is unavailable.', sourceLocation: source.sourceLocation }] };
    }
    if (source.kind === 'automatic_lookup') { return parseAutomaticLookup(source.text, source.sourceLocation); }
    if (source.kind === 'event_type') { return parseEventType(source.text, source.sourceLocation); }
    if (source.kind === 'tag_binding') { return parseTagBinding(source.text, source.sourceLocation); }
    if (source.kind === 'data_model') { return parseDataModel(source.text, source.sourceLocation); }
    if (source.kind === 'lookup') {
        return {
            warnings: [],
            references: [
                {
                    targetType: 'lookup_file',
                    targetName: source.text,
                    relation: 'uses_file',
                    confidence: 'high',
                    evidence: `Lookup definition explicitly names backing file ${source.text}`,
                    sourceLocation: source.sourceLocation,
                },
            ],
        };
    }
    return source.kind === 'dashboard'
        ? parseDashboard(source.text, source.sourceLocation)
        : parseSpl(source.text, source.sourceLocation);
}

function targetCoverageComplete(
    targetType: ReferenceTarget,
    completeness: AnalysisCompleteness,
): boolean {
    if (targetType === 'lookup') {
        return completeness.lookup_definitions;
    }
    if (targetType === 'lookup_file') {
        return completeness.lookup_files;
    }
    const collectorByTarget: Record<
        Exclude<ReferenceTarget, 'lookup' | 'lookup_file'>,
        keyof AnalysisCompleteness
    > = {
        macro: 'macros',
        saved_search: 'saved_searches',
        data_model: 'data_models',
        index: 'indexes',
        sourcetype: 'sourcetypes',
        automatic_lookup: 'automatic_lookups',
        event_type: 'event_types',
        tag_binding: 'tag_bindings',
        field_extraction: 'field_extractions', field_alias: 'field_aliases',
        calculated_field: 'calculated_fields', field_transform: 'field_transforms',
    };
    return completeness[collectorByTarget[targetType]] === true;
}

function missingTargetId(targetType: ReferenceTarget, app: string, targetName: string): string {
    return `missing::${targetType}::${app}::${targetName.trim()}`;
}

function clampScore(value: number, maximum = 100): number {
    return Math.max(0, Math.min(maximum, Math.round(value)));
}

function daysSince(value: string | null): number | null {
    if (!value) {
        return null;
    }
    const timestamp = new Date(value).getTime();
    if (Number.isNaN(timestamp)) {
        return null;
    }
    return Math.floor((Date.now() - timestamp) / 86400000);
}

function ownerIsMissing(contentObject: ContentObject): boolean {
    return contentObject.owner === null && contentObject.sharing === 'user';
}

function uniqueEvidence(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
}

function finding(
    objectId: string,
    findingType: FindingType,
    abandonmentConfidence: number | null,
    removalImpact: number | null,
    reasons: string[],
    suggestedAction: string,
): ContentFinding {
    return {
        findingId: `finding::${objectId}::${findingType}`,
        objectId,
        findingType,
        abandonmentConfidence,
        removalImpact,
        reasons: uniqueEvidence(reasons),
        suggestedAction,
        createdAt: new Date().toISOString(),
    };
}

export function analyzeInventory(
    inputObjects: ContentObject[],
    sources: RawAnalysisSource[],
    completeness: AnalysisCompleteness,
    parsedSources?: Map<RawAnalysisSource, ParsedSource>,
    visibility?: AnalysisVisibility,
): InventoryAnalysis {
    const objects = inputObjects.map((contentObject) => ({
        ...contentObject,
        evidence: [...contentObject.evidence],
    }));
    const objectById = new Map(
        objects.map((contentObject) => [contentObject.objectId, contentObject]),
    );
    const referenceIndex = buildReferenceIndex(objects, objectById);
    const parserWarnings: string[] = [];
    const edgeByKey = new Map<string, DependencyEdge>();
    const assertedMissingBySource = new Map<string, string[]>();
    const dynamicSources = new Set<string>();
    const coverageGaps: SourceCoverageGap[] = [];
    const privateNameKey = (collector: string, app: string, name: string, arity = 0): string =>
        `${collector}\0${app}\0${collector === 'macros' ? `${name.replace(/\(\d+\)$/, '')}::${name.match(/\((\d+)\)$/)?.[1] ?? arity}` : name}`;
    const privateNames = new Set(visibility?.privateTargets?.map((row) => privateNameKey(row.collector, row.app, row.name)) ?? []);
    const privateCounts = new Map(visibility?.privateObjects.map((row) => [`${row.collector}\0${row.app}`, row.count]) ?? []);
    const privateAnyNames = new Set(visibility?.privateTargets?.map((row) => `${row.collector}\0${row.name}`) ?? []);
    const privateAnyCollectors = new Set(visibility?.privateObjects.filter((row) => row.count > 0).map((row) => row.collector) ?? []);
    const privateTargetGaps = new Set(visibility?.privateTargetGaps?.map(row => `${row.collector}\0${row.app}`) ?? []);
    const privateTargetGapCollectors = new Set(visibility?.privateTargetGaps?.map(row => row.collector) ?? []);
    const collectorByTarget: Record<ReferenceTarget, string> = {
        macro: 'macros', lookup: 'lookup_definitions', lookup_file: 'lookup_files', saved_search: 'saved_searches',
        data_model: 'data_models', index: 'indexes', sourcetype: 'sourcetypes', automatic_lookup: 'automatic_lookups',
        event_type: 'event_types', tag_binding: 'tag_bindings',
        field_extraction: 'field_extractions', field_alias: 'field_aliases',
        calculated_field: 'calculated_fields', field_transform: 'field_transforms',
    };
    const sourceParses = parsedSources ?? new Map<RawAnalysisSource, ParsedSource>();
    sources.forEach((source) => { if (!sourceParses.has(source)) { sourceParses.set(source, parseSource(source)); } });
    const automaticRules = sources.flatMap((source) => {
        const object = objectById.get(source.objectId); const rule = sourceParses.get(source)?.automaticLookup;
        if (object && rule) {
            const facts: FieldLineageFacts = { version: 1, operation: 'lookup', stanza: rule.stanza, attribute: rule.attribute,
                scope: { field: rule.scopeField, value: rule.scopeValue, exact: rule.exactScope }, enabled: object.enabled,
                inputs: rule.fieldInputs ?? [], outputs: [], aliases: [], transforms: [],
                syntax: rule.fieldInputsComplete ? 'declared' : 'unsupported', sourceLocation: source.sourceLocation,
                limitations: ['Only lookup event-input mappings are assessed; lookup outputs and later field-processing lineage are not inferred.',
                    ...(rule.fieldInputsComplete ? [] : ['Automatic lookup input mappings are outside the supported literal subset; field-input lineage is unverified.'])] };
            object.fieldLineage = facts;
            sourceParses.set(source, { ...sourceParses.get(source)!, fieldLineage: facts });
        }
        return object && rule ? [{ object, rule }] : [];
    });
    const automatic = buildAutomaticLookupMatcher(automaticRules, objects, {
        complete: completeness.automatic_lookups === true,
        privatePossible: visibility?.privateObjects.some((row) => row.collector === 'automatic_lookups' && row.count > 0) ?? false,
    });
    const knowledgeReferences = buildKnowledgeReferenceMatcher(objects, visibility);
    const fieldReferences = buildFieldDependencyMatcher(objects,
        [completeness.field_extractions, completeness.field_aliases, completeness.calculated_fields, completeness.field_transforms].every(value => value === true), visibility);
    const parserCounts: Record<string, number> = {
        spl: 0,
        dashboard: 0,
        unresolved: 0,
    };

    sources.forEach((source) => {
        const sourceObject = objectById.get(source.objectId);
        if (!sourceObject || (!source.text.trim() && !source.failure && !source.fieldLineage)) {
            return;
        }
        const original = sourceParses.get(source)!;
        const parsed = fieldReferences(sourceObject, knowledgeReferences(sourceObject, source.kind === 'automatic_lookup'
            ? automatic.bindings(sourceObject, original) : automatic.callers(sourceObject, original)));
        if (parsed.automaticLookup) {
            const rule = parsed.automaticLookup;
            sourceObject.evidence.push(`Search-time props rule: [${rule.stanza}] ${rule.attribute}; lookup definition ${rule.transform}.`,
                rule.exactScope ? 'Caller inference uses only positive exact event selectors; applicability is not proof of execution.' :
                    'This props scope uses a pattern not evaluated by the exact-selector matcher; caller coverage remains unverified.');
        }
        const { references } = parsed;
        const gaps = parsed.gaps ?? parsed.warnings.map((message) => ({ targets: 'all' as const, message, sourceLocation: source.sourceLocation }));
        const invocationNamespaceUnverified = ['Macro', 'Data Model', 'Event Type', 'Tag Binding', 'Field Extraction', 'Field Alias', 'Calculated Field', 'Field Transform', 'Automatic Lookup'].includes(sourceObject.objectType) && sourceObject.sharing === 'global';
        coverageGaps.push(...gaps.map((gap) => ({ ...gap, sourceId: source.objectId, app: sourceObject.app,
            ...(invocationNamespaceUnverified ? { invocationNamespaceUnverified: true } : {}) })));
        if (parsed.warnings.length) {
            dynamicSources.add(source.objectId);
            sourceObject.analysisWarnings = uniqueEvidence([
                ...(sourceObject.analysisWarnings ?? []),
                ...parsed.warnings,
            ]);
            parserWarnings.push(
                ...parsed.warnings.map((warning) => `${sourceObject.name}: ${warning}`),
            );
        }
        parserCounts[source.kind] = (parserCounts[source.kind] ?? 0) + references.length;

        references.forEach((reference) => {
            const resolution = resolveReference(reference, sourceObject, referenceIndex);
            const targetCollectors = [collectorByTarget[reference.targetType],
                ...(reference.targetType === 'lookup_file' && reference.relation !== 'uses_file' ? ['lookup_definitions'] : [])];
            const contextApp = reference.contextApp ?? sourceObject.app;
            const exportedAutomatic = sourceObject.objectType === 'Automatic Lookup' && sourceObject.sharing === 'global' && !reference.contextApp;
            // Absence in an exported rule's own app does not prove it is broken
            // when a different invoking app can supply the named definition.
            if (exportedAutomatic && !resolution.object) { resolution.ambiguous = true; }
            const privatePossible = targetCollectors.some((collector) => {
                if (privateTargetGaps.has(`${collector}\0${contextApp}`) || privateTargetGaps.has(`${collector}\0unknown`) ||
                    (exportedAutomatic && privateTargetGapCollectors.has(collector))) { return true; }
                if (visibility?.privateTargets) {
                    return exportedAutomatic ? privateAnyNames.has(`${collector}\0${reference.targetName}`)
                        : privateNames.has(privateNameKey(collector, contextApp, reference.targetName, reference.macroArity));
                }
                return exportedAutomatic ? privateAnyCollectors.has(collector)
                    : (privateCounts.get(`${collector}\0${contextApp}`) ?? 0) > 0;
            });
            if (privatePossible) { resolution.object = null; resolution.ambiguous = true; }
            const missingName = reference.targetType === 'tag_binding'
                ? `tag${reference.tagField ? `::${reference.tagField}` : ''}=${reference.targetName}` : reference.targetName;
            const targetId =
                resolution.object?.objectId ??
                missingTargetId(reference.targetType, contextApp, missingName);
            const resolved = Boolean(resolution.object);
            const coverageComplete =
                targetCoverageComplete(reference.targetType, completeness) &&
                (reference.targetType !== 'lookup_file' ||
                    reference.relation === 'uses_file' ||
                    completeness.lookup_definitions);
            const canAssertMissing = !resolved && !resolution.ambiguous && coverageComplete && !isPotentialRelation(reference.relation);
            if (resolution.ambiguous) {
                coverageGaps.push({ sourceId: source.objectId, app: sourceObject.app,
                    targets: reference.targetType === 'lookup_file' && reference.relation !== 'uses_file'
                        ? ['lookup_file', 'lookup'] : [reference.targetType],
                    targetName: reference.targetName, sourceLocation: reference.sourceLocation,
                    message: 'Namespace visibility or multiple candidates prevent deterministic target resolution.',
                    ...(invocationNamespaceUnverified ? { invocationNamespaceUnverified: true } : {}) });
            }
            let { confidence } = reference;
            if (resolution.ambiguous || (!resolved && (!coverageComplete || isPotentialRelation(reference.relation)))) {
                confidence = 'unknown';
            } else if (
                resolved &&
                resolution.object &&
                resolution.object.app !== contextApp &&
                resolution.object.sharing !== 'global'
            ) {
                confidence = 'low';
            }
            let { evidence } = reference;
            if (canAssertMissing) {
                evidence = `${evidence}; no matching target was found in the complete collector result`;
                const reasons = assertedMissingBySource.get(source.objectId) ?? [];
                reasons.push(evidence);
                assertedMissingBySource.set(source.objectId, reasons);
            } else if (!resolved && resolution.ambiguous) {
                evidence = `${evidence}; namespace visibility or multiple candidates prevent deterministic resolution`;
            } else if (!resolved) {
                evidence = `${evidence}; target inventory is incomplete or non-authoritative, so absence cannot be asserted`;
            }

            const edge: DependencyEdge = {
                edgeId: `edge::${source.objectId}::${reference.relation}::${targetId}`,
                sourceId: source.objectId,
                targetId,
                relation: reference.relation,
                confidence,
                evidence,
                sourceLocation: reference.sourceLocation,
                resolved,
                ...(reference.fieldProvenance ? { fieldProvenance: { ...reference.fieldProvenance,
                    fields: [...new Set(reference.fieldProvenance.fields)].sort(),
                    viaObjectIds: [...new Set(reference.fieldProvenance.viaObjectIds)].sort(),
                    contextApps: [...new Set(reference.fieldProvenance.contextApps)].sort() } } : {}),
            };
            const edgeKey = [edge.sourceId, edge.targetId, edge.relation].join('|');
            const previous = edgeByKey.get(edgeKey);
            if (previous) {
                edge.confidence = weakestDependencyConfidence(previous.confidence, edge.confidence);
                edge.evidence = uniqueEvidence([previous.evidence, edge.evidence]).join('; ');
                edge.sourceLocation = uniqueEvidence([
                    ...(previous.sourceLocation ?? '').split('; '),
                    edge.sourceLocation ?? '',
                ]).join('; ');
                if (previous.fieldProvenance && edge.fieldProvenance) {
                    const before = previous.fieldProvenance; const current = edge.fieldProvenance;
                    const declarations = [...new Map([...(before.outputDeclarations ?? []), ...(current.outputDeclarations ?? [])].map(item => [JSON.stringify(item), item])).values()];
                    if (declarations.length > 250) {
                        coverageGaps.push({ sourceId: source.objectId, app: sourceObject.app, targets: [reference.targetType], sourceLocation: reference.sourceLocation,
                            message: 'Merged output-declaration evidence reached its 250-position budget; additional positions remain unverified.' });
                    }
                    edge.fieldProvenance = { ...current,
                        fields: uniqueEvidence([...before.fields, ...current.fields]).sort().slice(0, 250),
                        transformPositions: [...new Set([...before.transformPositions, ...current.transformPositions])].sort((a, b) => a - b).slice(0, 250),
                        viaObjectIds: uniqueEvidence([...before.viaObjectIds, ...current.viaObjectIds]).sort().slice(0, 250),
                        contextApps: uniqueEvidence([...before.contextApps, ...current.contextApps]).sort().slice(0, 250),
                        ...((before.outputDeclarations || current.outputDeclarations) ? { outputDeclarations: declarations
                            .sort((a, b) => { const left = JSON.stringify(a); const right = JSON.stringify(b); if (left < right) { return -1; } return left > right ? 1 : 0; }).slice(0, 250) } : {}),
                        invocation: before.invocation === 'invoking_app_unverified' ? before.invocation : current.invocation };
                }
            }
            edgeByKey.set(edgeKey, edge);
            if (!resolved) {
                parserCounts.unresolved += 1;
            }
        });
    });

    const appByName = new Map(
        objects
            .filter((item) => item.objectType === 'App')
            .map((item) => [item.canonicalName, item]),
    );
    objects.forEach((contentObject) => {
        const app = appByName.get(contentObject.app);
        if (!app || contentObject.objectType === 'App') {
            return;
        }
        const edgeId = `edge::${contentObject.objectId}::belongs_to::${app.objectId}`;
        edgeByKey.set(edgeId, {
            edgeId,
            sourceId: contentObject.objectId,
            targetId: app.objectId,
            relation: 'belongs_to',
            confidence: 'high',
            resolved: true,
            evidence: `REST namespace places this object in app ${contentObject.app}`,
            sourceLocation: 'eai:acl.app',
        });
    });

    const edges = Array.from(edgeByKey.values());
    const inboundCounts = new Map<string, number>();
    const outboundCounts = new Map<string, number>();
    edges.forEach((edge) => {
        outboundCounts.set(edge.sourceId, (outboundCounts.get(edge.sourceId) ?? 0) + 1);
        if (edge.resolved) {
            inboundCounts.set(edge.targetId, (inboundCounts.get(edge.targetId) ?? 0) + 1);
        }
    });

    const findings: ContentFinding[] = [];
    objects.forEach((contentObject) => {
        const inbound = inboundCounts.get(contentObject.objectId) ?? 0;
        const outbound = outboundCounts.get(contentObject.objectId) ?? 0;
        const missingReasons = assertedMissingBySource.get(contentObject.objectId) ?? [];
        const missingOwner = ownerIsMissing(contentObject);
        const ageDays = daysSince(contentObject.updated);
        const scheduledAndEnabled =
            contentObject.scheduled === true && contentObject.enabled !== false;
        const evidence = [...contentObject.evidence];

        if (contentObject.enabled === false) {
            evidence.push('The source object is disabled');
        }
        if (scheduledAndEnabled) {
            evidence.push('An enabled schedule is configured');
        }
        if (inbound > 0) {
            evidence.push(`${inbound} inbound relationship${inbound === 1 ? '' : 's'} resolved`);
        } else {
            evidence.push(
                'No inbound relationships were produced by the supported parsers in this scan',
            );
        }
        if (outbound > 0) {
            evidence.push(`${outbound} outbound relationship${outbound === 1 ? '' : 's'} parsed`);
        }
        if (dynamicSources.has(contentObject.objectId)) {
            evidence.push(
                'Dependency extraction has declared limitations; inspect the source-specific diagnostics',
            );
        }
        evidence.push(...missingReasons);

        if (contentObject.protected) {
            Object.assign(contentObject, {
                inboundReferences: inbound,
                outboundReferences: outbound,
                healthStatus: 'protected',
                abandonmentConfidence: null,
                removalImpact: null,
                evidence: uniqueEvidence(evidence),
                suggestedAction: 'Protected from cleanup review',
            });
            return;
        }

        let abandonment = 0;
        if (contentObject.enabled === false) {
            abandonment += 10;
        }
        if (inbound === 0) {
            abandonment += 25;
        }
        if (!scheduledAndEnabled) {
            abandonment += 10;
        }
        if (missingOwner) {
            abandonment += 15;
        }
        if (ageDays !== null && ageDays >= 365) {
            abandonment += 10;
            evidence.push('The object was last modified at least 365 days ago');
        }
        if (ageDays !== null && ageDays <= 30) {
            abandonment -= 20;
            evidence.push('The object was modified within the last 30 days');
        }
        if (contentObject.sharing === 'global') {
            abandonment -= 10;
        }
        if (scheduledAndEnabled) {
            abandonment -= 30;
        }
        abandonment = clampScore(abandonment, 60);

        let impact =
            inbound * 8 +
            outbound * 3 +
            (scheduledAndEnabled ? 25 : 0) +
            (contentObject.sharing === 'global' ? 15 : 0) +
            (missingReasons.length > 0 ? 30 : 0);
        impact = clampScore(impact);

        let healthStatus: ContentObject['healthStatus'] = 'unknown';
        let suggestedAction = 'Collect usage evidence before making a cleanup decision';

        if (missingReasons.length > 0) {
            healthStatus = 'broken';
            suggestedAction =
                'Repair or confirm the explicit missing dependency before cleanup review';
            findings.push(
                finding(
                    contentObject.objectId,
                    'repair_required',
                    abandonment,
                    impact,
                    missingReasons,
                    suggestedAction,
                ),
            );
        } else if (scheduledAndEnabled) {
            healthStatus = 'active';
            suggestedAction = 'Keep and validate execution history during usage analysis';
        } else if (missingOwner) {
            healthStatus = 'unowned';
            suggestedAction = 'Assign an accountable reviewer before cleanup evaluation';
            findings.push(
                finding(
                    contentObject.objectId,
                    'unowned',
                    abandonment,
                    impact,
                    [
                        'No owner was recorded for this user-scoped object',
                        'Usage telemetry has not established recent use',
                    ],
                    suggestedAction,
                ),
            );
        } else if (contentObject.enabled === false && inbound === 0) {
            healthStatus = 'dormant';
            suggestedAction =
                'Request owner confirmation; absence of inbound references is not proof of safe removal';
            findings.push(
                finding(
                    contentObject.objectId,
                    'needs_review',
                    abandonment,
                    impact,
                    [
                        'The object is disabled',
                        'No inbound relationships were produced by supported parsers',
                        'Usage telemetry is unavailable, so confidence is capped',
                    ],
                    suggestedAction,
                ),
            );
        }

        Object.assign(contentObject, {
            inboundReferences: inbound,
            outboundReferences: outbound,
            healthStatus,
            abandonmentConfidence: abandonment,
            removalImpact: impact,
            evidence: uniqueEvidence(evidence),
            suggestedAction,
        });
    });

    return {
        objects,
        edges,
        findings,
        parserCounts,
        parserWarnings,
        coverageGaps,
    };
}

/** Parse large inventories cooperatively; the indexed resolution pass is linear. */
export async function analyzeInventoryAsync(
    objects: ContentObject[],
    sources: RawAnalysisSource[],
    completeness: AnalysisCompleteness,
    visibility?: AnalysisVisibility,
): Promise<InventoryAnalysis> {
    const parsed = new Map<RawAnalysisSource, ParsedSource>();
    for (let start = 0; start < sources.length; start += 40) {
        sources
            .slice(start, start + 40)
            .forEach((source) => parsed.set(source, parseSource(source)));
        // Yield between bounded parser batches so progress and navigation remain responsive.
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    }
    return analyzeInventory(objects, sources, completeness, parsed, visibility);
}
