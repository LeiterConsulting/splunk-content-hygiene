/* eslint-disable no-restricted-syntax, no-continue -- Work, groups, candidates, rows, bytes and wall-clock have explicit ceilings. */
import { ContentObject, CrossStanzaPropsEvidence, DependencyEdge, PropsContextEvidence, PropsEventScope } from '../types';
import { CROSS_STANZA_BYTES, CROSS_STANZA_ROWS } from './crossStanzaEvidence';
import { compilePropsPattern, matchPropsPattern, PROPS_PATTERN_SCAN_WORK } from './propsPatterns';

export interface ScopedPropsEventScope extends PropsEventScope { callerObjectId: string; app: string }
export const CROSS_STANZA_VISITS = 100000;
export const CROSS_STANZA_GROUPS = 10000;
export const CROSS_STANZA_MS = 5000;
interface Member { object: ContentObject; edges: Set<string>; valid: boolean; shadowed: boolean; caseMatch: boolean; priority: number | null }
interface Group { scope: ScopedPropsEventScope; attribute: string; members: Map<string, Member>; limited: boolean }
const category = { sourcetype: 0, host: 1, source: 2 };
const memberCategory = (member: Member): number => compilePropsPattern(member.object.fieldLineage!.scope!).kind === 'default' ? -1 : category[member.object.fieldLineage!.scope!.field];
const selectorKey = (caller: string, field: string, value: string, location: string): string => JSON.stringify([caller, field, value.toLowerCase(), location]);
const rowKey = (row: CrossStanzaPropsEvidence): string => JSON.stringify([row.objectId, row.callerObjectId, row.app, row.attribute, row.sourceLocation]);

/** No new edges, confidence changes or customer/native writes. Rank only a
 * captured supported subset, for a single strict conjunctive source context.
 * Missing/private/unsupported configuration never becomes an absence assertion. */
