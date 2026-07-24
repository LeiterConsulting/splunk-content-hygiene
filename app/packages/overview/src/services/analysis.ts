import {
    ConfidenceLevel,
    ContentFinding,
    ContentObject,
    DependencyEdge,
    FindingType,
} from '../types';

type ReferenceTarget =
    | 'macro'
    | 'lookup'
    | 'saved_search'
    | 'data_model'
    | 'index'
    | 'sourcetype';

export interface ParsedReference {
    targetType: ReferenceTarget;
    targetName: string;
    relation: string;
    confidence: ConfidenceLevel;
    evidence: string;
    sourceLocation: string;
}

export interface RawAnalysisSource {
    objectId: string;
    kind: 'spl' | 'dashboard';
    text: string;
    sourceLocation: string;
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
}

interface Resolution {
    object: ContentObject | null;
    ambiguous: boolean;
}

const dynamicReferencePattern = /\$[^$]+\$|\{[^{}]+\}|\*/;

function normalizeText(value: string): string {
    return value
        .replace(/&quot;/gi, '"')
        .replace(/&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&')
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n');
}

function cleanTargetName(value: string): string {
    return value.trim().replace(/^["']|["']$/g, '').replace(/[;,]$/, '');
}

function quotedRanges(value: string): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    let quote: '"' | "'" | null = null;
    let start = -1;
    let escaped = false;

    for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if (escaped) {
            escaped = false;
        } else if (character === '\\') {
            escaped = true;
        } else if (quote) {
            if (character === quote) {
                ranges.push([start, index]);
                quote = null;
                start = -1;
            }
        } else if (character === '"' || character === "'") {
            quote = character;
            start = index;
        }
    }
    if (quote && start >= 0) {
        ranges.push([start, value.length]);
    }
    return ranges;
}

function isInsideQuotedRange(
    index: number,
    ranges: Array<[number, number]>
): boolean {
    let low = 0;
    let high = ranges.length - 1;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const [start, end] = ranges[middle];
        if (index < start) {
            high = middle - 1;
        } else if (index > end) {
            low = middle + 1;
        } else {
            return true;
        }
    }
    return false;
}

function addReference(
    references: ParsedReference[],
    seen: Set<string>,
    reference: ParsedReference
): void {
    const targetName = cleanTargetName(reference.targetName);
    if (!targetName || dynamicReferencePattern.test(targetName)) {
        return;
    }
    const normalized = {
        ...reference,
        targetName,
    };
    const key = [
        normalized.targetType,
        normalized.targetName.toLowerCase(),
        normalized.relation,
        normalized.sourceLocation,
    ].join('|');
    if (!seen.has(key)) {
        seen.add(key);
        references.push(normalized);
    }
}

