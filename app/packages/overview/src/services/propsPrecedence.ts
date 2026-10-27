/* eslint-disable no-restricted-syntax -- Context, read, fan-out and wall-clock budgets are explicit. */
import { ContentObject, DependencyEdge, PropsContextEvidence } from '../types';
import { configurationFingerprint } from './reviewEvidence';
import { PROPS_CONTEXT_LIMIT } from './propsEvidence';

export const PROPS_READ_BYTES = 131072;
export const PROPS_CHECK_MS = 90000;
export const PROPS_TASK_LIMIT = 50000;
export const PROPS_VISIT_LIMIT = 100000;
export interface PropsReadRequest {
    kind: 'rule' | 'merged'; app: string; stanza: string; attribute: string; endpoint: string; name: string; signal: AbortSignal;
}
export type PropsRead = (request: PropsReadRequest) => Promise<{ status: number; data: unknown }>;
/** Native REST result filtering, never an event search. Older Web proxies expose
 * only the calculated-field collection. Do not widen exposure or permissions. */
export function propsReadPlan(request: PropsReadRequest): { path: string; query: URLSearchParams } {
    if (!Object.values(endpoints).includes(request.endpoint) || !['rule', 'merged'].includes(request.kind)) { throw new Error('Unsupported props metadata request.'); }
    const collection = request.kind === 'rule' && request.endpoint === 'data/props/calcfields';
    let path = `configs/conf-props/${encodeURIComponent(request.stanza)}`;
    if (request.kind === 'rule') { path = collection ? request.endpoint : `${request.endpoint}/${encodeURIComponent(request.name)}`; }
    const query = new URLSearchParams({ output_mode: 'json', count: '2' });
    if (collection) {
        const quote = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        query.set('search', `stanza=${quote(request.stanza)} AND attribute=${quote(request.attribute)}`);
    }
    const fields = request.kind === 'rule' ? ['stanza', 'attribute', 'value', 'type', 'transform', 'disabled', 'eai:acl', 'eai:appName', 'eai:userName']
        : [request.attribute, 'eai:appName', 'eai:userName'];
    fields.forEach(field => query.append('f', field));
    return { path, query };
}
interface Task { object: ContentObject; app: string; key: string; rank: number; endpoint: string }
interface Observation { reason: PropsContextEvidence['reason']; selected?: ContentObject; digest?: string }
const endpoints: Record<string, string> = { 'Field Extraction': 'data/props/extractions', 'Field Alias': 'data/props/fieldaliases',
    'Calculated Field': 'data/props/calcfields', 'Automatic Lookup': 'data/props/lookups' };
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const appName = (value: string): boolean => /^[A-Za-z0-9_.-]{1,200}$/.test(value) && !['.', '..'].includes(value);
const fieldDigest = (object: ContentObject): string | undefined => object.configurationFingerprint?.fields.find(row => row.name === 'value')?.digest;
function singleEntry(value: unknown): Record<string, unknown> | undefined {
    const entries = record(value)?.entry;
    return Array.isArray(entries) && entries.length === 1 ? record(entries[0]) : undefined;
}
function identityKey(type: string, app: string, name: string): string { return `${type}\0${app}\0${name}`; }
function failureReason(status: number): PropsContextEvidence['reason'] {
    if (status === 403 || status === 401) { return 'access_denied'; }
    return status === 404 ? 'not_returned' : 'request_failed';
}

/** Observe native shared bindings, not reconstructed file precedence. Native
 * rule ACL identifies the returned attribute; whole-stanza ACL never does.
 * Matching captured value/access evidence prevents silently mixing scan epochs.
 * Reads are only scan-time, deduplicated, GET-only and fail closed per context. */
