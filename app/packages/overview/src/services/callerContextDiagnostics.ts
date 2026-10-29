import { utf8ToBytes } from '@noble/hashes/utils.js';
import { CallerContextQuery, CallerContextReason, CallerContextSummary, ContentObject, PropsEventScope } from '../types';
import { evidenceDigest } from './evidenceDigest';

interface ScopeToken { value: string; offset: number; quoted?: boolean; macro?: boolean; valueQuoted?: boolean }
export const CALLER_CONTEXT_ROWS = 64;
export const CALLER_CONTEXT_BYTES = 64 * 1024;
export const CALLER_CONTEXT_SCAN_BYTES = 8 * 1024 * 1024;
export const CALLER_CONTEXT_POLICY = 'initial-conjunction-v1' as const;
export const callerContextSize = (value: unknown): number => utf8ToBytes(JSON.stringify(value)).length;
export const CALLER_CONTEXT_LIMITATION = 'These are captured static parser diagnostics, not execution evidence or a complete consumer inventory. The first rejection is not the only possible blocker. Observed syntax features can overlap; removing one does not establish a valid caller. Edges, confidence, removal readiness and saved decisions are unchanged.';
export const callerContextOutcomeLabels = { retained: 'Retained static conjunction', withheld: 'Context withheld', post_process: 'Post-process / chain excluded' };
export const callerContextLabels: Record<CallerContextReason, string> = {
    malformed_lexical: 'Unterminated quoted text, macro or comment', source_location_limit: 'Query location exceeds the diagnostic limit',
    no_initial_clause: 'No independent initial search clause', initial_token_limit: 'Initial search exceeds the token budget',
    escaped_initial_clause: 'Escaping in the initial clause is outside this grammar', macro_invocation: 'Initial clause invokes a macro',
    standalone_quoted_term: 'Standalone quoted term is outside this grammar', subsearch: 'Initial clause contains subsearch syntax',
    grouping_or_list_punctuation: 'Initial clause contains grouping or list syntax', malformed_conjunction: 'Conjunction is incomplete or unsupported',
    positive_or: 'OR branches are not composed into caller receipts', negation: 'Negated terms do not establish a positive conjunction',
    in_operator: 'IN alternatives are not composed into caller receipts', dynamic_term: 'Initial clause contains a dynamic term',
    bare_or_unsupported_initial_term: 'Bare term or command is outside the supported initial conjunction',
    invalid_assignment_value: 'Assignment value is missing or unsupported', pattern_or_nonliteral_selector: 'Event selector is a pattern or nonliteral value',
    contradictory_selector: 'One selector has conflicting literal values', no_context_selector: 'No exact initial host, source or sourcetype selector established',
    source_limit: 'Query exceeds the source parse budget',
};
export function callerContextNextCheck(reason: CallerContextReason | null): string {
    if (reason === 'macro_invocation') { return 'Inspect the uniquely resolved macro definition and invocation app/arity. Dynamic, eval, parameterized, hidden or cyclic definitions remain unverified; no macro is expanded here.'; }
    if (reason === 'dynamic_term') { return 'Confirm token/input values and the invocation namespace with the owner. Do not substitute guessed values or treat runtime inputs as a fixed event domain.'; }
    if (['positive_or', 'in_operator', 'grouping_or_list_punctuation', 'negation', 'contradictory_selector'].includes(reason ?? '')) {
        return 'Review each branch independently in the source definition. Do not combine selectors from separate branches or treat negation as a positive caller.';
    }
    if (reason === 'pattern_or_nonliteral_selector') { return 'Verify the intended event domain and effective props in the invoking app. A pattern match alone does not prove field availability or execution.'; }
    if (reason === 'no_context_selector' || reason === 'no_initial_clause' || reason === 'bare_or_unsupported_initial_term') {
        return 'Inspect the event-producing base query or upstream data source. A missing literal selector is not proof that no implicit consumers exist.';
    }
    if (reason === 'source_limit' || reason === 'initial_token_limit' || reason === 'source_location_limit') {
        return 'Inspect the exact source location manually. A safety ceiling leaves remaining context unknown; do not increase confidence from omitted evidence.';
    }
    if (!reason) { return 'Confirm invocation permissions, effective props and runtime field availability separately. A retained conjunction is static metadata, not observed use.'; }
    return 'Inspect the source definition at the captured query offset and confirm its meaning with the owner. Do not execute customer SPL to resolve this diagnostic.';
}
export function callerContextGuidance(row: CallerContextQuery): { sourceLocation: string; queryDigest: string; explanation: string; observedFeatures: string[]; nextCheck: string } {
    return { sourceLocation: row.sourceLocation, queryDigest: row.queryDigest,
        explanation: row.firstRejection ? callerContextLabels[row.firstRejection] : callerContextOutcomeLabels[row.outcome],
        observedFeatures: row.features.map(reason => callerContextLabels[reason]),
        nextCheck: row.outcome === 'post_process' ? 'Excluded as an independent original-event caller. Inspect its base search/data source; selectors here are not promoted to caller evidence.' : callerContextNextCheck(row.firstRejection) };
}

