import { ContentObject, DependencyEdge, EvidenceCoverageDimension, ReviewCoverage } from '../types';
import { ParserCoverageGap, ReferenceTarget } from './dependencyParser';
import { evidenceDigest } from './evidenceDigest';
import { tagBindingIdentity } from './knowledgeReferences';

export const SHARED_STATIC_POLICY = 'shared-static-v3' as const;

export interface SourceCoverageGap extends ParserCoverageGap {
    sourceId: string;
    app: string;
    invocationNamespaceUnverified?: boolean;
}
export interface PrivateObjectCount { collector: string; app: string; count: number }
export interface CoverageContext {
    gaps: SourceCoverageGap[];
    privateObjects: PrivateObjectCount[];
    collectors: Record<string, boolean>;
    identityKnown: boolean;
}
const fieldSources = ['field_extractions', 'field_aliases', 'calculated_fields', 'field_transforms'];
const targets: ReferenceTarget[] = ['macro', 'lookup', 'lookup_file', 'saved_search', 'data_model', 'index', 'sourcetype', 'automatic_lookup', 'event_type', 'tag_binding',
    'field_extraction', 'field_alias', 'calculated_field', 'field_transform'];
const searchableSources = ['saved_searches', 'macros', 'dashboards', 'data_models', 'event_types'];
const contentCollectors = [...searchableSources, ...fieldSources, 'lookup_definitions', 'lookup_files', 'indexes', 'sourcetypes', 'automatic_lookups', 'tag_bindings'];

export function referenceTarget(object: ContentObject): ReferenceTarget | null {
    const values: Record<string, ReferenceTarget> = {
        Macro: 'macro', 'Lookup Definition': 'lookup', 'Lookup File': 'lookup_file',
        'Saved Search': 'saved_search', Report: 'saved_search', Alert: 'saved_search',
        'Data Model': 'data_model', Index: 'index', Sourcetype: 'sourcetype',
        'Automatic Lookup': 'automatic_lookup',
        'Event Type': 'event_type', 'Tag Binding': 'tag_binding',
        'Field Extraction': 'field_extraction', 'Field Alias': 'field_alias',
        'Calculated Field': 'calculated_field', 'Field Transform': 'field_transform',
    };
    return values[object.objectType] ?? null;
}

function normalize(type: ReferenceTarget, name: string): string {
    if (type === 'macro') { return name.replace(/\(\d+\)$/, ''); }
    if (type === 'tag_binding') { return (tagBindingIdentity(name)?.tag ?? name).toLowerCase(); }
    if (type === 'event_type') { return name.toLowerCase(); }
    return name;
}
interface Bucket { sources: Set<string>; messages: Set<string>; digest?: string; examples?: string[] }
const emptyBucket = (): Bucket => ({ sources: new Set(), messages: new Set() });

function dimension(reasons: string[], count = 0, examples: string[] = [], provenance: unknown = null,
    unavailable = false): EvidenceCoverageDimension {
    const unique = [...new Set(reasons)].sort();
    let status: EvidenceCoverageDimension['status'] = 'complete';
    if (unique.length) { status = unavailable ? 'unavailable' : 'partial'; }
    return { status,
        reasons: unique.slice(0, 8), sourceCount: count, sourceObjectIds: [...new Set(examples)].sort().slice(0, 5),
        digest: evidenceDigest([unique, count, provenance]),
    };
}

