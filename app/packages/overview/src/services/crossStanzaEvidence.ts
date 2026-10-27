import { CrossStanzaPropsEvidence } from '../types';

export const CROSS_STANZA_ROWS = 32;
export const CROSS_STANZA_BYTES = 32768;
export const crossStanzaStatusLabels: Record<CrossStanzaPropsEvidence['status'], string> = {
    highest: 'Highest captured precedence (conditional)', lower: 'Lower captured precedence (possible fallback)', unverified: 'Unverified',
};
export const crossStanzaReasonLabels: Record<CrossStanzaPropsEvidence['reason'], string> = {
    category: 'For the same attribute and matching event, source precedes host, then sourcetype. Numeric priority never overrides a different category.',
    priority: 'Within the same category, the larger native numeric priority precedes the other captured literal stanza.',
    ascii: 'Within the same category and priority, the earlier ASCII stanza name precedes the other captured literal stanza.',
    single_stanza: 'Fewer than two distinct captured, verified literal stanzas can be compared. This is not proof that no other matching configuration exists.',
    no_conjunction: 'No supported single original-event selector conjunction was retained for this relationship. Unsupported syntax, separate queries, runtime expansion or parser ceilings remain unverified; independent selectors are never combined.',
    binding_unverified: 'A required native binding or priority observation is unavailable, changed, ambiguous or truncated. No highest binding is inferred.',
    case_ambiguous: 'The selector and case-sensitive source/sourcetype spelling do not agree exactly, or literal ASCII scope is unsupported. Possible matching remains unverified.',
    budget: 'A cross-stanza work, time, candidate or evidence-size ceiling was reached. Additional comparisons remain unverified.',
    incomplete_catalog: 'The shared props catalogs are incomplete. No highest captured binding is inferred.',
    same_stanza_shadow: 'This declaration is already shadowed within the same exact stanza/app context; it is not a separate cross-stanza winner.',
};
export const CROSS_STANZA_LIMITATION = 'Conditional order among captured shared exact stanzas for one declared initial-search conjunction, not full effective props or proof an event matches. Source and sourcetype matching are case-sensitive; host matching is case-insensitive. Patterns, defaults, sourcetype rewrites, private/system/file layers, field availability, runtime activation and execution remain unverified. Different attribute names are not competing settings. All possible paths remain in the graph; removing an override may expose a fallback.';
const name = (value: unknown, max = 4096): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value &&
    !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const priority = (value: unknown): value is number | null => value === null || typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1000000000;
export function readCrossStanzaProps(value: unknown): CrossStanzaPropsEvidence[] | undefined {
    if (!Array.isArray(value) || value.length > CROSS_STANZA_ROWS) { return undefined; }
    const seen = new Set<string>(); const rows: CrossStanzaPropsEvidence[] = []; let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
        const row = value[index] as CrossStanzaPropsEvidence;
        if (!row || row.version !== 1 || !name(row.objectId, 16384) || !name(row.callerObjectId, 16384) || !name(row.app) || !name(row.attribute) || !name(row.sourceLocation) ||
            !Object.prototype.hasOwnProperty.call(crossStanzaStatusLabels, row.status) || !Object.prototype.hasOwnProperty.call(crossStanzaReasonLabels, row.reason) ||
            !Array.isArray(row.selectors) || row.selectors.length > 3 || row.selectors.some(item => !item || !['sourcetype', 'host', 'source'].includes(item.field) || !name(item.value) || !name(item.sourceLocation)) ||
            new Set(row.selectors.map(item => item.field)).size !== row.selectors.length || !Array.isArray(row.competingObjectIds) || row.competingObjectIds.length > 16 ||
            row.competingObjectIds.some(id => !name(id, 16384)) || new Set(row.competingObjectIds).size !== row.competingObjectIds.length ||
            !priority(row.stanzaPriority) || !priority(row.selectedPriority) ||
            (row.status === 'unverified' ? row.selectedObjectId !== null || row.selectedPriority !== null || ['category', 'priority', 'ascii'].includes(row.reason) :
                !name(row.selectedObjectId, 16384) || !row.selectors.length || !['category', 'priority', 'ascii'].includes(row.reason) ||
                row.competingObjectIds.length < 2 || !row.competingObjectIds.includes(row.objectId) || !row.competingObjectIds.includes(row.selectedObjectId) ||
                ['priority', 'ascii'].includes(row.reason) && (row.stanzaPriority === null || row.selectedPriority === null || row.stanzaPriority > row.selectedPriority || row.reason === 'ascii' && row.stanzaPriority !== row.selectedPriority) ||
                (row.status === 'highest') !== (row.objectId === row.selectedObjectId))) { return undefined; }
        const projected: CrossStanzaPropsEvidence = { version: 1, objectId: row.objectId, callerObjectId: row.callerObjectId, app: row.app, attribute: row.attribute,
            sourceLocation: row.sourceLocation, selectors: row.selectors.map(item => ({ field: item.field, value: item.value, sourceLocation: item.sourceLocation })),
            status: row.status, reason: row.reason, selectedObjectId: row.selectedObjectId, competingObjectIds: [...row.competingObjectIds],
            stanzaPriority: row.stanzaPriority, selectedPriority: row.selectedPriority };
        const key = JSON.stringify([row.objectId, row.callerObjectId, row.app, row.attribute, row.sourceLocation]);
        bytes += new TextEncoder().encode(JSON.stringify(projected)).length;
        if (seen.has(key) || bytes > CROSS_STANZA_BYTES) { return undefined; } seen.add(key); rows.push(projected);
    }
    return rows;
}