export async function checkPropsPrecedence(objects: ContentObject[], edges: DependencyEdge[], read: PropsRead,
    options: { maxContexts?: number; maxMilliseconds?: number; signal?: AbortSignal } = {}): Promise<{ objects: ContentObject[]; edges: DependencyEdge[]; counts: Record<string, number> }> {
    const max = Number.isSafeInteger(options.maxContexts) ? Math.max(0, Math.min(PROPS_CONTEXT_LIMIT, options.maxContexts!)) : PROPS_CONTEXT_LIMIT;
    const milliseconds = Number.isSafeInteger(options.maxMilliseconds) ? Math.max(1, Math.min(PROPS_CHECK_MS, options.maxMilliseconds!)) : PROPS_CHECK_MS;
    const controller = new AbortController(); const abort = (): void => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) { controller.abort(); }
    const timer = setTimeout(abort, milliseconds);
    const byId = new Map(objects.map(object => [object.objectId, object]));
    const byIdentity = new Map<string, ContentObject[]>();
    const groups = new Map<string, Task>(); const tasks = new Map<string, Task>();
    const checksForEdge = new Map<string, Set<string>>();
    const truncatedEdges = new Set<string>(); const truncatedObjects = new Set<string>();
    let visits = 0;
    const add = (object: ContentObject | undefined, app: string, rank: number): string | undefined => {
        if (!object?.fieldLineage || !Object.prototype.hasOwnProperty.call(endpoints, object.objectType) || !['app', 'global'].includes(object.sharing ?? '')) { return undefined; }
        const key = `${app}\0${endpoints[object.objectType]}\0${object.canonicalName}`; const own = `${object.objectId}\0${app}`;
        if (!tasks.has(own)) {
            if (tasks.size >= PROPS_TASK_LIMIT) { truncatedObjects.add(object.objectId); return undefined; }
            tasks.set(own, { object, app, key, rank, endpoint: endpoints[object.objectType] });
        }
        if (!groups.has(key) || groups.get(key)!.rank > rank) { groups.set(key, { object, app, key, rank, endpoint: endpoints[object.objectType] }); }
        return own;
    };
    objects.forEach(object => {
        const key = identityKey(object.objectType, object.app, object.canonicalName); const rows = byIdentity.get(key) ?? [];
        rows.push(object); byIdentity.set(key, rows);
    });
    // Fixed callers first, reusable configuration second, own-app inspection last.
    edges.forEach(edge => {
        const proof = edge.fieldProvenance; if (!proof) { return; }
        const checks = new Set<string>();
        for (const app of proof.contextApps.slice(0, 250)) {
            for (const id of [edge.sourceId, edge.targetId, ...proof.viaObjectIds.slice(0, 250)]) {
                if (visits >= PROPS_VISIT_LIMIT || checks.size >= PROPS_CONTEXT_LIMIT) { truncatedEdges.add(edge.edgeId); break; }
                visits += 1;
                const key = add(byId.get(id), app, proof.invocation === 'fixed_app' ? 0 : 1); if (key) { checks.add(key); }
                else if (byId.get(id)?.fieldLineage && Object.prototype.hasOwnProperty.call(endpoints, byId.get(id)!.objectType) && tasks.size >= PROPS_TASK_LIMIT) { truncatedEdges.add(edge.edgeId); }
            }
            if (truncatedEdges.has(edge.edgeId)) { break; }
        }
        checksForEdge.set(edge.edgeId, checks);
    });
    objects.forEach(object => add(object, object.app, 2));
    const observations = new Map<string, Observation>(); const queue: Task[] = [];
    [...groups.values()].sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key)).forEach(task => {
        const facts = task.object.fieldLineage!;
        if (!facts.scope?.exact || !facts.stanza || !facts.attribute || ['.', '..'].includes(facts.stanza) ||
            !/^(?:EXTRACT|REPORT|FIELDALIAS|EVAL|LOOKUP)-.+$/.test(facts.attribute) || !appName(task.app) ||
            task.object.canonicalName !== `${facts.stanza} : ${facts.attribute}`) { observations.set(task.key, { reason: 'unsupported_scope' }); }
        else if (queue.length >= max) { observations.set(task.key, { reason: 'budget' }); }
        else { queue.push(task); }
    });
    let cursor = 0; let reads = 0;
    const observe = async (task: Task): Promise<Observation> => {
        if (controller.signal.aborted) { return { reason: 'budget' }; }
        const facts = task.object.fieldLineage!;
        try {
            const request = { app: task.app, stanza: facts.stanza!, attribute: facts.attribute!, endpoint: task.endpoint,
                name: task.object.canonicalName, signal: controller.signal };
            reads += 1; const rule = await read({ ...request, kind: 'rule' });
            if (rule.status !== 200) { return { reason: failureReason(rule.status) }; }
            if (task.endpoint === 'data/props/calcfields' && record(record(rule.data)?.paging)?.total !== 1) { return { reason: 'metadata_mismatch' }; }
            const entry = singleEntry(rule.data); const content = record(entry?.content); const acl = record(entry?.acl) ?? record(content?.['eai:acl']);
            if (!entry || entry.name !== request.name || content?.stanza !== request.stanza || content?.attribute !== request.attribute ||
                typeof content?.value !== 'string' || typeof acl?.app !== 'string' ||
                !(acl.app === task.app && ['app', 'global'].includes(String(acl.sharing)) || acl.app !== task.app && acl.sharing === 'global')) { return { reason: 'metadata_mismatch' }; }
            const candidates = byIdentity.get(identityKey(task.object.objectType, acl.app, request.name));
            if (candidates?.length !== 1) { return { reason: 'metadata_mismatch' }; }
            const selected = candidates[0]; const fingerprint = configurationFingerprint(content, acl);
            const digest = fingerprint.fields.find(row => row.name === 'value')?.digest;
            if (!digest || digest !== fieldDigest(selected) || selected.sharing !== acl.sharing || !selected.configurationFingerprint?.accessComplete ||
                !fingerprint.accessComplete || fingerprint.accessDigest !== selected.configurationFingerprint.accessDigest) { return { reason: 'snapshot_changed' }; }
            if (['stanza', 'attribute', 'type', 'transform', 'disabled'].some(name =>
                fingerprint.fields.find(field => field.name === name)?.digest !== selected.configurationFingerprint?.fields.find(field => field.name === name)?.digest)) { return { reason: 'snapshot_changed' }; }
            if (controller.signal.aborted) { return { reason: 'budget' }; }
            reads += 1; const merged = await read({ ...request, kind: 'merged' });
            if (merged.status !== 200) { return { reason: failureReason(merged.status) }; }
            const stanza = singleEntry(merged.data); const attrs = record(stanza?.content);
            if (!stanza || stanza.name !== request.stanza || attrs?.['eai:appName'] !== task.app || attrs?.['eai:userName'] !== 'nobody') { return { reason: 'metadata_mismatch' }; }
            if (!Object.prototype.hasOwnProperty.call(attrs, request.attribute)) { return { reason: 'not_returned' }; }
            // Preserve the exact native text comparison. A normalizing fingerprint
            // alone cannot make two differently encoded declarations equivalent.
            if (attrs![request.attribute] !== content.value) { return { reason: 'metadata_mismatch' }; }
            return { reason: 'matched', selected, digest };
        } catch { return { reason: controller.signal.aborted ? 'budget' : 'request_failed' }; }
    };
    try {
        await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
            while (cursor < queue.length) {
                const task = queue[cursor]; cursor += 1;
                // eslint-disable-next-line no-await-in-loop -- Four bounded workers, never one promise per estate object.
                observations.set(task.key, await observe(task));
            }
        }));
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
    const results = new Map<string, PropsContextEvidence>(); const counts: Record<string, number> = { props_context_reads: reads, props_context_checks: 0,
        props_context_local: 0, props_context_inherited: 0, props_context_shadowed: 0, props_context_unverified: 0 };
    tasks.forEach((task, key) => {
        const observed = observations.get(task.key) ?? { reason: 'budget' as const };
        let status: PropsContextEvidence['status'] = 'unverified';
        if (observed.selected) {
            status = observed.selected.app === task.app ? 'local' : 'inherited';
            if (observed.selected.objectId !== task.object.objectId) { status = 'shadowed'; }
        }
        results.set(key, { version: 1, objectId: task.object.objectId, app: task.app, status, selectedObjectId: observed.selected?.objectId ?? null,
            valueDigest: observed.digest ?? null, reason: status === 'shadowed' ? 'different_binding' : observed.reason });
        counts.props_context_checks += 1; counts[`props_context_${status}`] += 1;
    });
    counts.props_context_visits = visits;
    counts.props_context_truncated_edges = truncatedEdges.size;
    const perObject = new Map<string, PropsContextEvidence[]>();
    results.forEach(row => { const list = perObject.get(row.objectId) ?? []; if (list.length < PROPS_CONTEXT_LIMIT) { list.push(row); }
        else { truncatedObjects.add(row.objectId); }
        perObject.set(row.objectId, list); });
    counts.props_context_truncated_objects = truncatedObjects.size;
    return { counts, objects: objects.map(object => object.fieldLineage && (perObject.has(object.objectId) || truncatedObjects.has(object.objectId)) ? { ...object,
        fieldLineage: { ...object.fieldLineage, propsContexts: (perObject.get(object.objectId) ?? []).sort((a, b) => a.app.localeCompare(b.app)),
            propsContextsTruncated: truncatedObjects.has(object.objectId) } } : object),
    edges: edges.map(edge => checksForEdge.has(edge.edgeId) ? { ...edge, fieldProvenance: { ...edge.fieldProvenance!,
        propsContexts: [...checksForEdge.get(edge.edgeId)!].map(key => results.get(key)!), propsContextsTruncated: truncatedEdges.has(edge.edgeId) } } : edge) };
}
