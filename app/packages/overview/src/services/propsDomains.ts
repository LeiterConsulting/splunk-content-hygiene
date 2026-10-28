/* eslint-disable no-continue -- Product states have explicit ceilings. */
import { FieldScope, PropsDomainEvidence } from '../types';
import { compilePropsPattern, matchPropsPattern, PropsPattern, PropsPatternBudget, PROPS_PATTERN_SOURCE_WORK } from './propsPatterns';

export const PROPS_DOMAIN_PAIR_STATES = 65536;
export const PROPS_DOMAIN_SOURCE_WORK = 2000000;
export const PROPS_DOMAIN_SCAN_WORK = 20000000;
export type PropsDomainResult = PropsDomainEvidence['basis'] | 'disjoint' | 'unsupported' | 'different_field' | 'budget';
const wildcard = (token: string): boolean => token === '*' || token === '...';
const allows = (token: string, literal: string): boolean => token === '...' || token === '*' && literal !== '/' && literal !== '\\';

/** Nonempty language intersection, not event matching or a PCRE interpreter.
 * A state is a pair of token offsets plus whether a character was consumed.
 * Wildcards have epsilon exits and consuming loops; no candidate text is run. */
function intersects(left: PropsPattern, right: PropsPattern, budgets: PropsPatternBudget[]): boolean | null {
    const a = left.tokens; const b = right.tokens; const width = b.length + 1;
    const queue: Array<[number, number, boolean]> = [[0, 0, false]];
    const seen = new Set<number>([0]);
    const push = (i: number, j: number, consumed: boolean): void => {
        const key = (i * width + j) * 2 + Number(consumed);
        if (!seen.has(key)) { seen.add(key); queue.push([i, j, consumed]); }
    };
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        if (cursor >= PROPS_DOMAIN_PAIR_STATES || budgets.some(budget => budget.remaining <= 0)) { return null; }
        budgets.forEach(budget => { const counter = budget; counter.remaining -= 1; });
        const [i, j, consumed] = queue[cursor];
        if (i === a.length && j === b.length && consumed) { return true; }
        const x = a[i]; const y = b[j];
        if (x !== undefined && wildcard(x)) { push(i + 1, j, consumed); }
        if (y !== undefined && wildcard(y)) { push(i, j + 1, consumed); }
        if (x === undefined || y === undefined) { continue; }
        const xx = left.field === 'host' ? x.toLowerCase() : x;
        const yy = right.field === 'host' ? y.toLowerCase() : y;
        if (wildcard(x) && wildcard(y) || wildcard(x) && allows(x, y) || wildcard(y) && allows(y, x) || xx === yy) {
            push(wildcard(x) ? i : i + 1, wildcard(y) ? j : j + 1, true);
        }
    }
    return false;
}

/** Different dimensions can coexist, but without a captured conjunction that
 * possibility alone must not create field-name joins across the whole estate. */
export function comparePropsDomains(consumer: FieldScope, producer: FieldScope,
    budgets: PropsPatternBudget[] = [{ remaining: PROPS_PATTERN_SOURCE_WORK }]): PropsDomainResult {
    const left = compilePropsPattern(consumer); const right = compilePropsPattern(producer);
    if (left.kind === 'unsupported' || right.kind === 'unsupported') { return 'unsupported'; }
    if (left.kind === 'default' || right.kind === 'default') { return 'captured_default'; }
    if (left.field !== right.field) { return 'different_field'; }
    if (left.kind === 'literal' && right.kind === 'literal') {
        const same = left.field === 'host' ? left.value.toLowerCase() === right.value.toLowerCase() : left.value === right.value;
        return same ? 'same_literal' : 'disjoint';
    }
    if (left.kind === 'literal' || right.kind === 'literal') {
        const pattern = left.kind === 'pattern' ? left : right;
        const literal = left.kind === 'literal' ? left : right;
        const result = matchPropsPattern(pattern, literal, budgets);
        if (result === 'match') { return 'bounded_intersection'; }
        return result === 'case_ambiguous' || result === 'no_match' ? 'disjoint' : result;
    }
    // Incompatible literal prefixes cannot intersect. This is strict for source
    // and sourcetype, ASCII-insensitive only for host, like the full comparison.
    const prefix = (pattern: PropsPattern): string => pattern.tokens.slice(0, pattern.tokens.findIndex(wildcard)).join('');
    const p = left.field === 'host' ? left.prefix : prefix(left);
    const q = right.field === 'host' ? right.prefix : prefix(right);
    if (!p.startsWith(q) && !q.startsWith(p)) { return 'disjoint'; }
    const result = intersects(left, right, budgets);
    if (result === null) { return 'budget'; }
    return result ? 'bounded_intersection' : 'disjoint';
}

export function propsDomainLabel(basis: PropsDomainEvidence['basis']): string {
    return { same_literal: 'Same literal event scope', bounded_intersection: 'Overlapping bounded declaration patterns',
        captured_default: 'Captured shared default fallback', captured_conjunction: 'Both scopes selected by one captured caller conjunction' }[basis];
}