export function emptyCallerContext(state: CallerContextSummary['state'] = 'recorded'): CallerContextSummary {
    return { version: 1, policy: CALLER_CONTEXT_POLICY, state, counts: { queries: 0, retained: 0, withheld: 0, postProcess: 0 },
        rows: [], limited: state === 'budget', sourceIncomplete: state === 'unavailable' };
}
export function mergeCallerContext(target: CallerContextSummary, addition: CallerContextSummary, postProcess = false): void {
    const summary = target;
    summary.counts.queries += addition.counts.queries;
    summary.counts.retained += postProcess ? 0 : addition.counts.retained;
    summary.counts.withheld += postProcess ? 0 : addition.counts.withheld;
    summary.counts.postProcess += postProcess ? addition.counts.queries : addition.counts.postProcess;
    summary.limited ||= addition.limited;
    summary.sourceIncomplete ||= addition.sourceIncomplete;
    addition.rows.forEach(original => {
        const row: CallerContextQuery = postProcess ? { ...original, outcome: 'post_process', firstRejection: null, offset: null, features: [], selectorMentioned: false } : original;
        if (summary.rows.length >= CALLER_CONTEXT_ROWS || callerContextSize({ ...summary, rows: [...summary.rows, row] }) > CALLER_CONTEXT_BYTES - 1024) {
            summary.limited = true;
        } else { summary.rows.push(row); }
    });
}