export async function compareCrossStanzaProps(objects: ContentObject[], edges: DependencyEdge[], scopes: ScopedPropsEventScope[],
    options: { catalogsComplete: boolean; signal?: AbortSignal; maxVisits?: number; maxMilliseconds?: number } = { catalogsComplete: false }): Promise<{
        objects: ContentObject[]; edges: DependencyEdge[]; counts: Record<string, number>;
    }> {
    const byId = new Map(objects.map(object => [object.objectId, object]));
    const scopeIndex = new Map<string, ScopedPropsEventScope[]>();
    const groups = new Map<string, Group>();
    const nativeContexts = new Map<string, PropsContextEvidence>(); let nativeIndexLimited = false;
    const rowsByEdge = new Map<string, Map<string, CrossStanzaPropsEvidence>>(); const rowsByObject = new Map<string, Map<string, CrossStanzaPropsEvidence>>();
    const limitedEdges = new Set<string>(); const limitedObjects = new Set<string>(); const byteCounts = new Map<string, number>();
    const maxVisits = Number.isSafeInteger(options.maxVisits) ? Math.max(0, Math.min(CROSS_STANZA_VISITS, options.maxVisits!)) : CROSS_STANZA_VISITS;
    const deadline = Date.now() + (Number.isSafeInteger(options.maxMilliseconds) ? Math.max(1, Math.min(CROSS_STANZA_MS, options.maxMilliseconds!)) : CROSS_STANZA_MS);
    let visits = 0; let records = 0;
    const patternWork = { remaining: PROPS_PATTERN_SCAN_WORK };
    const available = (): boolean => visits < maxVisits && Date.now() <= deadline && !options.signal?.aborted;
    const counts: Record<string, number> = { props_cross_stanza_visits: 0, props_cross_stanza_groups: 0, props_cross_stanza_highest: 0, props_cross_stanza_lower: 0, props_cross_stanza_unverified: 0 };
    const store = (edge: string, row: CrossStanzaPropsEvidence): void => {
        const bytes = new TextEncoder().encode(JSON.stringify(row)).length; const key = rowKey(row);
        for (const [id, index, limited, prefix] of [[edge, rowsByEdge, limitedEdges, 'edge:'], [row.objectId, rowsByObject, limitedObjects, 'object:']] as const) {
            const list = index.get(id) ?? new Map<string, CrossStanzaPropsEvidence>(); const byteKey = prefix + id;
            if (list.has(key)) { continue; }
            if (list.size >= CROSS_STANZA_ROWS || bytes + (byteCounts.get(byteKey) ?? 0) > CROSS_STANZA_BYTES || records >= 50000) { limited.add(id); continue; }
            list.set(key, row); index.set(id, list); byteCounts.set(byteKey, bytes + (byteCounts.get(byteKey) ?? 0)); records += 1;
        }
    };
    for (const object of objects) {
        for (const context of object.fieldLineage?.propsContexts ?? []) {
            if (!available()) { nativeIndexLimited = true; break; } visits += 1;
            const key = JSON.stringify([object.objectId, context.app]);
            if (nativeContexts.has(key)) { nativeIndexLimited = true; } else { nativeContexts.set(key, context); }
        }
        if (nativeIndexLimited) { break; }
    }
    for (const scope of scopes.slice(0, 50000)) {
        if (!available()) { break; } visits += 1;
        for (const selector of scope.selectors) {
            const key = selectorKey(scope.callerObjectId, selector.field, selector.value, selector.sourceLocation);
            const list = scopeIndex.get(key) ?? []; if (list.length < 250) { list.push(scope); scopeIndex.set(key, list); }
        }
    }
    const fallback = (edge: DependencyEdge, object: ContentObject, reason: CrossStanzaPropsEvidence['reason']): void => {
        counts.props_cross_stanza_unverified += 1;
        const location = edge.fieldProvenance?.contexts?.[0]?.selector?.sourceLocation ?? 'event scope (location unavailable)';
        store(edge.edgeId, { version: 1, objectId: object.objectId, callerObjectId: edge.sourceId, app: byId.get(edge.sourceId)?.app ?? object.app,
            attribute: object.fieldLineage!.attribute!, sourceLocation: location.length <= 4096 ? location : 'event scope (location exceeds budget)', selectors: [],
            status: 'unverified', reason, selectedObjectId: null, competingObjectIds: [], stanzaPriority: null, selectedPriority: null });
    };
    for (let index = 0; index < edges.length; index += 1) {
        const { [index]: edge } = edges; const proof = edge.fieldProvenance; const object = byId.get(edge.targetId);
        if (proof?.kind !== 'event_scope' || !edge.resolved || !object?.fieldLineage?.attribute) { continue; }
        if (!available()) { limitedEdges.add(edge.edgeId); limitedObjects.add(object.objectId); fallback(edge, object, 'budget'); continue; }
        visits += 1; let found = false;
        for (const context of proof.contexts ?? []) {
            if (!available()) { limitedEdges.add(edge.edgeId); limitedObjects.add(object.objectId); break; } visits += 1;
            const { selector } = context; if (!selector) { continue; }
            const matches = scopeIndex.get(selectorKey(edge.sourceId, selector.field, selector.value, selector.sourceLocation)) ?? [];
            for (const scope of matches) {
                if (!available()) { limitedEdges.add(edge.edgeId); limitedObjects.add(object.objectId); break; } visits += 1;
                if (proof.invocation !== 'fixed_app' || scope.app !== context.invokingApp || scope.app !== byId.get(edge.sourceId)?.app ||
                    !['Saved Search', 'Report', 'Alert', 'Dashboard'].includes(byId.get(edge.sourceId)?.objectType ?? '')) { continue; }
                const key = JSON.stringify([scope.callerObjectId, scope.app, object.fieldLineage.attribute, scope.sourceLocation]);
                if (!groups.has(key) && groups.size >= CROSS_STANZA_GROUPS) { limitedEdges.add(edge.edgeId); limitedObjects.add(object.objectId); continue; }
                const group = groups.get(key) ?? { scope, attribute: object.fieldLineage.attribute, members: new Map<string, Member>(), limited: false };
                group.limited ||= (byId.get(edge.sourceId)?.analysisWarnings ?? []).some(message =>
                    /(?:field|lookup).*(?:budget|limit|truncat)|(?:budget|limit|truncat).*(?:field|lookup)/i.test(message));
                const { fieldLineage: facts } = object; const relevant = scope.selectors.find(item => item.field === facts.scope?.field);
                const pattern = facts.scope ? compilePropsPattern(facts.scope) : null;
                const matched = pattern && (pattern.kind === 'default' || relevant) ? matchPropsPattern(pattern, relevant ?? scope.selectors[0], [patternWork]) : 'unsupported';
                if (matched === 'budget') { group.limited = true; }
                const native = nativeContexts.get(JSON.stringify([object.objectId, scope.app]));
                const member = group.members.get(object.objectId) ?? { object, edges: new Set<string>(), valid: Boolean(native && ['local', 'inherited'].includes(native.status) &&
                    native.selectedObjectId === object.objectId && !facts.propsContextsTruncated && !proof.propsContextsTruncated && facts.scope && pattern && pattern.kind !== 'unsupported' &&
                    ['app', 'global'].includes(object.sharing ?? '') && (object.app === scope.app || object.sharing === 'global') &&
                    facts.enabled !== false && object.enabled !== false && object.canonicalName === `${facts.stanza} : ${facts.attribute}` &&
                    facts.stanza === (facts.scope.field === 'sourcetype' ? facts.scope.value : `${facts.scope.field}::${facts.scope.value}`)),
                    shadowed: native?.status === 'shadowed', priority: native?.stanzaPriority ?? null,
                    caseMatch: matched === 'match' };
                if (!group.members.has(object.objectId) && group.members.size >= 16) { group.limited = true; limitedEdges.add(edge.edgeId); limitedObjects.add(object.objectId); continue; }
                member.edges.add(edge.edgeId); group.members.set(object.objectId, member); groups.set(key, group); found = true;
            }
        }
        if (!found) { fallback(edge, object, limitedEdges.has(edge.edgeId) ? 'budget' : 'no_conjunction'); }
        if (index % 250 === 0) {
            // eslint-disable-next-line no-await-in-loop -- Yield bounded scan-only work without creating an estate-sized promise list.
            await new Promise<void>(resolve => { setTimeout(resolve, 0); });
        }
    }
    for (const group of groups.values()) {
        const members = [...group.members.values()]; const active = members.filter(member => !member.shadowed);
        const ids = active.map(member => member.object.objectId).sort();
        let reason: CrossStanzaPropsEvidence['reason'] = 'single_stanza'; let selected: Member | undefined;
        if (!available() || group.limited || nativeIndexLimited || members.length > maxVisits - visits) { reason = 'budget'; }
        else if (!options.catalogsComplete) { reason = 'incomplete_catalog'; }
        else if (active.some(member => !member.caseMatch)) { reason = 'case_ambiguous'; }
        else if (active.some(member => !member.valid)) { reason = 'binding_unverified'; }
        else if (new Set(active.map(member => member.object.fieldLineage!.stanza)).size !== active.length) { reason = 'binding_unverified'; }
        else if (new Set(active.map(member => member.object.fieldLineage!.stanza)).size >= 2) {
            const highestCategory = Math.max(...active.map(memberCategory));
            const peers = active.filter(member => memberCategory(member) === highestCategory);
            if (peers.length === 1) { [selected] = peers; reason = 'category'; }
            else if (peers.some(member => member.priority === null)) { reason = 'binding_unverified'; }
            else {
                peers.sort((a, b) => b.priority! - a.priority! || (a.object.fieldLineage!.stanza! < b.object.fieldLineage!.stanza! ? -1 : 1));
                [selected] = peers; reason = peers[0].priority !== peers[1].priority ? 'priority' : 'ascii';
            }
        }
        visits = Math.min(maxVisits, visits + members.length);
        for (const member of members) {
            const rowReason = member.shadowed ? 'same_stanza_shadow' : reason;
            let status: CrossStanzaPropsEvidence['status'] = 'unverified';
            if (selected && !member.shadowed) { status = selected === member ? 'highest' : 'lower'; }
            let basis: CrossStanzaPropsEvidence['reason'] = rowReason;
            if (selected && !member.shadowed && member !== selected) {
                if (memberCategory(member) !== memberCategory(selected)) { basis = 'category'; }
                else { basis = member.priority !== selected.priority ? 'priority' : 'ascii'; }
            }
            const row: CrossStanzaPropsEvidence = { version: 1, objectId: member.object.objectId, callerObjectId: group.scope.callerObjectId, app: group.scope.app,
                attribute: group.attribute, sourceLocation: group.scope.sourceLocation, selectors: group.scope.selectors.map(item => ({ ...item })), status, reason: basis,
                selectedObjectId: status === 'unverified' ? null : selected!.object.objectId, competingObjectIds: ids,
                stanzaPriority: member.priority, selectedPriority: status === 'unverified' ? null : selected!.priority };
            counts[`props_cross_stanza_${status}`] += 1; member.edges.forEach(edge => store(edge, row));
        }
    }
    counts.props_cross_stanza_visits = visits; counts.props_cross_stanza_groups = groups.size;
    counts.props_cross_stanza_stored_projections = records;
    counts.props_cross_stanza_truncated_edges = limitedEdges.size; counts.props_cross_stanza_truncated_objects = limitedObjects.size;
    const sorted = (rows?: Map<string, CrossStanzaPropsEvidence>): CrossStanzaPropsEvidence[] => [...(rows?.values() ?? [])].sort((a, b) => rowKey(a).localeCompare(rowKey(b)));
    return { counts, objects: objects.map(object => object.fieldLineage && object.fieldLineage.operation !== 'transform' ? { ...object,
        fieldLineage: { ...object.fieldLineage, crossStanzaProps: sorted(rowsByObject.get(object.objectId)), crossStanzaPropsTruncated: limitedObjects.has(object.objectId) } } : object),
        edges: edges.map(edge => rowsByEdge.has(edge.edgeId) || limitedEdges.has(edge.edgeId) ? { ...edge, fieldProvenance: { ...edge.fieldProvenance!,
            crossStanzaProps: sorted(rowsByEdge.get(edge.edgeId)), crossStanzaPropsTruncated: limitedEdges.has(edge.edgeId) } } : edge) };
}
