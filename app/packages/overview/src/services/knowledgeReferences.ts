/* eslint-disable no-restricted-syntax, no-continue -- Matching stops at explicit per-source and whole-scan budgets. */
import { ContentObject } from '../types';
import { ParsedReference, ParsedSource } from './dependencyParser';

export const KNOWLEDGE_MATCH_LIMIT = 250;
export const KNOWLEDGE_SCAN_EDGE_LIMIT = 50000;
export const KNOWLEDGE_CONTEXT_LIMITATION =
    'Exported reusable definitions inherit the invoking search namespace. Captured candidate bindings are potential contexts, not proven runtime targets.';

export interface BindingIdentity { stanza: string; tag: string; field: string; value: string }
export function tagBindingIdentity(canonicalName: string): BindingIdentity | null {
    try {
        const value: unknown = JSON.parse(canonicalName);
        if (!Array.isArray(value) || value.length !== 2 || value.some(item => typeof item !== 'string' || !item)) { return null; }
        const separator = value[0].indexOf('=');
        if (separator < 1 || !value[0].slice(separator + 1)) { return null; }
        return { stanza: value[0], tag: value[1], field: value[0].slice(0, separator), value: value[0].slice(separator + 1) };
    } catch { return null; }
}

export function potentialKnowledgeRelation(relation: string): string {
    if (relation.startsWith('may_')) { return relation; }
    if (relation.startsWith('matches_')) { return relation.replace('matches_', 'may_match_'); }
    if (relation.startsWith('excludes_')) { return relation.replace('excludes_', 'may_exclude_'); }
    if (relation === 'tags_event_type') { return 'may_tag_event_type'; }
    return `may_${relation}`;
}

/** Parse only the app's decoded native binding metadata, never customer code. */
export function parseTagBinding(text: string, sourceLocation = 'tags.conf'): ParsedSource {
    const result: ParsedSource = { references: [], warnings: [], gaps: [] };
    const gap = (message: string): ParsedSource => {
        result.warnings.push(message);
        result.gaps!.push({ targets: ['event_type', 'tag_binding'], message, sourceLocation });
        return result;
    };
    let value: Record<string, unknown>;
    try {
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return gap('Tag binding metadata is not an object.'); }
        value = parsed as Record<string, unknown>;
    } catch { return gap('Tag binding metadata could not be parsed.'); }
    if (typeof value.field !== 'string' || typeof value.tag !== 'string' || !value.tag) { return gap('Tag binding field or tag identity is unavailable.'); }
    if (value.field !== 'eventtype') {
        return gap('This tag binds an event field/value, not a supported event-type definition; field availability and derived lineage remain unverified.');
    }
    const name = value.literalFieldValue;
    if (typeof name !== 'string' || !name || name.trim() !== name || /[$*?{}%]/.test(name)) {
        return gap('Tag event-type value is encoded, dynamic or unsupported; no target identity is guessed.');
    }
    const active = value.enabled === true;
    result.references.push({ targetType: 'event_type', targetName: name,
        relation: active ? 'tags_event_type' : 'may_tag_event_type', confidence: active ? 'high' : 'unknown',
        evidence: `Tag ${value.tag} is configured on eventtype=${name}${active ? '' : '; binding is disabled or its enabled state is unknown'}. Configuration does not prove event tagging or runtime use.`,
        sourceLocation });
    if (!active) { gap('Inactive or unknown-state tag configuration is retained as a potential relationship, not current applicability.'); }
    return result;
}

interface Visibility { privateTargets?: Array<{ collector: string; app: string; name: string }>;
    privateTargetGaps?: Array<{ collector: string; app: string }>;
    privateObjects: Array<{ collector: string; app: string; count: number }> }
