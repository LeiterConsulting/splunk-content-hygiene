/* eslint-disable no-restricted-syntax, no-continue -- Indexed matching exits at explicit build, per-source and whole-scan budgets. */
import { ContentObject, FieldDependencyProvenance, FieldLineageFacts, FieldPhase, FieldScope, ProducerOutputDeclaration } from '../types';
import { ParsedReference, ParsedSource, ReferenceTarget } from './dependencyParser';

export const FIELD_MATCH_LIMIT = 250;
export const FIELD_SCAN_EDGE_LIMIT = 50000;
export const FIELD_INDEX_ENTRY_LIMIT = 50000;
export const FIELD_CANDIDATE_VISIT_LIMIT = 100000;
export const FIELD_SOURCE_VISIT_LIMIT = 5000;
export const FIELD_LINEAGE_LIMITATION = 'Declared field paths are potential search-time dependencies, not proof a regex matched, a field exists, a declaration executes or a particular props override wins. Cross-scope precedence, wildcard/default rules, private/system inheritance and external consumers remain unverified.';
export const FIELD_TARGETS: ReferenceTarget[] = ['field_extraction', 'field_alias', 'calculated_field', 'field_transform'];
export interface FieldVisibility {
    privateObjects: Array<{ collector: string; app: string; count: number }>;
    privateTargets?: Array<{ collector: string; app: string; name: string }>;
    privateTargetGaps?: Array<{ collector: string; app: string }>;
}
interface Candidate { object: ContentObject; facts: FieldLineageFacts }
interface Binding { name: string; positions: number[]; target?: Candidate; contextApp: string }
interface Producer extends Candidate { phase: FieldPhase; via?: Candidate }
type ScopedIndex<T> = Map<string, Map<string, T[]>>;
const scopeKey = (scope: FieldScope): string => `${scope.field}\0${scope.value.toLowerCase()}`;
const phase = (facts: FieldLineageFacts): FieldPhase => {
    if (facts.operation === 'alias') { return 'alias'; }
    if (facts.operation === 'eval') { return 'calculated'; }
    return facts.operation === 'lookup' ? 'lookup' : 'extraction';
};
const targetType = (object: ContentObject): ReferenceTarget => {
    if (object.objectType === 'Field Alias') { return 'field_alias'; }
    if (object.objectType === 'Calculated Field') { return 'calculated_field'; }
    return object.objectType === 'Field Transform' ? 'field_transform' : 'field_extraction';
};
function addIndex<T>(index: ScopedIndex<T>, key: string, app: string, exported: boolean, item: T): void {
    const scopes = index.get(key) ?? new Map<string, T[]>();
    [`app:${app}`, 'all', ...(exported ? ['exported'] : [])].forEach(namespace => {
        const list = scopes.get(namespace) ?? []; list.push(item); scopes.set(namespace, list);
    });
    index.set(key, scopes);
}
function* candidates<T>(index: ScopedIndex<T>, key: string, app: string, reusable: boolean): Generator<T> {
    const scopes = index.get(key);
    if (reusable) { yield* scopes?.get('all') ?? []; return; }
    yield* scopes?.get(`app:${app}`) ?? [];
    yield* scopes?.get('exported') ?? [];
}

/** One compact index per scan. No field-name join across unrelated event scopes,
 * regex evaluation, alias chaining, EVAL chaining or estate scan per source. */