/* eslint-disable no-cond-assign -- RegExp.exec loops retain capture groups without allocating intermediate match arrays. */
export function extractSplReferences(
    sourceText: string,
    sourceLocation = 'search'
): ParsedReference[] {
    const text = normalizeText(sourceText);
    const references: ParsedReference[] = [];
    const seen = new Set<string>();
    const stringRanges = quotedRanges(text);
    let match: RegExpExecArray | null;

    const macroPattern = /`([A-Za-z_][A-Za-z0-9_.:/-]*)(?:\([^`]*\))?`/g;
    while ((match = macroPattern.exec(text)) !== null) {
        addReference(references, seen, {
            targetType: 'macro',
            targetName: match[1],
            relation: 'uses',
            confidence: 'medium',
            evidence: `SPL invokes macro \`${match[1]}\``,
            sourceLocation,
        });
    }

    const lookupPattern =
        /(?:^|\|)\s*(inputlookup|outputlookup|lookup)\s+(?:(?:local|update|append|create_empty|override_if_empty|max|strict|allow_updates)\s*=\s*\S+\s+)*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.:/*${}-]+))/gi;
    while ((match = lookupPattern.exec(text)) !== null) {
        const command = match[1].toLowerCase();
        const targetName = match[2] ?? match[3] ?? match[4];
        addReference(references, seen, {
            targetType: 'lookup',
            targetName,
            relation: command === 'outputlookup' ? 'writes' : 'reads',
            confidence: 'medium',
            evidence: `SPL ${command} command names lookup ${targetName}`,
            sourceLocation,
        });
    }

    const savedSearchPattern =
        /(?:^|\|)\s*savedsearch\s+(?:"([^"]+)"|'([^']+)'|([^|\r\n]+?))(?=\s*(?:\||$))/gi;
    while ((match = savedSearchPattern.exec(text)) !== null) {
        const targetName = match[1] ?? match[2] ?? match[3];
        addReference(references, seen, {
            targetType: 'saved_search',
            targetName,
            relation: 'invokes',
            confidence: 'medium',
            evidence: `SPL savedsearch command names ${cleanTargetName(targetName)}`,
            sourceLocation,
        });
    }

    const dataModelCommandPattern =
        /(?:^|\|)\s*datamodel\s+(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.*${}:-]+))/gi;
    while ((match = dataModelCommandPattern.exec(text)) !== null) {
        const targetName = match[1] ?? match[2] ?? match[3];
        addReference(references, seen, {
            targetType: 'data_model',
            targetName,
            relation: 'uses',
            confidence: 'medium',
            evidence: `SPL datamodel command names ${targetName}`,
            sourceLocation,
        });
    }

    const fromDataModelPattern =
        /(?:^|\|)\s*from\s+datamodel\s*:\s*([A-Za-z0-9_.*${}:-]+)/gi;
    while ((match = fromDataModelPattern.exec(text)) !== null) {
        addReference(references, seen, {
            targetType: 'data_model',
            targetName: match[1],
            relation: 'uses',
            confidence: 'medium',
            evidence: `SPL from clause names data model ${match[1]}`,
            sourceLocation,
        });
    }

    const dataReferencePattern =
        /\b(index|sourcetype)\s*=\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.:/*${}-]+))/gi;
    while ((match = dataReferencePattern.exec(text)) !== null) {
        if (!isInsideQuotedRange(match.index, stringRanges)) {
            const targetType =
                match[1].toLowerCase() === 'index' ? 'index' : 'sourcetype';
            const targetName = match[2] ?? match[3] ?? match[4];
            addReference(references, seen, {
                targetType,
                targetName,
                relation: 'searches',
                confidence: 'medium',
                evidence: `SPL explicitly constrains ${targetType}=${targetName}`,
                sourceLocation,
            });
        }
    }

    return references;
}

function collectJsonDashboardContent(
    value: unknown,
    path: string,
    references: ParsedReference[],
    seen: Set<string>,
    inlineSearches: Array<{ text: string; path: string }>,
    depth = 0
): void {
    if (depth > 24 || value === null || value === undefined) {
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) =>
            collectJsonDashboardContent(
                item,
                `${path}[${index}]`,
                references,
                seen,
                inlineSearches,
                depth + 1
            )
        );
        return;
    }
    if (typeof value !== 'object') {
        return;
    }

    const record = value as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';
    const options =
        record.options &&
        typeof record.options === 'object' &&
        !Array.isArray(record.options)
            ? (record.options as Record<string, unknown>)
            : {};
    if (
        type.includes('savedsearch') &&
        typeof options.ref === 'string'
    ) {
        addReference(references, seen, {
            targetType: 'saved_search',
            targetName: options.ref,
            relation: 'references',
            confidence: 'high',
            evidence: `Dashboard data source explicitly references saved search ${options.ref}`,
            sourceLocation: `${path}.options.ref`,
        });
    }

    Object.entries(record).forEach(([key, child]) => {
        const childPath = path ? `${path}.${key}` : key;
        if (
            (key === 'query' || key === 'search') &&
            typeof child === 'string'
        ) {
            inlineSearches.push({ text: child, path: childPath });
        }
        collectJsonDashboardContent(
            child,
            childPath,
            references,
            seen,
            inlineSearches,
            depth + 1
        );
    });
}

export function extractDashboardReferences(
    sourceText: string,
    sourceLocation = 'dashboard'
): ParsedReference[] {
    const text = normalizeText(sourceText);
    const references: ParsedReference[] = [];
    const seen = new Set<string>();
    const inlineSearches: Array<{ text: string; path: string }> = [];
    let match: RegExpExecArray | null;

    const searchRefPattern = /<search\b[^>]*\bref=["']([^"']+)["'][^>]*>/gi;
    while ((match = searchRefPattern.exec(text)) !== null) {
        addReference(references, seen, {
            targetType: 'saved_search',
            targetName: match[1],
            relation: 'references',
            confidence: 'high',
            evidence: `Dashboard search element explicitly references saved search ${match[1]}`,
            sourceLocation: `${sourceLocation}.search.ref`,
        });
    }

    const savedSearchPattern = /<savedsearch>([^<]+)<\/savedsearch>/gi;
    while ((match = savedSearchPattern.exec(text)) !== null) {
        addReference(references, seen, {
            targetType: 'saved_search',
            targetName: match[1],
            relation: 'references',
            confidence: 'high',
            evidence: `Dashboard XML explicitly names saved search ${match[1]}`,
            sourceLocation: `${sourceLocation}.savedsearch`,
        });
    }

    const queryPattern = /<query>([\s\S]*?)<\/query>/gi;
    while ((match = queryPattern.exec(text)) !== null) {
        inlineSearches.push({
            text: match[1],
            path: `${sourceLocation}.query`,
        });
    }

    if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
        try {
            collectJsonDashboardContent(
                JSON.parse(text),
                sourceLocation,
                references,
                seen,
                inlineSearches
            );
        } catch {
            // Malformed dashboard JSON remains unparsed and is reflected in scan warnings.
        }
    }

    inlineSearches.forEach((inlineSearch) => {
        extractSplReferences(inlineSearch.text, inlineSearch.path).forEach(
            (reference) => addReference(references, seen, reference)
        );
    });

    return references;
}
/* eslint-enable no-cond-assign */

