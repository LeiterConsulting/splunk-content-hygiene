import { ContentObject, DependencyEdge, EvidenceCoverageDimension, ReviewCoverage } from '../types';
import { ParserCoverageGap, ReferenceTarget } from './dependencyParser';
import { evidenceDigest } from './evidenceDigest';

export interface SourceCoverageGap extends ParserCoverageGap {
    sourceId: string;
    app: string;
}
export interface PrivateObjectCount { collector: string; app: string; count: number }
export interface CoverageContext {
    gaps: SourceCoverageGap[];
    privateObjects: PrivateObjectCount[];
    collectors: Record<string, boolean>;
    identityKnown: boolean;
}
const targets: ReferenceTarget[] = ['macro', 'lookup', 'lookup_file', 'saved_search', 'data_model', 'index', 'sourcetype', 'automatic_lookup'];
const searchableSources = ['saved_searches', 'macros', 'dashboards', 'data_models'];
const contentCollectors = [...searchableSources, 'lookup_definitions', 'lookup_files', 'indexes', 'sourcetypes', 'automatic_lookups'];

export function referenceTarget(object: ContentObject): ReferenceTarget | null {
    const values: Record<string, ReferenceTarget> = {
        Macro: 'macro', 'Lookup Definition': 'lookup', 'Lookup File': 'lookup_file',
        'Saved Search': 'saved_search', Report: 'saved_search', Alert: 'saved_search',
        'Data Model': 'data_model', Index: 'index', Sourcetype: 'sourcetype',
        'Automatic Lookup': 'automatic_lookup',
    };
    return values[object.objectType] ?? null;
}

const normalize = (type: ReferenceTarget, name: string): string =>
    type === 'macro' ? name.replace(/\(\d+\)$/, '') : name;
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
    return (object, adjacent, parentKnown) => {
        const config = object.configurationFingerprint;
        const own = outgoing.get(object.objectId);
        const outboundReasons = [...(own?.messages ?? [])];
        if (object.objectType === 'Sourcetype') {
            outboundReasons.push('Only separately inventoried automatic props lookup rules are assessed. Other search-time transformations, renames and invoking-app scope are unverified for sourcetypes.');
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
            const generic = type ? buckets.get(`${type}\0${namespace}\0*`) : undefined;
            const named = type ? buckets.get(`${type}\0${namespace}\0${name}`) : undefined;
            const count = (generic?.sources.size ?? 0) +
                [...(named?.sources ?? [])].filter((id) => !generic?.sources.has(id)).length;
            const examples = [...(generic?.examples ?? []), ...(named?.examples ?? [])];
            let required: string[] = [];
            if (object.objectType === 'App') { required = contentCollectors; }
            else if (type) { required = [...searchableSources,
                ...(type === 'lookup_file' ? ['lookup_definitions'] : []),
                ...(type === 'lookup' ? ['automatic_lookups'] : [])]; }
            const missing = required.filter((collector) => context.collectors[collector] !== true);
            const reasons: string[] = [];
            if (!type && object.objectType !== 'App') {
                reasons.push('Incoming navigation links and external callers are outside the supported static target model.');
            }
            if (type === 'automatic_lookup') {
                reasons.push('Automatic lookup callers are conditional. Implicit/wildcard event domains, props precedence, renames and inherited invocation namespaces are not exhaustively mapped.');
            }
            if (type === 'lookup' || type === 'lookup_file') {
                reasons.push('Other implicit props consumers, including calculated fields and extraction/transformation rules, are not inventoried.');
            }
            if (missing.length) { reasons.push(`Potential source catalogs are incomplete: ${missing.join(', ')}.`); }
            if (count) { reasons.push(`${count} visible source object(s) could contain additional ${type?.replace(/_/g, ' ')} references in this namespace.`); }
            const privateNamespace = object.objectType === 'App' ? object.app : namespace;
            const excluded = required.reduce((sum, collector) => sum + (privateCounts.get(`${collector}\0${privateNamespace}`) ?? 0), 0);
            if (excluded) { reasons.push(`${excluded} private object(s) are excluded in the relevant source scope. Their references are not assessed.`); }
            if (!context.identityKnown) { reasons.push('Scanning identity/roles could not be verified.'); }
            inbound = dimension(reasons, count + excluded, examples,
                [generic?.digest ?? null, named?.digest ?? null, missing, excluded]);
            inboundCache.set(cacheKey, inbound);
        }
        return { policy: 'shared-static-v1',
            configuration: dimension(config ? [] : ['Returned configuration fingerprint is unavailable.'], 0, [], null, !config),
            access: dimension(config?.accessComplete === true ? [] : ['The returned ACL does not establish owner, sharing and explicit read/write permissions.'], 0, [], null, !config?.accessComplete),
            outbound: dimension(outboundReasons, own?.sources.size ?? 0, own ? [object.objectId] : [],
                [own?.digest ?? null, unresolved.map((edge) => edge.edgeId).sort(), parentKnown]),
            inbound,
        };
    };
}
