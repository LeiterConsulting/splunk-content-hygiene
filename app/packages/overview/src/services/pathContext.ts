/* eslint-disable no-restricted-syntax, no-continue -- All cached-evidence loops have explicit ceilings. */
import { ContentObject, DependencyEdge, FieldScope, PropsCallerWitness } from '../types';
import { isPotentialRelation } from '../utils/dependencySemantics';
import { propsCallerBytes, propsCallerKey, readPropsCallerWitnesses } from './propsCallerScopes';

export type PathContextStatus = 'static_only' | 'app_only' | 'shared_caller' | 'mixed' | 'unverified' | 'bounded';
export type PathContextReason = 'different_apps' | 'different_callers' | 'caller_entry' | 'missing_context' |
    'invoking_app' | 'scope_unverified' | 'disconnected' | 'unresolved' | 'budget';
export interface PathContextEvidence {
    version: 1;
    status: PathContextStatus;
    hopCount: number;
    scopedHopCount: number;
    apps: string[];
    callerWitnesses: PropsCallerWitness[];
    reasons: PathContextReason[];
    issues: Array<{ edgeId: string; sourceId: string; targetId: string; reason: PathContextReason }>;
}
export const PATH_CONTEXT_LABELS: Record<PathContextStatus, string> = {
    static_only: 'Static path — no scoped caller check',
    app_only: 'App context only — query consistency unverified',
    shared_caller: 'Shared captured caller across scoped hops',
    mixed: 'No shared captured context',
    unverified: 'Path context unverified',
    bounded: 'Path context check bounded',
};
export const PATH_CONTEXT_REASONS: Record<PathContextReason, string> = {
    different_apps: 'Scoped relationships do not share a captured invoking app.',
    different_callers: 'Scoped relationships have no identical captured caller/query/conjunction receipt in common. Independent panels or searches cannot be combined.',
    caller_entry: 'The chosen starting caller or event-selector location does not share the captured query receipt. This may require a context change; it is not proof the dependency is impossible.',
    missing_context: 'A potential or scoped relationship lacks sufficient cached context. Older metadata is not repaired or guessed from object ownership.',
    invoking_app: 'A reusable or inherited invocation has no verified fixed app context.',
    scope_unverified: 'A declared scope cannot be checked against a common exact receipt without additional interpretation. No pattern, default or runtime field behavior is inferred.',
    disconnected: 'The supplied relationships are not one contiguous directed witness. Separate branches cannot establish a shared path context.',
    unresolved: 'A witness relationship is unresolved or an endpoint is outside the visible cached inventory. Captured context does not repair missing identity or access evidence.',
    budget: 'A scoped-hop, app, receipt, work or evidence-size ceiling stopped this annotation. The conservative dependencies and removal blockers are retained.',
};
export const PATH_CONTEXT_LIMITATION = 'Context applies to one chosen witness, not every alternative path. Shared captured evidence is not observed execution, full query semantics, effective configuration or removal eligibility. No shared context is not proof a dependency is impossible or an object is unused.';
export const PATH_CONTEXT_HOPS = 32;
export const PATH_CONTEXT_APPS = 32;
export const PATH_CONTEXT_WORK = 1000000;
export const PATH_CONTEXT_BYTES = 8 * 1024 * 1024;