interface KnowledgeCandidate { object: ContentObject; binding: BindingIdentity | null }
type KnowledgeIndex = Map<string, Map<string, KnowledgeCandidate[]>>;
const typeKey = (type: ParsedReference['targetType'], name: string, field?: string): string => JSON.stringify([type, name, field ?? null]);
function indexCandidate(index: KnowledgeIndex, key: string, candidate: KnowledgeCandidate): void {
    const scopes = index.get(key) ?? new Map<string, KnowledgeCandidate[]>();
    const add = (scope: string): void => {
        const list = scopes.get(scope) ?? []; list.push(candidate); scopes.set(scope, list);
    };
    add('all'); add(`app:${candidate.object.app}`);
    if (candidate.object.sharing === 'global') { add('exported'); }
    index.set(key, scopes);
}
function candidatesFor(index: KnowledgeIndex, key: string, app: string, reusable: boolean): KnowledgeCandidate[] {
    const scopes = index.get(key);
    if (!scopes) { return []; }
    if (reusable) { return scopes.get('all') ?? []; }
    const local = scopes.get(`app:${app}`) ?? [];
    const exported = scopes.get('exported') ?? [];
    return local.length ? [...local, ...exported.filter(item => item.object.app !== app)] : exported;
}

/** One indexed catalog per scan. A tag search intentionally fans out to its
 * distinct field/value assignments; it is not an ambiguous single tag object. */