function syntaxFeatures(clause: ScopeToken[], escaped: boolean, malformed: boolean): CallerContextReason[] {
    const result = new Set<CallerContextReason>();
    if (escaped) { result.add('escaped_initial_clause'); }
    if (malformed) { result.add('malformed_lexical'); }
    clause.slice(0, 512).forEach((token, index) => {
        if (token.macro) { result.add('macro_invocation'); return; }
        if (token.quoted) { return; }
        if (/[$`{}]/.test(token.value)) { result.add('dynamic_term'); }
        if (!token.valueQuoted) {
            const upper = token.value.toUpperCase();
            if (upper === 'OR') { result.add('positive_or'); }
            if (upper === 'NOT' || /^[A-Za-z_][\w.:-]*!=/.test(token.value)) { result.add('negation'); }
            if (upper === 'IN') { result.add('in_operator'); }
            if (['[', ']'].includes(token.value)) { result.add('subsearch'); }
            if (['(', ')', ','].includes(token.value)) { result.add('grouping_or_list_punctuation'); }
        }
        const assignment = token.value.match(/^(sourcetype|host|source)=(.*)$/);
        const separated = /^(sourcetype|host|source)$/.test(token.value) && clause[index + 1]?.value === '=';
        let value: string | undefined;
        if (assignment) { value = assignment[2] || clause[index + 1]?.value; }
        else if (separated) { value = clause[index + 2]?.value; }
        if (value && (/[*?+()[\]{}|^\\]/.test(value) || value.includes('...'))) { result.add('pattern_or_nonliteral_selector'); }
    });
    return [...result];
}

/** The original narrow guards, now returning explanations alongside identical
 * scopes. No expression evaluation, branch union or macro expansion. */
export function inspectPropsEventScope(tokens: ScopeToken[], sourceLocation: string, malformed: boolean, sourceText: string): {
    scopes: PropsEventScope[]; diagnostics: CallerContextSummary;
} {
    const end = tokens.findIndex(token => token.value === '|' && !token.quoted);
    const clause = tokens.slice(0, end < 0 ? tokens.length : end);
    const escaped = sourceText.slice(0, end < 0 ? sourceText.length : tokens[end].offset).includes('\\');
    const features = syntaxFeatures(clause, escaped, malformed);
    const selectorMentioned = clause.slice(0, 512).some(token => !token.quoted && !token.macro && /^(sourcetype|host|source)(=|$)/.test(token.value));
    const queryDigest = evidenceDigest(sourceText);
    const result = (scopes: PropsEventScope[], reason: CallerContextReason | null, offset: number | null = null): ReturnType<typeof inspectPropsEventScope> => {
        const diagnostics = emptyCallerContext(); diagnostics.counts.queries = 1;
        if (scopes.length) { diagnostics.counts.retained = 1; } else { diagnostics.counts.withheld = 1; }
        if (sourceLocation.length > 4096) { diagnostics.limited = true; }
        else { diagnostics.rows.push({ sourceLocation, queryDigest, outcome: scopes.length ? 'retained' : 'withheld', firstRejection: reason, offset, features, selectorMentioned }); }
        return { scopes, diagnostics };
    };
    if (malformed) { return result([], 'malformed_lexical'); }
    if (sourceLocation.length > 4096) { return result([], 'source_location_limit'); }
    if (!clause.length) { return result([], 'no_initial_clause'); }
    if (clause.length > 512) { return result([], 'initial_token_limit'); }
    if (escaped) { return result([], 'escaped_initial_clause'); }
    let start = 0;
    if (!clause[0].quoted && clause[0].value.toLowerCase() === 'search') { start = 1; }
    const selectors: PropsEventScope['selectors'] = [];
    const values = new Map<string, string>(); let terms = 0; let and = false;
    for (let index = start; index < clause.length; index += 1) {
        const token = clause[index];
        if (token.macro) { return result([], 'macro_invocation', token.offset); }
        if (token.quoted) { return result([], 'standalone_quoted_term', token.offset); }
        if (/[[\](),]/.test(token.value) && !token.valueQuoted) { return result([], ['[', ']'].includes(token.value) ? 'subsearch' : 'grouping_or_list_punctuation', token.offset); }
        if (token.value.toUpperCase() === 'AND') {
            if (!terms || and || index === clause.length - 1) { return result([], 'malformed_conjunction', token.offset); } and = true;
            // eslint-disable-next-line no-continue -- Validated conjunction has no selector.
            continue;
        }
        const assignment = token.value.match(/^([A-Za-z_][\w.:-]*)=(.*)$/);
        let field = assignment?.[1]; let value = assignment?.[2]; let location = token.offset;
        if (!assignment && /^[A-Za-z_][\w.:-]*$/.test(token.value) && clause[index + 1]?.value === '=') {
            field = token.value; value = clause[index + 2]?.value; location = clause[index + 2]?.offset ?? token.offset; index += 2;
        } else if (assignment && !value) { index += 1; value = clause[index]?.value; location = clause[index]?.offset ?? token.offset; }
        if (!field || !value || value.length > 4096 || value.trim() !== value || /[$`{}]/.test(value) ||
            Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
            !assignment?.[2] && !clause[index]?.quoted && /^(AND|OR|NOT|IN|CASE|TERM)$|^[|[\](),]$/i.test(value)) {
            const keyword = token.value.toUpperCase();
            let reason: CallerContextReason = 'invalid_assignment_value';
            if (keyword === 'OR') { reason = 'positive_or'; }
            else if (keyword === 'NOT' || token.value.includes('!=')) { reason = 'negation'; }
            else if (keyword === 'IN' || clause[index + 1]?.value.toUpperCase() === 'IN') { reason = 'in_operator'; }
            else if (typeof value === 'string' && /[$`{}]/.test(value)) { reason = 'dynamic_term'; }
            else if (!field) { reason = 'bare_or_unsupported_initial_term'; }
            return result([], reason, token.offset);
        }
        terms += 1; and = false;
        if (['sourcetype', 'host', 'source'].includes(field)) {
            if (/[*?+()[\]{}|^\\]/.test(value) || value.includes('...')) { return result([], 'pattern_or_nonliteral_selector', location); }
            if (values.has(field) && values.get(field) !== value) { return result([], 'contradictory_selector', location); }
            if (!values.has(field)) { selectors.push({ field: field as 'sourcetype' | 'host' | 'source', value, sourceLocation: `${sourceLocation}:${location}` }); values.set(field, value); }
        }
    }
    return selectors.length ? result([{ sourceLocation, selectors }], null) : result([], 'no_context_selector');
}

export function readCallerContext(value: unknown): CallerContextSummary | undefined {
    if (!value || typeof value !== 'object' || callerContextSize(value) > CALLER_CONTEXT_BYTES) { return undefined; }
    const data = value as CallerContextSummary;
    if (data.version !== 1 || data.policy !== CALLER_CONTEXT_POLICY || !['recorded', 'unavailable', 'budget'].includes(data.state) ||
        typeof data.limited !== 'boolean' || typeof data.sourceIncomplete !== 'boolean' || !data.counts ||
        !['queries', 'retained', 'withheld', 'postProcess'].every(key => Number.isSafeInteger(data.counts[key as keyof typeof data.counts]) && data.counts[key as keyof typeof data.counts] >= 0) ||
        data.counts.queries !== data.counts.retained + data.counts.withheld + data.counts.postProcess ||
        !Array.isArray(data.rows) || data.rows.length > CALLER_CONTEXT_ROWS || data.rows.length > data.counts.queries ||
        !data.limited && data.rows.length !== data.counts.queries || data.state === 'budget' && !data.limited) { return undefined; }
    if (data.rows.some(row => !row || typeof row.sourceLocation !== 'string' || row.sourceLocation.length > 4096 ||
        typeof row.queryDigest !== 'string' || !/^[a-f0-9]{64}$/.test(row.queryDigest) || !['retained', 'withheld', 'post_process'].includes(row.outcome) ||
        row.firstRejection !== null && (typeof row.firstRejection !== 'string' || !Object.prototype.hasOwnProperty.call(callerContextLabels, row.firstRejection)) ||
        row.offset !== null && (!Number.isSafeInteger(row.offset) || row.offset < 0 || row.offset > 1024 * 1024) ||
        typeof row.selectorMentioned !== 'boolean' || !Array.isArray(row.features) || row.features.length > 20 ||
        new Set(row.features).size !== row.features.length || row.features.some(reason => typeof reason !== 'string' || !Object.prototype.hasOwnProperty.call(callerContextLabels, reason)) ||
        (row.outcome === 'withheld') !== (row.firstRejection !== null) || row.outcome !== 'withheld' && row.offset !== null)) { return undefined; }
    if (['retained', 'withheld', 'post_process'].some(outcome => data.rows.filter(row => row.outcome === outcome).length >
        data.counts[outcome === 'post_process' ? 'postProcess' : outcome as 'retained' | 'withheld'])) { return undefined; }
    // Whitelist fields: cache corruption must not expose appended raw text.
    return { version: 1, policy: CALLER_CONTEXT_POLICY, state: data.state, counts: { queries: data.counts.queries, retained: data.counts.retained,
        withheld: data.counts.withheld, postProcess: data.counts.postProcess }, limited: data.limited, sourceIncomplete: data.sourceIncomplete,
        rows: data.rows.map(row => ({ sourceLocation: row.sourceLocation, queryDigest: row.queryDigest, outcome: row.outcome,
            firstRejection: row.firstRejection, offset: row.offset, features: [...row.features], selectorMentioned: row.selectorMentioned })) };
}

export function callerContextReport(object: ContentObject): {
    version: 1; objectId: string; app: string; inventoryScanId: string | null; configurationDigest: string | null;
    state: 'not_recorded' | CallerContextSummary['state']; diagnostics: CallerContextSummary | null;
    guidance: Array<ReturnType<typeof callerContextGuidance>>; limitation: string;
} {
    return { version: 1, objectId: object.objectId, app: object.app, inventoryScanId: object.inventoryScanId ?? null,
        configurationDigest: object.configurationFingerprint?.digest ?? object.reviewEvidence?.configuration?.digest ?? null, state: object.callerContext?.state ?? 'not_recorded',
        diagnostics: object.callerContext ?? null, guidance: (object.callerContext?.rows ?? []).map(callerContextGuidance), limitation: CALLER_CONTEXT_LIMITATION };
}
export function callerContextCsv(object: ContentObject): { columns: string[]; rows: Array<Array<string | number | boolean>> } {
    const report = callerContextReport(object);
    return { columns: ['Object ID', 'App', 'Inventory scan ID', 'Configuration digest', 'Diagnostic state', 'Diagnostic policy', 'Queries', 'Retained', 'Withheld', 'Post-process excluded',
        'Limited', 'Source incomplete', 'Query location', 'Query digest', 'Outcome', 'First rejection', 'Query offset (UTF-16)', 'Observed syntax features', 'Selector mentioned', 'Next verification', 'Limitation', 'Explanation', 'Observed feature explanations'],
    rows: (report.diagnostics?.rows.length ? report.diagnostics.rows : [null]).map(row => [report.objectId, report.app, report.inventoryScanId ?? '', report.configurationDigest ?? '',
        report.state, report.diagnostics?.policy ?? '', report.diagnostics?.counts.queries ?? '', report.diagnostics?.counts.retained ?? '', report.diagnostics?.counts.withheld ?? '', report.diagnostics?.counts.postProcess ?? '',
        report.diagnostics?.limited ?? '', report.diagnostics?.sourceIncomplete ?? '', row?.sourceLocation ?? '', row?.queryDigest ?? '', row?.outcome ?? '', row?.firstRejection ?? '', row?.offset ?? '',
        JSON.stringify(row?.features ?? []), row?.selectorMentioned ?? '', row ? callerContextGuidance(row).nextCheck : '', report.limitation,
        row ? callerContextGuidance(row).explanation : '', JSON.stringify(row ? callerContextGuidance(row).observedFeatures : [])]) };
}