/** Internal immutable branch state. Never persisted into customer/review facts. */
export interface PathContextState {
    originId: string | null;
    tipId: string;
    hopCount: number;
    scopedHopCount: number;
    apps: string[] | null;
    callers: PropsCallerWitness[] | null;
    pending: DependencyEdge[];
    reasons: PathContextReason[];
    issues: PathContextEvidence['issues'];
    lastEdge: DependencyEdge | null;
}
interface Limits { work?: number; bytes?: number }
export function createPathContextTracker(objects: ReadonlyMap<string, ContentObject>, limits: Limits = {}) {
    let work = 0; let bytes = 0; let bounded = false;
    const maxWork = Math.max(0, Math.min(PATH_CONTEXT_WORK, limits.work ?? PATH_CONTEXT_WORK));
    const maxBytes = Math.max(0, Math.min(PATH_CONTEXT_BYTES, limits.bytes ?? PATH_CONTEXT_BYTES));
    const fixed = new Set(['Saved Search', 'Report', 'Alert', 'Dashboard']);
    const spend = (amount = 1): boolean => {
        if (work + amount > maxWork) { bounded = true; return false; }
        work += amount; return true;
    };
    const reason = (state: PathContextState, value: PathContextReason, edge = state.lastEdge): void => {
        if (!state.reasons.includes(value)) { state.reasons.push(value); }
        if (edge && state.issues.length < 8 && !state.issues.some(item => item.edgeId === edge.edgeId && item.reason === value)) {
            state.issues.push({ edgeId: edge.edgeId, sourceId: edge.sourceId, targetId: edge.targetId, reason: value });
        }
        if (value === 'budget') { bounded = true; }
    };
    const start = (id: string): PathContextState => {
        const object = objects.get(id);
        const isFixed = object && fixed.has(object.objectType);
        return { originId: isFixed ? id : null, tipId: id,
            hopCount: 0, scopedHopCount: 0, apps: isFixed ? [object.app] : null, callers: null, pending: [], reasons: [], issues: [], lastEdge: null };
    };
    const literal = (scope: FieldScope, caller: PropsCallerWitness): 'match' | 'mismatch' | 'unknown' => {
        if (!spend()) { return 'unknown'; }
        if (!scope.exact || !['source', 'host', 'sourcetype'].includes(scope.field)) { return 'unknown'; }
        const selector = caller.selectors.find(item => item.field === scope.field);
        if (!selector) { return 'unknown'; }
        return (scope.field === 'host' ? selector.value.toLowerCase() === scope.value.toLowerCase() : selector.value === scope.value) ? 'match' : 'mismatch';
    };
    const check = (edge: DependencyEdge, caller: PropsCallerWitness, state: PathContextState): boolean => {
        if (!spend()) { reason(state, 'budget', edge); return true; }
        const proof = edge.fieldProvenance;
        if (!proof) { reason(state, 'missing_context', edge); return true; }
        if (proof.kind === 'event_scope') {
            if (caller.callerObjectId !== edge.sourceId) { return false; }
            if (!proof.contexts?.length || proof.contexts.length > 250) { reason(state, 'missing_context', edge); return true; }
            let selectorPresent = false;
            for (const context of proof.contexts) {
                if (!spend()) { reason(state, 'budget', edge); return true; }
                if (context.invokingApp !== caller.app || !context.selector) { continue; }
                selectorPresent = true;
                if (caller.selectors.some(item => item.field === context.selector!.field && item.value === context.selector!.value && item.sourceLocation === context.selector!.sourceLocation)) { return true; }
            }
            if (!selectorPresent) { reason(state, 'missing_context', edge); return true; }
            return false;
        }
        if (proof.kind === 'field_input' && proof.scopeCompatibility?.basis !== 'captured_conjunction') {
            const domain = proof.scopeCompatibility;
            if (!domain || domain.basis !== 'same_literal') { reason(state, 'scope_unverified', edge); return true; }
            const checks = [literal(domain.consumer, caller), literal(domain.producer, caller)];
            if (checks.includes('unknown')) { reason(state, work >= maxWork ? 'budget' : 'scope_unverified', edge); }
            if (checks.includes('mismatch')) { return false; }
        }
        return true;
    };
    const advance = (previous: PathContextState, edge: DependencyEdge): PathContextState => {
        const state: PathContextState = { ...previous, hopCount: previous.hopCount + 1,
            tipId: edge.targetId, reasons: [...previous.reasons], issues: [...previous.issues], lastEdge: edge,
            pending: previous.pending, apps: previous.apps, callers: previous.callers };
        if (previous.tipId !== edge.sourceId) { reason(state, 'disconnected'); }
        if (!edge.resolved || !objects.has(edge.sourceId) || !objects.has(edge.targetId)) { reason(state, 'unresolved'); }
        const proof = edge.fieldProvenance;
        if (proof || isPotentialRelation(edge.relation)) { state.scopedHopCount += 1; }
        if (!spend()) { reason(state, 'budget'); return state; }
        if (!proof) {
            if (isPotentialRelation(edge.relation)) { reason(state, 'missing_context'); }
            return state;
        }
        if (state.reasons.includes('budget')) { return state; }
        if (state.scopedHopCount > PATH_CONTEXT_HOPS) { reason(state, 'budget'); return state; }
        if (proof.invocation !== 'fixed_app') { reason(state, 'invoking_app'); }
        else if (!proof.contextApps.length) { reason(state, 'missing_context'); }
        else if (proof.contextApps.length > PATH_CONTEXT_APPS) { reason(state, 'budget'); }
        else if (!spend(proof.contextApps.length)) { reason(state, 'budget'); }
        else {
            const apps = [...new Set(proof.contextApps)].filter(app => typeof app === 'string' && app.length > 0 && app.length <= 4096).sort();
            if (apps.length !== new Set(proof.contextApps).size) { reason(state, 'missing_context'); }
            else {
                state.apps = state.apps === null ? apps : state.apps.filter(app => apps.includes(app));
                if (!state.apps.length) { reason(state, 'different_apps'); }
            }
        }
        const domain = proof.scopeCompatibility;
        if (domain?.basis === 'captured_conjunction') {
            const captured = readPropsCallerWitnesses(domain.callerWitnesses);
            if (!captured) { reason(state, 'missing_context'); }
            else if (!spend(captured.length + Math.ceil(propsCallerBytes(captured) / 32))) { reason(state, 'budget'); }
            else {
                const valid = captured.filter(row => {
                    const caller = objects.get(row.callerObjectId);
                    return caller && fixed.has(caller.objectType) && caller.app === row.app;
                });
                if (valid.length !== captured.length) { reason(state, 'missing_context'); }
                const keys = new Set(valid.map(propsCallerKey));
                state.callers = state.callers === null ? valid : state.callers.filter(row => keys.has(propsCallerKey(row)));
                if (!state.callers.length) { reason(state, 'different_callers'); }
            }
        }
        if (state.callers !== null) {
            const hadCandidates = state.callers.length > 0;
            const supported: PropsCallerWitness[] = [];
            const uncertain: Array<{ caller: PropsCallerWitness; state: PathContextState }> = [];
            for (const caller of state.callers) {
                if (state.apps !== null && !state.apps.includes(caller.app) || state.originId !== null && state.originId !== caller.callerObjectId) { continue; }
                const candidate: PathContextState = { ...state, reasons: [], issues: [] };
                if (![...state.pending, edge].every(item => check(item, caller, candidate))) { continue; }
                if (candidate.reasons.length) { uncertain.push({ caller, state: candidate }); }
                else { supported.push(caller); }
            }
            state.callers = supported.length ? supported : uncertain.map(item => item.caller);
            for (const candidate of uncertain) {
                if (!supported.length) {
                    candidate.state.reasons.forEach(value => reason(state, value, null));
                    candidate.state.issues.forEach(issue => {
                        const item = { ...edge, edgeId: issue.edgeId, sourceId: issue.sourceId, targetId: issue.targetId };
                        reason(state, issue.reason, item);
                    });
                } else if (candidate.state.reasons.includes('budget')) { reason(state, 'budget'); }
            }
            if (hadCandidates && !state.callers.length) { reason(state, 'caller_entry'); }
            if (!state.callers.length) { reason(state, 'different_callers'); }
            if (state.callers.length && state.apps !== null) {
                const callerApps = new Set(state.callers.map(caller => caller.app));
                state.apps = state.apps.filter(app => callerApps.has(app));
            }
            state.pending = [];
        } else {
            state.pending = [...state.pending, edge];
        }
        return state;
    };
    const evidence = (state: PathContextState): PathContextEvidence => {
        const reasons = [...state.reasons];
        let apps = state.apps ?? []; let callers = state.callers ?? []; let { issues } = state;
        const size = propsCallerBytes([apps, callers, issues]);
        if (size > 32768 || bytes + size > maxBytes) {
            if (!reasons.includes('budget')) { reasons.push('budget'); }
            apps = []; callers = []; issues = []; bounded = true;
        } else { bytes += size; }
        const mixed = reasons.some(item => ['different_apps', 'different_callers', 'caller_entry'].includes(item));
        let status: PathContextStatus = 'static_only';
        if (mixed) { status = 'mixed'; }
        else if (reasons.includes('budget')) { status = 'bounded'; }
        else if (reasons.length) { status = 'unverified'; }
        else if (callers.length) { status = 'shared_caller'; }
        else if (state.scopedHopCount) { status = 'app_only'; }
        return { version: 1, status, hopCount: state.hopCount, scopedHopCount: state.scopedHopCount,
            apps: [...apps], callerWitnesses: [...callers], reasons, issues: [...issues] };
    };
    const path = (originId: string, edges: DependencyEdge[]): PathContextEvidence => {
        let state = start(originId);
        for (const edge of edges) { state = advance(state, edge); }
        return evidence(state);
    };
    return { start, advance, evidence, path, diagnostics: () => ({ work, evidenceBytes: bytes, bounded }) };
}
