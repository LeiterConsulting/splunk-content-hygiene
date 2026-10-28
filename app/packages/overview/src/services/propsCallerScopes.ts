/* eslint-disable no-restricted-syntax, no-continue -- Every inspected candidate and retained projection has a ceiling. */
import { ContentObject, FieldLineageFacts, PropsCallerWitness } from '../types';
import { createPropsPatternIndex, matchPropsPattern, PROPS_PATTERN_SCAN_WORK, PROPS_PATTERN_SOURCE_WORK } from './propsPatterns';

export const PROPS_CALLER_ROWS = 32;
export const PROPS_CALLER_BYTES = 32768;
export const PROPS_CALLER_SCOPES = 50000;
export const PROPS_CALLER_VISITS = 100000;
export const PROPS_CALLER_SOURCE_VISITS = 5000;
export const PROPS_CALLER_PROJECTIONS = 50000;
export const PROPS_CALLER_DECLARATIONS = 50000;
export const PROPS_CALLER_SCAN_BYTES = 16 * 1024 * 1024;
export const PROPS_CALLER_LIMITATION = 'Caller-conjunction indexing reached a work, visit or evidence-size ceiling; additional cross-dimension field paths remain unverified.';
export const propsCallerKey = (row: PropsCallerWitness): string => JSON.stringify([row.callerObjectId, row.app, row.sourceLocation, row.selectors]);
export const propsCallerBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;
const name = (value: unknown, max = 4096): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value &&
    !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

export function mergePropsCallerWitnesses(left: PropsCallerWitness[] = [], right: PropsCallerWitness[] = []): { rows: PropsCallerWitness[]; truncated: boolean } {
    const unique = new Map([...left, ...right].map(row => [propsCallerKey(row), row]));
    const rows: PropsCallerWitness[] = []; let size = 2; let truncated = false;
    for (const row of unique.values()) {
        const extra = propsCallerBytes(row) + 1;
        if (rows.length >= PROPS_CALLER_ROWS || size + extra > PROPS_CALLER_BYTES) { truncated = true; continue; }
        rows.push(row); size += extra;
    }
    return { rows, truncated };
}

/** Validate a compact scan receipt without parsing searches or replaying matching
 * on each cached page load. Unknown fields are discarded, not executed. */