export function buildFieldDependencyMatcher(objects: ContentObject[], catalogComplete: boolean, visibility?: FieldVisibility):
    (object: ContentObject, parsed: ParsedSource) => ParsedSource {
    const transforms: ScopedIndex<Candidate> = new Map();
    const scoped: ScopedIndex<Candidate> = new Map();
    const producers: ScopedIndex<Producer> = new Map();
    const localIdentities = new Set<string>();
    const bindings = new Map<string, Binding[]>();
    const buildGaps = new Map<string, string[]>();
    const privateNames = new Set<string>(); const privateCounts = new Set<string>(); const privateGaps = new Set<string>();
    visibility?.privateTargets?.forEach(row => privateNames.add(`${row.collector}\0${row.app}\0${row.name}`));
    visibility?.privateObjects.filter(row => row.count > 0).forEach(row => privateCounts.add(`${row.collector}\0${row.app}`));
    visibility?.privateTargetGaps?.forEach(row => privateGaps.add(`${row.collector}\0${row.app}`));
    const privateTarget = (collector: string, name: string, app: string): boolean => privateGaps.has(`${collector}\0${app}`) || privateGaps.has(`${collector}\0unknown`) || privateCounts.has(`${collector}\0unknown`) ||
        (visibility?.privateTargets ? privateNames.has(`${collector}\0${app}\0${name}`) : privateCounts.has(`${collector}\0${app}`));
    const collectorFor = (object: ContentObject): string => ({ 'Field Extraction': 'field_extractions', 'Field Alias': 'field_aliases',
        'Calculated Field': 'calculated_fields', 'Field Transform': 'field_transforms' }[object.objectType] ?? 'field_extractions');
    const gapDuringBuild = (object: ContentObject, message: string): void => {
        const messages = buildGaps.get(object.objectId) ?? [];
        if (!messages.includes(message)) { messages.push(message); buildGaps.set(object.objectId, messages); }
    };
    const fields = objects.flatMap(object => object.fieldLineage && ['app', 'global'].includes(object.sharing ?? '') ? [{ object, facts: object.fieldLineage }] : []);
    fields.forEach(item => {
        localIdentities.add(`${item.object.app}\0${item.object.objectType}\0${item.object.canonicalName}`);
        if (item.facts.operation === 'transform') {
            addIndex(transforms, item.object.canonicalName, item.object.app, item.object.sharing === 'global', item);
        } else if (item.facts.scope?.exact && item.facts.operation !== 'lookup') {
            addIndex(scoped, scopeKey(item.facts.scope), item.object.app, item.object.sharing === 'global', item);
        }
    });
    const visibleTransforms = (name: string, app: string): Candidate[] => {
        if (privateTarget('field_transforms', name, app)) { return []; }
        const scopes = transforms.get(name); const local = scopes?.get(`app:${app}`) ?? [];
        return local.length ? local : scopes?.get('exported') ?? [];
    };
    let bindingBudget = FIELD_SCAN_EDGE_LIMIT; let indexBudget = FIELD_INDEX_ENTRY_LIMIT; let buildVisits = FIELD_CANDIDATE_VISIT_LIMIT;
    const addProducer = (producer: Producer, output: string): void => {
        if (indexBudget <= 0) { gapDuringBuild(producer.object, `Field producer index reached its ${FIELD_INDEX_ENTRY_LIMIT}-entry budget; additional declared outputs remain unverified.`); return; }
        const key = `${scopeKey(producer.facts.scope!)}\0${output}`;
        addIndex(producers, key, producer.object.app, producer.object.sharing === 'global', producer); indexBudget -= 1;
    };
    fields.forEach(item => {
        const { object, facts } = item;
        if (facts.operation === 'report') {
            const ordered = new Map<string, number[]>();
            facts.transforms.forEach((name, index) => { const positions = ordered.get(name) ?? []; positions.push(index + 1); ordered.set(name, positions); });
            const rows: Binding[] = []; const reusable = object.sharing === 'global';
            for (const [name, positions] of ordered) {
                const possible = reusable ? transforms.get(name)?.get('all') ?? [] : visibleTransforms(name, object.app);
                let added = false; const seen = new Set<string>();
                for (const target of possible) {
                    if (buildVisits <= 0) { gapDuringBuild(object, 'REPORT namespace candidate-visit budget reached; additional bindings remain unverified.'); break; }
                    buildVisits -= 1;
                    const app = reusable ? target.object.app : object.app;
                    const visible = visibleTransforms(name, app);
                    if (visible.length !== 1 || visible[0].object.objectId !== target.object.objectId || seen.has(target.object.objectId)) { continue; }
                    if (rows.length >= FIELD_MATCH_LIMIT || bindingBudget <= 0) { break; }
                    rows.push({ name, positions, target, contextApp: app }); seen.add(target.object.objectId); added = true; bindingBudget -= 1;
                    if (facts.scope?.exact) {
                        // New partial declarations need explicit output attribution.
                        // Legacy complete literal facts remain readable; ambiguous
                        // FORMAT/FIELDS names are investigation facts, not producers.
                        const outputs = target.facts.outputProvenance?.declarations.map(row => row.field) ?? (target.facts.syntax === 'declared' ? target.facts.outputs : []);
                        [...new Set(outputs)].forEach(output => addProducer({ ...item, phase: 'extraction', via: target }, output));
                    }
                }
                if (!added && rows.length < FIELD_MATCH_LIMIT && bindingBudget > 0) {
                    rows.push({ name, positions, contextApp: object.app }); bindingBudget -= 1;
                }
                if (rows.length >= FIELD_MATCH_LIMIT || bindingBudget <= 0) {
                    gapDuringBuild(object, `REPORT binding matching reached its safety budget (${FIELD_MATCH_LIMIT} per source / ${FIELD_SCAN_EDGE_LIMIT} per scan); additional transform contexts remain unverified.`); break;
                }
            }
            bindings.set(object.objectId, rows);
        } else if (facts.scope?.exact && ['inline', 'alias', 'eval'].includes(facts.operation)) {
            facts.outputs.forEach(output => addProducer({ ...item, phase: phase(facts) }, output));
        }
    });
    let remaining = FIELD_SCAN_EDGE_LIMIT; let remainingVisits = FIELD_CANDIDATE_VISIT_LIMIT;
    return (object, parsed) => {
        if (!parsed.fieldLineage && !parsed.hasEventSearch) { return parsed; }
        const result: ParsedSource = { ...parsed, references: [...parsed.references], warnings: [...parsed.warnings], gaps: [...(parsed.gaps ?? [])] };
        const own = parsed.fieldLineage;
        let count = 0; let visits = 0;
        const gap = (message: string, targets = FIELD_TARGETS): void => {
            if (!result.warnings.includes(message)) { result.warnings.push(message); }
            if (!result.gaps!.some(row => row.message === message)) { result.gaps!.push({ targets, message, sourceLocation: own?.sourceLocation ?? 'field-scope matching' }); }
        };
        const add = (reference: ParsedReference): boolean => {
            if (count >= FIELD_MATCH_LIMIT || remaining <= 0) {
                gap(`Field dependency matching reached its safety limit (${FIELD_MATCH_LIMIT} per source / ${FIELD_SCAN_EDGE_LIMIT} per scan); additional potential paths are omitted.`); return false;
            }
            result.references.push(reference); count += 1; remaining -= 1; return true;
        };
        const provenance = (kind: FieldDependencyProvenance['kind'], scope: FieldScope | null, consumerPhase: FieldPhase | null,
            producerPhase: FieldPhase, reusable: boolean): FieldDependencyProvenance => ({ version: 1, kind, fields: [], scope, consumerPhase, producerPhase,
            transformPositions: [], viaObjectIds: [], contextApps: [], invocation: reusable ? 'invoking_app_unverified' : 'fixed_app' });
        const visit = (): boolean => {
            if (visits >= FIELD_SOURCE_VISIT_LIMIT || remainingVisits <= 0) {
                gap(`Field candidate inspection reached its safety limit (${FIELD_SOURCE_VISIT_LIMIT} per source / ${FIELD_CANDIDATE_VISIT_LIMIT} per scan); additional possible paths remain unverified.`); return false;
            }
            visits += 1; remainingVisits -= 1; return true;
        };
        if (own) {
            gap(FIELD_LINEAGE_LIMITATION);
            own.limitations.forEach(message => gap(message, own.operation === 'eval' && own.syntax === 'unsupported' ? [...FIELD_TARGETS, 'lookup'] : FIELD_TARGETS));
            (buildGaps.get(object.objectId) ?? []).forEach(message => gap(message));
            const reusable = object.sharing === 'global';
            if (reusable) { gap('Exported field declarations inherit the invoking search app; possible namespace bindings are not proven runtime targets.'); }
            if (remaining <= 0 || remainingVisits <= 0) {
                gap('Field matching scan budget is exhausted; additional possible paths remain unverified.'); return result;
            }
            if (own.operation === 'report') {
                for (const binding of bindings.get(object.objectId) ?? []) {
                    const proof = provenance('report_binding', own.scope, 'extraction', 'extraction', reusable);
                    proof.transformPositions = binding.positions;
                    proof.contextApps = [binding.contextApp];
                    if (!binding.target) { gap('A REPORT target has no unique supported shared binding. Private/system inheritance, unavailable metadata or multiple namespaces may change its target; absence is not a broken-content assertion.'); }
                    if (!add({ targetType: 'field_transform', targetName: binding.name, relation: 'may_use_field_transform', confidence: 'medium',
                        contextApp: binding.contextApp, targetObjectId: binding.target?.object.objectId, resolutionUncertain: !binding.target,
                        sourceLocation: own.sourceLocation, fieldProvenance: proof,
                        evidence: `Declared REPORT target ${binding.name} at native position(s) ${binding.positions.join(', ')}; ordered configuration is retained, not proof of execution or effective precedence.${own.enabled === false ? ' Declaration is disabled.' : ''}` })) { break; }
                }
            }
            if (own.scope?.exact && ['alias', 'eval', 'lookup'].includes(own.operation) && own.inputs.length) {
                const matches = new Map<string, ParsedReference>();
                for (const input of own.inputs) {
                    const possible = candidates(producers, `${scopeKey(own.scope)}\0${input}`, object.app, reusable);
                    for (const producer of possible) {
                        if (!visit()) { break; }
                        const consumer = phase(own);
                        if (producer.object.objectId === object.objectId || producer.phase === 'calculated' && consumer !== 'lookup' || producer.phase === 'alias' && consumer === 'alias') { continue; }
                        const app = reusable ? producer.via?.object.app ?? producer.object.app : object.app;
                        if (privateTarget(collectorFor(producer.object), producer.object.canonicalName, app)) {
                            gap('Private or omitted field declarations can change the producer binding; no shared output path is guessed for that context.'); continue;
                        }
                        if (producer.via) {
                            const visible = visibleTransforms(producer.via.object.canonicalName, app);
                            if (visible.length !== 1 || visible[0].object.objectId !== producer.via.object.objectId) { continue; }
                        }
                        // Same-named local declarations can shadow exported ones.
                        if (!reusable && producer.object.app !== app && localIdentities.has(`${app}\0${producer.object.objectType}\0${producer.object.canonicalName}`)) { continue; }
                        const key = `${producer.object.objectId}\0${app}`;
                        const origin = producer.via ?? producer;
                        const declared: ProducerOutputDeclaration[] = (origin.facts.outputProvenance?.declarations ?? [])
                            .filter(item => item.field === input).map(item => ({ ...item, objectId: origin.object.objectId, method: origin.facts.outputProvenance!.method }));
                        const existing = matches.get(key);
                        if (existing) {
                            if (!existing.fieldProvenance!.fields.includes(input)) { existing.fieldProvenance!.fields.push(input); }
                            if (producer.via && !existing.fieldProvenance!.viaObjectIds.includes(producer.via.object.objectId)) { existing.fieldProvenance!.viaObjectIds.push(producer.via.object.objectId); }
                            if (declared.length) {
                                const declarations = [...new Map([...(existing.fieldProvenance!.outputDeclarations ?? []), ...declared].map(item => [JSON.stringify(item), item])).values()];
                                if (declarations.length > FIELD_MATCH_LIMIT) { gap('Output-declaration evidence reached its per-edge budget; additional declaration positions remain unverified.'); }
                                existing.fieldProvenance!.outputDeclarations = declarations.slice(0, FIELD_MATCH_LIMIT);
                            }
                            continue;
                        }
                        if (matches.size >= FIELD_MATCH_LIMIT || matches.size >= remaining) { gap('Declared field-input fan-out reached the matching safety budget; additional producer paths remain unverified.'); break; }
                        const proof = provenance('field_input', own.scope, consumer, producer.phase, reusable);
                        proof.fields = [input]; proof.viaObjectIds = producer.via ? [producer.via.object.objectId] : []; proof.contextApps = [app];
                        if (declared.length) { proof.outputDeclarations = declared; }
                        let relation = 'may_read_extracted_field';
                        if (producer.phase === 'alias') { relation = 'may_read_aliased_field'; }
                        else if (producer.phase === 'calculated') { relation = 'may_read_calculated_field'; }
                        matches.set(key, { targetType: targetType(producer.object), targetName: producer.object.canonicalName,
                            targetObjectId: producer.object.objectId, contextApp: app, relation, confidence: 'medium', fieldProvenance: proof,
                            sourceLocation: own.sourceLocation,
                            evidence: `Declared ${consumer} input may be supplied by this earlier ${producer.phase} definition in the same exact ${own.scope.field} scope. Field names and transform provenance are retained separately; no value availability or winning assignment is inferred.` });
                    }
                    if (matches.size >= FIELD_MATCH_LIMIT || matches.size >= remaining || visits >= FIELD_SOURCE_VISIT_LIMIT || remainingVisits <= 0) { break; }
                }
                for (const reference of matches.values()) { if (!add(reference)) { break; } }
            }
            if (own.inputs.length && own.operation === 'transform') { gap('Transform SOURCE_KEY is retained as declared input only; cross-transform field availability and execution ordering are not inferred.'); }
        }
        if (parsed.hasEventSearch) {
            gap(catalogComplete ? FIELD_LINEAGE_LIMITATION : 'Field-lineage catalogs are incomplete or unavailable; additional implicit field dependencies remain unverified.');
            if (remaining <= 0 || remainingVisits <= 0) {
                gap('Field matching scan budget is exhausted; additional possible paths remain unverified.'); return result;
            }
            if (!['Saved Search', 'Report', 'Alert', 'Dashboard'].includes(object.objectType)) {
                gap('Reusable search definitions do not establish their invoking app; no owning-app field caller binding is inferred.'); return result;
            }
            const seen = new Set<string>();
            for (const selector of parsed.eventSelectors ?? []) {
                const scope: FieldScope = { field: selector.field, value: selector.value, exact: true };
                const possible = candidates(scoped, scopeKey(scope), object.app, false);
                for (const candidate of possible) {
                    if (!visit()) { return result; }
                    if (seen.has(candidate.object.objectId) || privateTarget(collectorFor(candidate.object), candidate.object.canonicalName, object.app) ||
                        candidate.object.app !== object.app && localIdentities.has(`${object.app}\0${candidate.object.objectType}\0${candidate.object.canonicalName}`)) { continue; }
                    seen.add(candidate.object.objectId);
                    const type = targetType(candidate.object);
                    const proof = provenance('event_scope', candidate.facts.scope, null, phase(candidate.facts), false);
                    proof.contextApps = [object.app];
                    let relation = 'may_apply_field_extraction';
                    if (type === 'field_alias') { relation = 'may_apply_field_alias'; }
                    else if (type === 'calculated_field') { relation = 'may_apply_calculated_field'; }
                    if (!add({ targetType: type, targetName: candidate.object.canonicalName, targetObjectId: candidate.object.objectId,
                        relation, confidence: 'medium', fieldProvenance: proof, sourceLocation: selector.sourceLocation,
                        evidence: `Positive exact ${selector.field}=${selector.value} may enter this props field-processing scope. This does not establish field consumption, enabled state, precedence or runtime execution.${candidate.facts.enabled === false ? ' Declaration is disabled.' : ''}` })) { return result; }
                }
            }
        }
        return result;
    };
}
