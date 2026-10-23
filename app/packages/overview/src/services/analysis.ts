import { ContentFinding, ContentObject, DependencyEdge, FindingType } from '../types';
import {
    ParsedReference,
    ReferenceTarget,
    ParsedSource,
    parseDashboard,
    parseSpl,
    parseDataModel,
} from './dependencyParser';
import { PrivateObjectCount, SourceCoverageGap } from './dependencyCoverage';

export { extractSplReferences, extractDashboardReferences } from './dependencyParser';
export type { ParsedReference } from './dependencyParser';

export interface RawAnalysisSource {
    objectId: string;
    kind: 'spl' | 'dashboard' | 'lookup' | 'data_model';
    text: string;
    sourceLocation: string;
    failure?: string;
    failureTargets?: ReferenceTarget[] | 'all';
}
export interface AnalysisCompleteness {
    macros: boolean;
    lookup_definitions: boolean;
    lookup_files: boolean;
    saved_searches: boolean;
    data_models: boolean;
    indexes: boolean;
    sourcetypes: boolean;
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
}
interface Resolution {
    object: ContentObject | null;
    ambiguous: boolean;
}
type ReferenceIndex = Map<string, ContentObject[]>;

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
    return null;
}

function referenceKey(type: ReferenceTarget, name: string, arity = 0): string {
    return type === 'macro'
        ? `macro::${name.replace(/\(\d+\)$/, '')}::${arity}`
        : `${type}::${name}`;
}

function buildReferenceIndex(objects: ContentObject[]): ReferenceIndex {
    const index: ReferenceIndex = new Map();
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
    return index;
}

function resolveReference(
    reference: ParsedReference,
    source: ContentObject,
    index: ReferenceIndex,
): Resolution {
    const primary =
        index.get(referenceKey(reference.targetType, reference.targetName, reference.macroArity)) ??
        [];
    // SPL accepts a CSV file or a same-named definition. Do not guess if both apply.
    const alternatives =
        reference.targetType === 'lookup_file' && reference.relation !== 'uses_file'
            ? (index.get(referenceKey('lookup', reference.targetName)) ?? [])
            : [];
    const candidates = [...primary, ...alternatives];
    const sameApp = candidates.filter((item) => item.app === source.app);
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
    };
    return completeness[collectorByTarget[targetType]];
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
    const referenceIndex = buildReferenceIndex(objects);
    const parserWarnings: string[] = [];
    const edgeByKey = new Map<string, DependencyEdge>();
    const assertedMissingBySource = new Map<string, string[]>();
    const dynamicSources = new Set<string>();
    const coverageGaps: SourceCoverageGap[] = [];
    const privateNameKey = (collector: string, app: string, name: string, arity = 0): string =>
        `${collector}\0${app}\0${collector === 'macros' ? `${name.replace(/\(\d+\)$/, '')}::${name.match(/\((\d+)\)$/)?.[1] ?? arity}` : name}`;
    const privateNames = new Set(visibility?.privateTargets?.map((row) => privateNameKey(row.collector, row.app, row.name)) ?? []);
    const privateCounts = new Map(visibility?.privateObjects.map((row) => [`${row.collector}\0${row.app}`, row.count]) ?? []);
    const collectorByTarget: Record<ReferenceTarget, string> = {
        macro: 'macros', lookup: 'lookup_definitions', lookup_file: 'lookup_files', saved_search: 'saved_searches',
        data_model: 'data_models', index: 'indexes', sourcetype: 'sourcetypes',
    };
    const parserCounts: Record<string, number> = {
        spl: 0,
        dashboard: 0,
        unresolved: 0,
    };

    sources.forEach((source) => {
        const sourceObject = objectById.get(source.objectId);
        if (!sourceObject || (!source.text.trim() && !source.failure)) {
            return;
        }
        const parsed = parsedSources?.get(source) ?? parseSource(source);
        const { references } = parsed;
        const gaps = parsed.gaps ?? parsed.warnings.map((message) => ({ targets: 'all' as const, message, sourceLocation: source.sourceLocation }));
        coverageGaps.push(...gaps.map((gap) => ({ ...gap, sourceId: source.objectId, app: sourceObject.app })));
        if (parsed.warnings.length) {
            dynamicSources.add(source.objectId);
            sourceObject.analysisWarnings = [
                ...(sourceObject.analysisWarnings ?? []),
                ...parsed.warnings,
            ];
            parserWarnings.push(
                ...parsed.warnings.map((warning) => `${sourceObject.name}: ${warning}`),
            );
        }
        parserCounts[source.kind] = (parserCounts[source.kind] ?? 0) + references.length;

        references.forEach((reference) => {
            const resolution = resolveReference(reference, sourceObject, referenceIndex);
            const targetCollectors = [collectorByTarget[reference.targetType],
                ...(reference.targetType === 'lookup_file' && reference.relation !== 'uses_file' ? ['lookup_definitions'] : [])];
            const privatePossible = targetCollectors.some((collector) => visibility?.privateTargets
                ? privateNames.has(privateNameKey(collector, sourceObject.app, reference.targetName, reference.macroArity))
                : (privateCounts.get(`${collector}\0${sourceObject.app}`) ?? 0) > 0);
            if (privatePossible) { resolution.object = null; resolution.ambiguous = true; }
            const targetId =
                resolution.object?.objectId ??
                missingTargetId(reference.targetType, sourceObject.app, reference.targetName);
            const resolved = Boolean(resolution.object);
            const coverageComplete =
                targetCoverageComplete(reference.targetType, completeness) &&
                (reference.targetType !== 'lookup_file' ||
                    reference.relation === 'uses_file' ||
                    completeness.lookup_definitions);
            const canAssertMissing = !resolved && !resolution.ambiguous && coverageComplete;
            if (resolution.ambiguous) {
                coverageGaps.push({ sourceId: source.objectId, app: sourceObject.app,
                    targets: reference.targetType === 'lookup_file' && reference.relation !== 'uses_file'
                        ? ['lookup_file', 'lookup'] : [reference.targetType],
                    targetName: reference.targetName, sourceLocation: reference.sourceLocation,
                    message: 'Namespace visibility or multiple candidates prevent deterministic target resolution.' });
            }
            let { confidence } = reference;
            if (resolution.ambiguous || (!resolved && !coverageComplete)) {
                confidence = 'unknown';
            } else if (
                resolved &&
                resolution.object &&
                resolution.object.app !== sourceObject.app &&
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
            };
            const edgeKey = [edge.sourceId, edge.targetId, edge.relation].join('|');
            const previous = edgeByKey.get(edgeKey);
            if (previous) {
                edge.evidence = uniqueEvidence([previous.evidence, edge.evidence]).join('; ');
                edge.sourceLocation = uniqueEvidence([
                    ...(previous.sourceLocation ?? '').split('; '),
                    edge.sourceLocation ?? '',
                ]).join('; ');
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