export function readPropsCallerWitnesses(value: unknown): PropsCallerWitness[] | undefined {
    if (!Array.isArray(value) || !value.length || value.length > PROPS_CALLER_ROWS) { return undefined; }
    const rows: PropsCallerWitness[] = []; const seen = new Set<string>();
    for (const row of value as PropsCallerWitness[]) {
        if (!row || !name(row.callerObjectId, 16384) || !name(row.app) || !name(row.sourceLocation) || !Array.isArray(row.selectors) ||
            row.selectors.length < 2 || row.selectors.length > 3 || new Set(row.selectors.map(item => item?.field)).size !== row.selectors.length ||
            row.selectors.some(item => !item || !['source', 'host', 'sourcetype'].includes(item.field) || !name(item.value, 1024) ||
                !/^[\x20-\x7e]+$/.test(item.value) || /[$`*?+()[\]{}|^\\]/.test(item.value) || item.value.includes('...') || !name(item.sourceLocation))) { return undefined; }
        const clean: PropsCallerWitness = { callerObjectId: row.callerObjectId, app: row.app, sourceLocation: row.sourceLocation,
            selectors: row.selectors.map(item => ({ field: item.field, value: item.value, sourceLocation: item.sourceLocation })) };
        const key = propsCallerKey(clean); if (seen.has(key)) { return undefined; } seen.add(key); rows.push(clean);
    }
    return propsCallerBytes(rows) <= PROPS_CALLER_BYTES ? rows : undefined;
}

interface Declaration { object: ContentObject; facts: FieldLineageFacts }
/** Match captured callers to declarations once per scan using field/prefix/app
 * buckets. No event samples, regex execution or declaration Cartesian product. */
export function buildPropsCallerIndex(objects: ContentObject[], declarations: Declaration[], callers: PropsCallerWitness[],
    visible: (object: ContentObject, app: string) => boolean,
    limits: { visits?: number; projections?: number; work?: number; bytes?: number } = {}): {
        byObject: Map<string, PropsCallerWitness[]>; limitedObjects: Set<string>; limited: boolean; counts: Record<string, number>;
    } {
    const byId = new Map(objects.map(object => [object.objectId, object]));
    const index = createPropsPatternIndex<Declaration>();
    declarations.slice(0, PROPS_CALLER_DECLARATIONS).forEach(item => { if (item.facts.scope) { index.add(item.facts.scope, item.object.app, item.object.sharing === 'global', item); } });
    const byObject = new Map<string, PropsCallerWitness[]>(); const identities = new Map<string, Set<string>>(); const sizes = new Map<string, number>();
    const limitedObjects = new Set<string>(); let limited = callers.length > PROPS_CALLER_SCOPES || declarations.length > PROPS_CALLER_DECLARATIONS;
    let visits = 0; let projections = 0; let scopes = 0; let storedBytes = 0;
    const maxVisits = Math.max(0, Math.min(PROPS_CALLER_VISITS, limits.visits ?? PROPS_CALLER_VISITS));
    const maxProjections = Math.max(0, Math.min(PROPS_CALLER_PROJECTIONS, limits.projections ?? PROPS_CALLER_PROJECTIONS));
    const maxBytes = Math.max(0, Math.min(PROPS_CALLER_SCAN_BYTES, limits.bytes ?? PROPS_CALLER_SCAN_BYTES));
    const work = { remaining: Math.max(0, Math.min(PROPS_PATTERN_SCAN_WORK, limits.work ?? PROPS_PATTERN_SCAN_WORK)) };
    const initialWork = work.remaining;
    const collect = (): void => { for (const caller of callers.slice(0, PROPS_CALLER_SCOPES)) {
        const source = byId.get(caller.callerObjectId);
        // The scan parser supplies these receipts. Validate the fixed identity,
        // grammar projection and size again at this boundary, not from cache.
        const [clean] = readPropsCallerWitnesses([caller]) ?? [];
        if (!clean || !source || source.app !== caller.app || !['Saved Search', 'Report', 'Alert', 'Dashboard'].includes(source.objectType)) { continue; }
        scopes += 1; let sourceVisits = 0; const ownWork = { remaining: PROPS_PATTERN_SOURCE_WORK }; const key = propsCallerKey(clean);
        for (const selector of clean.selectors) {
            for (const { item, pattern } of index.candidates(selector, clean.app)) {
                if (visits >= maxVisits || projections >= maxProjections || work.remaining <= 0) { limited = true; return; }
                if (sourceVisits >= PROPS_CALLER_SOURCE_VISITS) { limited = true; break; }
                visits += 1; sourceVisits += 1;
                // Defaults already use their domain contract; cross-dimension
                // evidence must independently select each concrete dimension.
                if (pattern.kind === 'default') { continue; }
                const match = matchPropsPattern(pattern, selector, [ownWork, work]);
                if (match === 'budget') { limited = true; break; }
                if (match !== 'match' || !visible(item.object, clean.app)) { continue; }
                const id = item.object.objectId; const seen = identities.get(id) ?? new Set<string>();
                if (seen.has(key)) { continue; }
                const rows = byObject.get(id) ?? []; const size = propsCallerBytes(clean) + 1;
                if (storedBytes + size > maxBytes) { limited = true; return; }
                if (rows.length >= PROPS_CALLER_ROWS || (sizes.get(id) ?? 2) + size > PROPS_CALLER_BYTES) { limitedObjects.add(id); continue; }
                rows.push(clean); seen.add(key); byObject.set(id, rows); identities.set(id, seen); sizes.set(id, (sizes.get(id) ?? 2) + size); projections += 1; storedBytes += size;
            }
        }
    } }; collect();
    return { byObject, limitedObjects, limited, counts: { props_caller_scopes: scopes, props_caller_visits: visits,
        props_caller_projections: projections, props_caller_index_bytes: storedBytes, props_caller_edge_bytes: 0,
        props_caller_work: initialWork - work.remaining, props_caller_index_limited: Number(limited || limitedObjects.size > 0) } };
}