function objectGroup(objectType: string): ReferenceTarget | null {
    if (objectType === 'Macro') {
        return 'macro';
    }
    if (objectType === 'Lookup Definition' || objectType === 'Lookup File') {
        return 'lookup';
    }
    if (
        objectType === 'Saved Search' ||
        objectType === 'Report' ||
        objectType === 'Alert'
    ) {
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

function comparableName(
    targetType: ReferenceTarget,
    value: string
): string {
    const normalized = cleanTargetName(value).toLowerCase();
    return targetType === 'macro'
        ? normalized.replace(/\(\d+\)$/, '')
        : normalized;
}

function resolveReference(
    reference: ParsedReference,
    source: ContentObject,
    objects: ContentObject[]
): Resolution {
    const targetName = comparableName(
        reference.targetType,
        reference.targetName
    );
    const candidates = objects.filter(
        (contentObject) =>
            objectGroup(contentObject.objectType) === reference.targetType &&
            comparableName(reference.targetType, contentObject.canonicalName) ===
                targetName
    );
    const sameApp = candidates.filter(
        (contentObject) =>
            contentObject.app.toLowerCase() === source.app.toLowerCase()
    );
    const sameOwnerPrivate = source.owner
        ? sameApp.filter(
              (contentObject) =>
                  contentObject.sharing === 'user' &&
                  contentObject.owner === source.owner
          )
        : [];
    if (sameOwnerPrivate.length === 1) {
        return { object: sameOwnerPrivate[0], ambiguous: false };
    }
    if (sameOwnerPrivate.length > 1) {
        return { object: null, ambiguous: true };
    }

    const sameAppShared = sameApp.filter(
        (contentObject) =>
            contentObject.sharing === 'app' ||
            contentObject.sharing === 'global'
    );
    if (sameAppShared.length === 1) {
        return { object: sameAppShared[0], ambiguous: false };
    }
    if (sameAppShared.length > 1) {
        return { object: null, ambiguous: true };
    }

    const globallyShared = candidates.filter(
        (contentObject) => contentObject.sharing === 'global'
    );
    if (globallyShared.length === 1) {
        return { object: globallyShared[0], ambiguous: false };
    }
    if (
        candidates.length === 1 &&
        candidates[0].sharing !== 'user'
    ) {
        return { object: candidates[0], ambiguous: false };
    }
    return { object: null, ambiguous: candidates.length > 0 };
}

function targetCoverageComplete(
    targetType: ReferenceTarget,
    completeness: AnalysisCompleteness
): boolean {
    if (targetType === 'lookup') {
        return completeness.lookup_definitions && completeness.lookup_files;
    }
    const collectorByTarget: Record<
        Exclude<ReferenceTarget, 'lookup'>,
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

function missingTargetId(
    targetType: ReferenceTarget,
    app: string,
    targetName: string
): string {
    return `missing::${targetType}::${app}::${cleanTargetName(targetName)}`;
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
    return (
        contentObject.owner === null &&
        contentObject.sharing === 'user'
    );
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
    suggestedAction: string
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
    completeness: AnalysisCompleteness
): InventoryAnalysis {
    const objects = inputObjects.map((contentObject) => ({
        ...contentObject,
        evidence: [...contentObject.evidence],
    }));
    const objectById = new Map(
        objects.map((contentObject) => [
            contentObject.objectId,
            contentObject,
        ])
    );
    const edgeByKey = new Map<string, DependencyEdge>();
    const assertedMissingBySource = new Map<string, string[]>();
    const dynamicSources = new Set<string>();
    const parserCounts: Record<string, number> = {
        spl: 0,
        dashboard: 0,
        unresolved: 0,
    };

    sources.forEach((source) => {
        const sourceObject = objectById.get(source.objectId);
        if (!sourceObject || !source.text.trim()) {
            return;
        }
        if (dynamicReferencePattern.test(source.text)) {
            dynamicSources.add(source.objectId);
        }
        const references =
            source.kind === 'dashboard'
                ? extractDashboardReferences(source.text, source.sourceLocation)
                : extractSplReferences(source.text, source.sourceLocation);
        parserCounts[source.kind] += references.length;

        references.forEach((reference) => {
            const resolution = resolveReference(reference, sourceObject, objects);
            const targetId = resolution.object?.objectId ??
                missingTargetId(
                    reference.targetType,
                    sourceObject.app,
                    reference.targetName
                );
            const resolved = Boolean(resolution.object);
            const coverageComplete = targetCoverageComplete(
                reference.targetType,
                completeness
            );
            const canAssertMissing =
                !resolved && !resolution.ambiguous && coverageComplete;
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
                evidence = `${evidence}; multiple namespace candidates prevent deterministic resolution`;
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
            const edgeKey = [
                edge.sourceId,
                edge.targetId,
                edge.relation,
            ].join('|');
            edgeByKey.set(edgeKey, edge);
            if (!resolved) {
                parserCounts.unresolved += 1;
            }
        });
    });

    const edges = Array.from(edgeByKey.values());
    const inboundCounts = new Map<string, number>();
    const outboundCounts = new Map<string, number>();
    edges.forEach((edge) => {
        outboundCounts.set(
            edge.sourceId,
            (outboundCounts.get(edge.sourceId) ?? 0) + 1
        );
        if (edge.resolved) {
            inboundCounts.set(
                edge.targetId,
                (inboundCounts.get(edge.targetId) ?? 0) + 1
            );
        }
    });

    const findings: ContentFinding[] = [];
    objects.forEach((contentObject) => {
        const inbound = inboundCounts.get(contentObject.objectId) ?? 0;
        const outbound = outboundCounts.get(contentObject.objectId) ?? 0;
        const missingReasons =
            assertedMissingBySource.get(contentObject.objectId) ?? [];
        const missingOwner = ownerIsMissing(contentObject);
        const ageDays = daysSince(contentObject.updated);
        const scheduledAndEnabled =
            contentObject.scheduled === true &&
            contentObject.enabled !== false;
        const evidence = [...contentObject.evidence];

        if (contentObject.enabled === false) {
            evidence.push('The source object is disabled');
        }
        if (scheduledAndEnabled) {
            evidence.push('An enabled schedule is configured');
        }
        if (inbound > 0) {
            evidence.push(
                `${inbound} inbound relationship${inbound === 1 ? '' : 's'} resolved`
            );
        } else {
            evidence.push(
                'No inbound relationships were produced by the supported parsers in this scan'
            );
        }
        if (outbound > 0) {
            evidence.push(
                `${outbound} outbound relationship${outbound === 1 ? '' : 's'} parsed`
            );
        }
        if (dynamicSources.has(contentObject.objectId)) {
            evidence.push(
                'Dynamic reference syntax was detected; dependency coverage may be incomplete'
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
        let suggestedAction =
            'Collect usage evidence before making a cleanup decision';

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
                    suggestedAction
                )
            );
        } else if (scheduledAndEnabled) {
            healthStatus = 'active';
            suggestedAction =
                'Keep and validate execution history during usage analysis';
        } else if (missingOwner) {
            healthStatus = 'unowned';
            suggestedAction =
                'Assign an accountable reviewer before cleanup evaluation';
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
                    suggestedAction
                )
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
                    suggestedAction
                )
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
    };
}
