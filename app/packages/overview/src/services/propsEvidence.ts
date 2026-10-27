import { PropsContextEvidence } from '../types';

export const PROPS_CONTEXT_LIMIT = 256;
export const propsStatusLabels: Record<PropsContextEvidence['status'], string> = {
    local: 'Local merged match', inherited: 'Inherited merged match', shadowed: 'Shadowed in this context', unverified: 'Unverified',
};
export const propsReasonLabels: Record<PropsContextEvidence['reason'], string> = {
    matched: 'The native rule binding and merged props attribute agree with this captured shared definition.',
    different_binding: 'The native handlers agree on a different captured shared definition. This path is a possible fallback, not the currently returned binding.',
    not_returned: 'A native handler did not return the requested attribute. Absence is not proof that no runtime dependency exists.',
    access_denied: 'Native read access was denied; no broader permissions were requested.',
    snapshot_changed: 'Native values or access metadata differ from the captured scan. Run a new complete scan before relying on this context.',
    metadata_mismatch: 'The handlers, namespace, identity or shared visibility do not agree. No winning declaration is inferred.',
    unsupported_scope: 'Unsupported PCRE, modifier, escaped, encoded, non-ASCII or oversized props scope; effective inheritance is not inferred.',
    budget: 'The bounded context-check budget was reached. This context remains unverified.',
    request_failed: 'A native metadata read failed. No shared binding is inferred.',
};
export const PROPS_CONTEXT_LIMITATION = 'Shared stanza observation only, in the nobody/app REST namespace, including supported literal, bounded * / ... pattern and captured default stanzas. It does not establish per-file local/default origin, user/private or system inheritance, complete cross-stanza priority, field availability, activation in memory or runtime execution. Sequential reads are not an atomic configuration transaction. Shadowed and default paths are retained because removing an override can expose a fallback.';
const name = (value: unknown, max = 16384): value is string => typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.trim() === value && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
export function readPropsContexts(value: unknown): PropsContextEvidence[] | undefined {
    if (!Array.isArray(value) || value.length > PROPS_CONTEXT_LIMIT) { return undefined; }
    const seen = new Set<string>(); const result: PropsContextEvidence[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const row = value[index] as PropsContextEvidence;
        if (!row || row.version !== 1 || !name(row.objectId) || !name(row.app, 4096) ||
            !Object.prototype.hasOwnProperty.call(propsStatusLabels, row.status) || !Object.prototype.hasOwnProperty.call(propsReasonLabels, row.reason) ||
            row.selectedObjectId !== null && !name(row.selectedObjectId) || row.valueDigest !== null && !/^[a-f0-9]{64}$/.test(row.valueDigest) ||
            row.stanzaPriority !== undefined && row.stanzaPriority !== null && (!Number.isFinite(row.stanzaPriority) || typeof row.stanzaPriority !== 'number' || Math.abs(row.stanzaPriority) > 1000000000 || row.status === 'unverified') ||
            (row.status === 'unverified' ? row.selectedObjectId !== null || row.valueDigest !== null || ['matched', 'different_binding'].includes(row.reason) :
                row.selectedObjectId === null || row.valueDigest === null || row.reason !== (row.status === 'shadowed' ? 'different_binding' : 'matched') ||
                (row.status === 'shadowed') === (row.objectId === row.selectedObjectId))) { return undefined; }
        const key = `${row.objectId}\0${row.app}`;
        if (seen.has(key)) { return undefined; } seen.add(key);
        result.push({ version: 1, objectId: row.objectId, app: row.app, status: row.status,
            selectedObjectId: row.selectedObjectId, valueDigest: row.valueDigest, reason: row.reason,
            ...(row.stanzaPriority !== undefined ? { stanzaPriority: row.stanzaPriority } : {}) });
    }
    return result;
}