/** One indexed uncertainty model per scan; never an estate-wide scan per object. */
export function buildCoverageResolver(context: CoverageContext): (
    object: ContentObject, adjacent: DependencyEdge[], parentKnown: boolean,
) => ReviewCoverage {
    const buckets = new Map<string, Bucket>();
    const outgoing = new Map<string, Bucket>();
    const add = (key: string, gap: SourceCoverageGap): void => {
        const bucket = buckets.get(key) ?? emptyBucket();
        bucket.sources.add(gap.sourceId); bucket.messages.add(gap.message); buckets.set(key, bucket);
    };
    context.gaps.forEach((gap) => {
        const own = outgoing.get(gap.sourceId) ?? emptyBucket();
        own.sources.add(gap.sourceId); own.messages.add(gap.message); outgoing.set(gap.sourceId, own);
        (gap.targets === 'all' ? targets : gap.targets).forEach((type) => {
            const name = gap.targetName ? normalize(type, gap.targetName) : '*';
            add(`${type}\0*\0${name}`, gap);
            add(`${type}\0${gap.app}\0${name}`, gap);
            if (gap.invocationNamespaceUnverified) { add(`${type}\0?\0${name}`, gap); }
        });
    });
    [buckets, outgoing].forEach((map) => [...map.entries()].forEach(([key, bucket]) => map.set(key, {
        ...bucket, digest: evidenceDigest([[...bucket.sources].sort(), [...bucket.messages].sort()]),
        examples: [...bucket.sources].sort().slice(0, 5),
    })));
    const privateCounts = new Map<string, number>();
    context.privateObjects.forEach(({ collector, app, count }) => {
        privateCounts.set(`${collector}\0${app}`, (privateCounts.get(`${collector}\0${app}`) ?? 0) + count);
        privateCounts.set(`${collector}\0*`, (privateCounts.get(`${collector}\0*`) ?? 0) + count);
    });
    const inboundCache = new Map<string, EvidenceCoverageDimension>();
    // Unknown invoking-app contexts can affect app-only targets outside the
    // reusable definition's owning app. Cache generic unions once per scope,
    // without copying a large global source set for every target object.
    const genericCache = new Map<string, { count: number; has: (id: string) => boolean; examples: string[]; digest: string }>();
    return (object, adjacent, parentKnown) => {
        const config = object.configurationFingerprint;
        const own = outgoing.get(object.objectId);
        const outboundReasons = [...(own?.messages ?? [])];
        if (object.objectType === 'Sourcetype') {
            outboundReasons.push('Separately inventoried props lookup and declared field rules have bounded coverage. Effective precedence, renames, regex outputs and invoking-app scope remain unverified for sourcetypes.');
        }
        if (!context.identityKnown) { outboundReasons.push('Scanning identity/roles could not be verified.'); }
        if (object.objectType !== 'App' && !parentKnown) {
            outboundReasons.push('The parent app is not present in the declared shared inventory.');
        }
        const unresolved = adjacent.filter((edge) => edge.sourceId === object.objectId && !edge.resolved);
        if (unresolved.length) { outboundReasons.push(`${unresolved.length} captured outbound relationship(s) remain unresolved.`); }
        if (object.analysisWarnings?.length && !own) {
            outboundReasons.push('Source diagnostics have no scoped coverage record; dependencies remain unverified.');
        }
        const type = referenceTarget(object);
        // Exported targets may be referenced from any app. App-only targets
        // remain uncertain for sources in their own namespace, not every app.
        const namespace = ['index', 'sourcetype'].includes(type ?? '') || object.sharing !== 'app' ? '*' : object.app;
        const name = type ? normalize(type, object.canonicalName) : '';
        const cacheKey = `${object.objectType}\0${namespace}\0${object.app}\0${name}`;
        let inbound = inboundCache.get(cacheKey);
        if (!inbound) {
            const scopeKey = `${type}\0${namespace}`;
            let generic = genericCache.get(scopeKey);
            if (!generic) {
                const scoped = type ? buckets.get(`${type}\0${namespace}\0*`) : undefined;
                const invoking = type && namespace !== '*' ? buckets.get(`${type}\0?\0*`) : undefined;
                let count = scoped?.sources.size ?? 0;
                invoking?.sources.forEach(id => { if (!scoped?.sources.has(id)) { count += 1; } });
                generic = { count, has: id => Boolean(scoped?.sources.has(id) || invoking?.sources.has(id)),
                    examples: [...new Set([...(scoped?.examples ?? []), ...(invoking?.examples ?? [])])].sort().slice(0, 5),
                    digest: evidenceDigest([scoped?.digest ?? null, invoking?.digest ?? null]) };
                genericCache.set(scopeKey, generic);
            }
            const named = type ? buckets.get(`${type}\0${namespace}\0${name}`) : undefined;
            const invokingNamed = type && namespace !== '*' ? buckets.get(`${type}\0?\0${name}`) : undefined;
            const additional = new Set<string>();
            [named, invokingNamed].forEach(bucket => bucket?.sources.forEach(id => { if (!generic!.has(id)) { additional.add(id); } }));
            const count = generic.count + additional.size;
            const examples = [...generic.examples, ...(named?.examples ?? []), ...(invokingNamed?.examples ?? [])];
            let required: string[] = [];
            if (object.objectType === 'App') { required = contentCollectors; }
            else if (type) { required = [...searchableSources.filter(collector => type !== 'tag_binding' || collector !== 'event_types'),
                ...(type === 'lookup_file' ? ['lookup_definitions'] : []),
                ...(type === 'lookup' ? ['automatic_lookups', 'calculated_fields'] : []),
                ...(['field_extraction', 'field_alias', 'calculated_field', 'field_transform'].includes(type) ? [...fieldSources, 'automatic_lookups'] : []),
                ...(type === 'event_type' ? ['tag_bindings'] : [])]; }
            const missing = required.filter((collector) => context.collectors[collector] !== true);
            const reasons: string[] = [];
            if (!type && object.objectType !== 'App') {
                reasons.push('Incoming navigation links and external callers are outside the supported static target model.');
            }
            if (type === 'automatic_lookup') {
                reasons.push('Automatic lookup callers are conditional. Implicit/wildcard event domains, props precedence, renames and inherited invocation namespaces are not exhaustively mapped.');
            }
            if (type === 'lookup' || type === 'lookup_file') {
                reasons.push('Unsupported calculated-field functions, dynamic props and other implicit consumers can add lookup references beyond the supported static subset.');
            }
            if (['field_extraction', 'field_alias', 'calculated_field', 'field_transform'].includes(type ?? '')) {
                reasons.push('Declared field paths and exact event-scope callers are potential only. Regex captures, effective values, cross-scope/namespace overrides, alias chaining and parallel calculated-field availability are not exhaustively resolved.');
            }
            if (type === 'event_type' || type === 'tag_binding') {
                reasons.push('Only declared literal filters and supported shared tag assignments are mapped. Implicit event classification, wildcard names, system inheritance and runtime field availability remain unverified.');
            }
            if (missing.length) { reasons.push(`Potential source catalogs are incomplete: ${missing.join(', ')}.`); }
            if (count) { reasons.push(`${count} visible source object(s) could contain additional ${type?.replace(/_/g, ' ')} references in this namespace.`); }
            const privateNamespace = object.objectType === 'App' ? object.app : namespace;
            const excluded = required.reduce((sum, collector) => sum + (privateCounts.get(`${collector}\0${privateNamespace}`) ?? 0), 0);
            if (excluded) { reasons.push(`${excluded} private object(s) are excluded in the relevant source scope. Their references are not assessed.`); }
            if (!context.identityKnown) { reasons.push('Scanning identity/roles could not be verified.'); }
            inbound = dimension(reasons, count + excluded, examples,
                [generic.digest, named?.digest ?? null, invokingNamed?.digest ?? null, missing, excluded]);
            inboundCache.set(cacheKey, inbound);
        }
        return { policy: SHARED_STATIC_POLICY,
            configuration: dimension(config ? [] : ['Returned configuration fingerprint is unavailable.'], 0, [], null, !config),
            access: dimension(config?.accessComplete === true ? [] : ['The returned ACL does not establish owner, sharing and explicit read/write permissions.'], 0, [], null, !config?.accessComplete),
            outbound: dimension(outboundReasons, own?.sources.size ?? 0, own ? [object.objectId] : [],
                [own?.digest ?? null, unresolved.map((edge) => edge.edgeId).sort(), parentKnown]),
            inbound,
        };
    };
}
