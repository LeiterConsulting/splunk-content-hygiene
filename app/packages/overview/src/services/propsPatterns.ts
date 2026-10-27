/* eslint-disable no-restricted-syntax -- Indexed candidates and DP cells have explicit work ceilings. */
import { FieldScope } from '../types';

export const PROPS_PATTERN_LENGTH = 256;
export const PROPS_PATTERN_VALUE = 1024;
export const PROPS_PATTERN_SOURCE_WORK = 2000000;
export const PROPS_PATTERN_SCAN_WORK = 20000000;
export interface PropsPatternBudget { remaining: number }
export interface PropsPattern {
    kind: 'literal' | 'pattern' | 'default' | 'unsupported';
    field: FieldScope['field']; value: string; prefix: string; tokens: string[];
}
export type PropsPatternMatch = 'match' | 'case_ambiguous' | 'no_match' | 'unsupported' | 'budget';
const ascii = (value: string): boolean => /^[\x20-\x7e]+$/.test(value);

/** Deliberately not a PCRE translator. Only literal ASCII, * and ... are
 * accepted. Ambiguous/encoded/Windows/regex scopes never become non-matches. */
export function compilePropsPattern(scope: FieldScope): PropsPattern {
    const base: PropsPattern = { kind: 'unsupported', field: scope.field, value: scope.value, prefix: '', tokens: [] };
    const { value } = scope;
    if (!value || value.trim() !== value || !ascii(value) || /[$+?()[\]{}|^\\]/.test(value) ||
        /%[\da-f]{2}/i.test(value) || /^(?:rule|delayedrule)::/.test(value)) { return base; }
    if (scope.field === 'sourcetype' && value === 'default') { return { ...base, kind: 'default' }; }
    if (!value.includes('*') && !value.includes('...')) { return { ...base, kind: 'literal', prefix: value.toLowerCase() }; }
    if (value.length > PROPS_PATTERN_LENGTH) { return base; }
    const tokens: string[] = []; let prefix = ''; let wildcard = false;
    for (let index = 0; index < value.length; index += 1) {
        let token = value[index];
        if (value.startsWith('...', index)) { token = '...'; index += 2; }
        if (token === '*' || token === '...') { wildcard = true; }
        else if (!wildcard) { prefix += token; }
        tokens.push(token);
    }
    return { ...base, kind: 'pattern', prefix: prefix.toLowerCase(), tokens };
}

function patternMatch(pattern: PropsPattern, value: string, insensitive: boolean, budgets: PropsPatternBudget[]): boolean | null {
    let previous = new Uint8Array(value.length + 1); previous[0] = 1;
    for (const token of pattern.tokens) {
        const work = value.length + 1;
        if (budgets.some(budget => budget.remaining < work)) { return null; }
        budgets.forEach(budget => { const counter = budget; counter.remaining -= work; });
        const next = new Uint8Array(value.length + 1);
        if (token === '*' || token === '...') {
            [next[0]] = previous;
            for (let index = 1; index <= value.length; index += 1) {
                const allowed = token === '...' || value[index - 1] !== '/' && value[index - 1] !== '\\';
                next[index] = previous[index] || Number(Boolean(next[index - 1] && allowed));
            }
        } else {
            const expected = insensitive ? token.toLowerCase() : token;
            for (let index = 1; index <= value.length; index += 1) {
                const actual = insensitive ? value[index - 1].toLowerCase() : value[index - 1];
                next[index] = Number(Boolean(previous[index - 1] && expected === actual));
            }
        }
        previous = next;
    }
    return Boolean(previous[value.length]);
}

/** A positive SPL selector is itself case-insensitive. Preserve case-only
 * possibilities, but do not promote them to a verified props scope match. */
export function matchPropsPattern(pattern: PropsPattern, selector: { field: FieldScope['field']; value: string },
    budgets: PropsPatternBudget[] = [{ remaining: PROPS_PATTERN_SOURCE_WORK }]): PropsPatternMatch {
    if (pattern.kind === 'unsupported') { return 'unsupported'; }
    if (pattern.kind === 'default') { return 'match'; }
    if (pattern.field !== selector.field) { return 'no_match'; }
    if (!ascii(selector.value) || selector.value.includes('\\')) { return 'unsupported'; }
    if (pattern.kind === 'literal') {
        if (pattern.value.toLowerCase() !== selector.value.toLowerCase()) { return 'no_match'; }
        return pattern.field === 'host' || pattern.value === selector.value ? 'match' : 'case_ambiguous';
    }
    if (selector.value.length > PROPS_PATTERN_VALUE) { return 'budget'; }
    const possible = patternMatch(pattern, selector.value, true, budgets);
    if (possible === null) { return 'budget'; }
    if (!possible) { return 'no_match'; }
    if (pattern.field === 'host') { return 'match'; }
    const strict = patternMatch(pattern, selector.value, false, budgets);
    if (strict === null) { return 'budget'; }
    return strict ? 'match' : 'case_ambiguous';
}

/** Prefix buckets avoid caller × estate scans. Yield before testing a pattern
 * so even failed/withheld candidates consume the caller's candidate budget. */
export function createPropsPatternIndex<T>(): {
    add: (scope: FieldScope, app: string, exported: boolean, item: T) => void;
    candidates: (selector: { field: FieldScope['field']; value: string }, app: string) => Generator<{ item: T; pattern: PropsPattern }>;
} {
    const exact = new Map<string, Array<{ item: T; pattern: PropsPattern }>>();
    const patterns = new Map<string, Array<{ item: T; pattern: PropsPattern }>>();
    const defaults = new Map<string, Array<{ item: T; pattern: PropsPattern }>>();
    return {
        add(scope, app, exported, item) {
            const pattern = compilePropsPattern(scope); if (pattern.kind === 'unsupported') { return; }
            let map = patterns;
            if (pattern.kind === 'literal') { map = exact; }
            else if (pattern.kind === 'default') { map = defaults; }
            for (const namespace of [`app:${app}`, ...(exported ? ['exported'] : [])]) {
                const key = pattern.kind === 'default' ? namespace : `${namespace}\0${pattern.field}\0${pattern.prefix}`;
                const rows = map.get(key) ?? []; rows.push({ item, pattern }); map.set(key, rows);
            }
        },
        *candidates(selector, app) {
            const value = selector.value.toLowerCase();
            for (const namespace of [`app:${app}`, 'exported']) {
                yield* exact.get(`${namespace}\0${selector.field}\0${value}`) ?? [];
                // Patterns cannot have a literal prefix longer than 256 chars.
                for (let length = 0; length <= Math.min(value.length, PROPS_PATTERN_LENGTH); length += 1) {
                    yield* patterns.get(`${namespace}\0${selector.field}\0${value.slice(0, length)}`) ?? [];
                }
                yield* defaults.get(namespace) ?? [];
            }
        },
    };
}

export function propsScopeLabel(scope: FieldScope | null): string {
    if (!scope) { return 'Not independently established'; }
    const pattern = compilePropsPattern(scope);
    if (pattern.kind === 'default') { return '[default] · potential shared fallback, not proven effective inheritance'; }
    const labels = { literal: 'literal scope', pattern: 'bounded * / ... pattern · potential match only', unsupported: 'unsupported pattern/encoded scope · unverified' };
    return `${scope.field}=${scope.value} · ${labels[pattern.kind]}`;
}