export function buildKnowledgeReferenceMatcher(objects: ContentObject[], visibility?: Visibility):
    (object: ContentObject, parsed: ParsedSource) => ParsedSource {
    const names: KnowledgeIndex = new Map();
    const caseNames: KnowledgeIndex = new Map();
    const privateNames = new Set<string>();
    const privateTagScopes = new Set<string>();
    const privateCaseNames = new Map<string, Set<string>>();
    const privateEventTypes = new Map<string, Set<string>>();
    const privateCollectors = new Map<string, Set<string>>();
    const privateGaps = new Map<string, Set<string>>();
    let remaining = KNOWLEDGE_SCAN_EDGE_LIMIT;
    objects.forEach(object => {
        if (!['app', 'global'].includes(object.sharing ?? '')) { return; }
        const binding = object.objectType === 'Tag Binding' ? tagBindingIdentity(object.canonicalName) : null;
        let type: ParsedReference['targetType'] | null = null;
        if (object.objectType === 'Event Type') { type = 'event_type'; }
        else if (binding) { type = 'tag_binding'; }
        if (!type) { return; }
        const name = binding?.tag ?? object.canonicalName;
        [undefined, ...(binding ? [binding.field] : [])].forEach(field => {
            indexCandidate(names, typeKey(type!, name, field), { object, binding });
            indexCandidate(caseNames, typeKey(type!, name.toLowerCase(), field), { object, binding });
        });
    });
    [names, caseNames].forEach(index => index.forEach(scopes => scopes.forEach(list =>
        list.sort((a, b) => a.object.objectId.localeCompare(b.object.objectId)))));
    const indexPrivateCase = (type: ParsedReference['targetType'], name: string, app: string, field?: string): void => {
        [app, '*'].forEach(scope => [undefined, ...(field ? [field] : [])].forEach(qualifier => {
            const key = `${scope}\0${typeKey(type, name.toLowerCase(), qualifier)}`;
            const variants = privateCaseNames.get(key) ?? new Set<string>(); variants.add(name); privateCaseNames.set(key, variants);
        }));
    };
    visibility?.privateTargets?.forEach(row => {
        privateNames.add(`${row.collector}\0${row.app}\0${row.name}`);
        if (row.collector === 'event_types') {
            const apps = privateEventTypes.get(row.name) ?? new Set<string>(); apps.add(row.app); privateEventTypes.set(row.name, apps);
            indexPrivateCase('event_type', row.name, row.app);
        }
        if (row.collector !== 'tag_bindings') { return; }
        const identity = tagBindingIdentity(row.name);
        if (identity) {
            [row.app, '*'].forEach(app => [identity.field, '*'].forEach(field => privateTagScopes.add(`${identity.tag}\0${app}\0${field}`)));
            indexPrivateCase('tag_binding', identity.tag, row.app, identity.field);
        }
    });
    visibility?.privateObjects.filter(row => row.count > 0).forEach(row => {
        const apps = privateCollectors.get(row.collector) ?? new Set<string>(); apps.add(row.app); privateCollectors.set(row.collector, apps);
    });
    visibility?.privateTargetGaps?.forEach(row => {
        const apps = privateGaps.get(row.collector) ?? new Set<string>(); apps.add(row.app); privateGaps.set(row.collector, apps);
    });
    return (object, parsed) => {
        if (!parsed.references.some(reference => ['event_type', 'tag_binding'].includes(reference.targetType))) { return parsed; }
        const result: ParsedSource = { ...parsed, references: [], warnings: [...parsed.warnings], gaps: [...(parsed.gaps ?? [])] };
        const reusable = ['Macro', 'Data Model', 'Event Type', 'Tag Binding'].includes(object.objectType) && object.sharing === 'global';
        let count = 0;
        const gap = (reference: ParsedReference, message: string): void => {
            if (!result.warnings.includes(message)) { result.warnings.push(message); }
            result.gaps!.push({ targets: [reference.targetType], targetName: reference.targetName, message, sourceLocation: reference.sourceLocation });
        };
        const add = (reference: ParsedReference): void => {
            if (count >= KNOWLEDGE_MATCH_LIMIT || remaining <= 0) {
                gap(reference, `Event-type/tag matching reached its safety limit (${KNOWLEDGE_MATCH_LIMIT} per source / ${KNOWLEDGE_SCAN_EDGE_LIMIT} per scan); additional bindings remain unverified.`);
                return;
            }
            result.references.push(reference); count += 1; remaining -= 1;
        };
        for (const reference of parsed.references) {
            if (!['event_type', 'tag_binding'].includes(reference.targetType)) { result.references.push(reference); continue; }
            if (reference.resolutionUncertain) {
                // A workflow with runtime-inherited context is not made certain
                // merely because its declaring app has a same-named definition.
                gap(reference, 'The invocation context for this named knowledge reference is unverified.');
                add(reference); continue;
            }
            if (count >= KNOWLEDGE_MATCH_LIMIT || remaining <= 0) {
                gap(reference, `Event-type/tag matching reached its safety limit (${KNOWLEDGE_MATCH_LIMIT} per source / ${KNOWLEDGE_SCAN_EDGE_LIMIT} per scan); additional bindings remain unverified.`);
                continue;
            }
            const app = reference.contextApp ?? object.app;
            const key = typeKey(reference.targetType, reference.targetName, reference.tagField);
            const candidates = candidatesFor(names, key, app, reusable);
            const caseVariant = candidatesFor(caseNames, typeKey(reference.targetType, reference.targetName.toLowerCase(), reference.tagField), app, reusable)
                .some(item => (item.binding?.tag ?? item.object.canonicalName) !== reference.targetName);
            const collector = reference.targetType === 'event_type' ? 'event_types' : 'tag_bindings';
            const excludedTypes = privateEventTypes.get(reference.targetName);
            const excludedCatalog = privateCollectors.get(collector);
            const mappingGaps = privateGaps.get(collector);
            const privateVariants = privateCaseNames.get(`${reusable ? '*' : app}\0${typeKey(reference.targetType, reference.targetName.toLowerCase(), reference.tagField)}`);
            const privateCaseVariant = Boolean(privateVariants && (privateVariants.size > 1 || !privateVariants.has(reference.targetName)));
            const privateMappingUnknown = Boolean(privateCaseVariant || mappingGaps?.has('unknown') || (reusable ? mappingGaps?.size : mappingGaps?.has(app)));
            let privatePossible = reusable ? Boolean(excludedCatalog?.size) : Boolean(excludedCatalog?.has(app));
            if (visibility?.privateTargets) {
                privatePossible = reusable ? Boolean(excludedTypes?.size) : Boolean(excludedTypes?.has(app));
                if (reference.targetType === 'tag_binding') { privatePossible = privateTagScopes.has(`${reference.targetName}\0${reusable ? '*' : app}\0${reference.tagField ?? '*'}`); }
            }
            privatePossible ||= privateMappingUnknown;
            if (privatePossible) { gap(reference, 'Excluded private definitions or assignments can change this named reference; their identities are not included.'); }
            if (reusable) { gap(reference, KNOWLEDGE_CONTEXT_LIMITATION); }
            if (caseVariant) {
                gap(reference, 'Visible case-variant names require verified matching semantics; identities remain distinct and no deterministic binding is guessed.');
                add({ ...reference, resolutionUncertain: true }); continue;
            }
            if (!candidates.length) {
                add({ ...reference, resolutionUncertain: Boolean(privatePossible || reusable),
                    ...(reusable ? { relation: potentialKnowledgeRelation(reference.relation) } : {}) });
                continue;
            }
            const groups = new Map<string, KnowledgeCandidate[]>();
            candidates.forEach(candidate => {
                const name = candidate.object.canonicalName;
                const group = groups.get(name) ?? []; group.push(candidate); groups.set(name, group);
            });
            let limited = false;
            for (const group of groups.values()) {
                const local = group.filter(item => item.object.app === app);
                let applicable = local.length ? local : group.filter(item => item.object.sharing === 'global');
                if (reusable) { applicable = group; }
                const shadowed = !reusable && privateNames.has(`${collector}\0${app}\0${group[0].object.canonicalName}`);
                if (!applicable.length || (!reusable && applicable.length > 1) || shadowed || privateMappingUnknown || (reference.targetType === 'event_type' && privatePossible)) {
                    gap(reference, 'Namespace visibility, excluded private shadows or duplicate candidates prevent deterministic target resolution.');
                    add({ ...reference, resolutionUncertain: true }); continue;
                }
                for (const { object: target, binding } of applicable) {
                    if (count >= KNOWLEDGE_MATCH_LIMIT || remaining <= 0) {
                        gap(reference, `Event-type/tag matching reached its safety limit (${KNOWLEDGE_MATCH_LIMIT} per source / ${KNOWLEDGE_SCAN_EDGE_LIMIT} per scan); additional bindings remain unverified.`);
                        limited = true; break;
                    }
                    const unverifiedValue = Boolean(binding && /[$*?{}]|%[\da-f]{2}/i.test(binding.value));
                    const conditional = reusable || target.enabled !== true || unverifiedValue;
                    if (unverifiedValue) { gap(reference, 'A tag assignment has an encoded or dynamic field value; active applicability remains unverified.'); }
                    if (target.enabled !== true) { gap(reference, 'A named target is disabled or has unknown enabled state; captured linkage is potential, not current applicability.'); }
                    let { confidence } = reference;
                    if (conditional && confidence === 'high') { confidence = 'medium'; }
                    if (target.enabled === null) { confidence = 'unknown'; }
                    add({ ...reference, targetName: target.canonicalName, targetObjectId: target.objectId,
                        contextApp: reusable ? target.app : app,
                        relation: conditional ? potentialKnowledgeRelation(reference.relation) : reference.relation,
                        confidence,
                        evidence: `${reference.evidence}; ${conditional ? 'potential ' : ''}shared ${target.objectType === 'Tag Binding' ? 'tag assignment' : 'event-type binding'} in app ${target.app}${target.enabled !== true ? '; target is inactive or unverified' : ''}` });
                }
                if (limited) { break; }
            }
            if (reference.targetType === 'tag_binding' && privatePossible) { add({ ...reference, resolutionUncertain: true }); }
        }
        result.warnings = [...new Set(result.warnings)];
        return result;
    };
}
