/* eslint-disable no-restricted-syntax, no-continue -- Bounded indexed matching exits immediately at the per-source/scan budgets. */
import { ContentObject, FieldContextEvidence, LookupMappingFacts } from '../types';
import { AutomaticLookupRule, EventSelector, ParsedReference, ParsedSource } from './dependencyParser';
import type { FieldVisibility } from './fieldDependencies';
import { compilePropsPattern, createPropsPatternIndex, matchPropsPattern, PROPS_PATTERN_SCAN_WORK, PROPS_PATTERN_SOURCE_WORK } from './propsPatterns';

export const AUTOMATIC_MATCH_LIMIT = 250;
export const AUTOMATIC_SCAN_EDGE_LIMIT = 50000;
export const AUTOMATIC_CANDIDATE_VISIT_LIMIT = 100000;
export const AUTOMATIC_SOURCE_VISIT_LIMIT = 5000;
export const AUTOMATIC_APPLICABILITY_LIMITATION =
    'Automatic lookup caller links are potential matches of positive exact event selectors against literal, bounded * / ... patterns or captured default fallbacks, not observed execution. Unsupported patterns, complete props precedence, sourcetype renames, field availability and runtime invocation context remain unverified.';

/** Native LOOKUP mappings contain field names, not executable expressions. */
export function automaticLookupMapping(declaration: string): LookupMappingFacts | null {
    if (declaration.length > 65536 || new TextEncoder().encode(declaration).length > 65536) { return null; }
    const parts: Array<{ value: string; quoted: boolean }> = [];
    const lexer = /\s*("(?:\\["\\]|[^"\\])*"|'(?:\\['\\]|[^'\\])*'|[^\s"']+)/gy;
    let offset = 0;
    while (offset < declaration.length && declaration.slice(offset).trim()) {
        lexer.lastIndex = offset;
        const match = lexer.exec(declaration);
        if (!match || parts.length >= 1502) { return null; }
        const quoted = /^['"]/.test(match[1]);
        const value = quoted ? match[1].slice(1, -1).replace(/\\(["'\\])/g, '$1') : match[1];
        if (!value || value.length > 4096 || /[$*?{}[\]]/.test(value) || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) { return null; }
        parts.push({ value, quoted }); offset = lexer.lastIndex;
    }
    if (parts.length < 2) { return null; }
    const inputs: LookupMappingFacts['inputs'] = []; const outputs: LookupMappingFacts['outputs'] = [];
    let outputMode: LookupMappingFacts['outputMode'] = 'implicit';
    for (let index = 1; index < parts.length; index += 1) {
        const item = parts[index]; const keyword = item.value.toUpperCase();
        if (!item.quoted && ['OUTPUT', 'OUTPUTNEW'].includes(keyword)) {
            if (outputMode !== 'implicit' || index === parts.length - 1 || !inputs.length) { return null; }
            outputMode = keyword as 'OUTPUT' | 'OUTPUTNEW'; continue;
        }
        if (!item.quoted && keyword === 'AS') { return null; }
        let eventField = item.value;
        if (!parts[index + 1]?.quoted && parts[index + 1]?.value.toUpperCase() === 'AS') {
            const renamed = parts[index + 2];
            if (!renamed || !renamed.quoted && ['AS', 'OUTPUT', 'OUTPUTNEW'].includes(renamed.value.toUpperCase())) { return null; }
            eventField = renamed.value; index += 2;
        }
        const mappings = outputMode === 'implicit' ? inputs : outputs;
        if (mappings.length >= 250 || mappings.some(row => row.eventField === eventField || row.lookupField === item.value)) { return null; }
        mappings.push({ lookupField: item.value, eventField, position: mappings.length + 1 });
    }
    return inputs.length ? { version: 1, inputs, outputs, outputMode } : null;
}

export function automaticLookupInputs(declaration: string): { inputs: string[]; complete: boolean } {
    const mapping = automaticLookupMapping(declaration);
    return { inputs: mapping?.inputs.map(row => row.eventField) ?? [], complete: mapping !== null };
}

export const fieldContext = (source: ContentObject, target: ContentObject | undefined, app: string,
    selector: FieldContextEvidence['selector'] = null): FieldContextEvidence => {
    let dependency: FieldContextEvidence['dependency'] = 'unresolved';
    if (target) { dependency = target.app === app ? 'local_candidate' : 'exported_candidate'; }
    return { declaringApp: source.app, dependencyApp: target?.app ?? null, invokingApp: app,
        declaration: source.app === app ? 'local_candidate' : 'exported_candidate', dependency, selector };
};

/** Read only the native REST handler's canonical rule fields; never execute SPL. */
export function parseAutomaticLookup(text: string, sourceLocation: string): ParsedSource {
    const fail = (message: string): ParsedSource => ({ references: [], warnings: [message],
        gaps: [{ targets: ['lookup', 'automatic_lookup'], message, sourceLocation }] });
    let value: Record<string, unknown>;
    try {
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return fail('Automatic lookup configuration is not an object.'); }
        value = parsed as Record<string, unknown>;
    } catch { return fail('Automatic lookup configuration could not be parsed.'); }
    const string = (key: string): string => typeof value[key] === 'string' ? value[key].trim() : '';
    const stanza = string('stanza'); const attribute = string('attribute'); const transform = string('transform');
    if (!stanza || !/^LOOKUP-[^\r\n]+$/.test(attribute) || string('type') !== 'LOOKUP') {
        return fail('Automatic lookup stanza, LOOKUP class or type is missing or unsupported.');
    }
    let scopeField: EventSelector['field'] = 'sourcetype';
    if (stanza.startsWith('host::')) { scopeField = 'host'; }
    else if (stanza.startsWith('source::')) { scopeField = 'source'; }
    const scopeValue = scopeField === 'sourcetype' ? stanza : stanza.slice(scopeField.length + 2);
    const disabledValue = typeof value.disabled === 'string' ? value.disabled.trim().toLowerCase() : value.disabled;
    const disabled = [true, 1, '1', 'true'].includes(disabledValue as string | number | boolean);
    if (!transform || /[$*{}\r\n]/.test(transform)) {
        return fail('Automatic lookup target definition is empty or dynamic; no missing target is asserted.');
    }
    const declaration = string('value');
    const first = declaration.match(/^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+)/)?.[0] ?? '';
    const firstName = /^['"]/.test(first) ? first.slice(1, -1).replace(/\\(["'\\])/g, '$1') : first;
    if (!declaration || (firstName !== transform && !declaration.startsWith(`${transform} `))) {
        return fail('Automatic lookup canonical target and returned LOOKUP value disagree or are unavailable.');
    }
    const mapping = firstName === transform ? automaticLookupMapping(declaration) : null;
    const rule: AutomaticLookupRule = { stanza, attribute, transform, scopeField, scopeValue,
        exactScope: compilePropsPattern({ field: scopeField, value: scopeValue, exact: false }).kind === 'literal', disabled,
        fieldInputs: mapping?.inputs.map(row => row.eventField) ?? [], fieldInputsComplete: mapping !== null,
        ...(mapping ? { fieldMapping: mapping } : {}) };
    return { warnings: [], gaps: [], automaticLookup: rule, references: disabled ? [] : [{
        targetType: 'lookup', targetName: transform, relation: 'uses_lookup', confidence: 'high',
        evidence: `props.conf [${stanza}] ${attribute} explicitly names lookup definition ${transform}; this is configuration, not proof of execution`,
        sourceLocation: `${sourceLocation}.${attribute}`,
    }] };
}

interface IndexedRule { object: ContentObject; rule: AutomaticLookupRule }
/** One scope index per scan. Matching is bounded before generating graph edges. */
export function buildAutomaticLookupMatcher(rules: IndexedRule[], objects: ContentObject[], catalog: { complete: boolean; privatePossible: boolean; visibility?: FieldVisibility }): {
    callers: (object: ContentObject, parsed: ParsedSource) => ParsedSource;
    bindings: (object: ContentObject, parsed: ParsedSource) => ParsedSource;
} {
    const scopes = createPropsPatternIndex<IndexedRule>();
    const patternWork = { remaining: PROPS_PATTERN_SCAN_WORK };
    const definitions = new Map<string, Set<string>>();
    const definitionContexts = new Map<string, string[]>();
    const identities = new Set(objects.filter(row => row.objectType === 'Automatic Lookup').map(row => `${row.app}\0${row.canonicalName}`));
    const privateNames = new Set(catalog.visibility?.privateTargets?.filter(row => row.collector === 'automatic_lookups').map(row => `${row.app}\0${row.name}`));
    const privateApps = new Set(catalog.visibility?.privateObjects.filter(row => row.collector === 'automatic_lookups' && row.count > 0).map(row => row.app));
    const privateGaps = new Set(catalog.visibility?.privateTargetGaps?.filter(row => row.collector === 'automatic_lookups').map(row => row.app));
    const sourceAvailable = (object: ContentObject, app: string): boolean =>
        !(object.app !== app && identities.has(`${app}\0${object.canonicalName}`)) &&
        !privateGaps.has(app) && !privateGaps.has('unknown') && !privateApps.has('unknown') &&
        !(catalog.visibility?.privateTargets ? privateNames.has(`${app}\0${object.canonicalName}`) : privateApps.has(app));
    let remaining = AUTOMATIC_SCAN_EDGE_LIMIT;
    let visitsRemaining = AUTOMATIC_CANDIDATE_VISIT_LIMIT;
    rules.filter(({ rule }) => !rule.disabled).sort((a, b) => a.object.canonicalName.localeCompare(b.object.canonicalName) || a.object.objectId.localeCompare(b.object.objectId)).forEach((item) => {
        if (!['app', 'global'].includes(item.object.sharing ?? '')) { return; }
        scopes.add({ field: item.rule.scopeField, value: item.rule.scopeValue, exact: item.rule.exactScope }, item.object.app, item.object.sharing === 'global', item);
    });
    objects.filter((object) => object.objectType === 'Lookup Definition' && ['app', 'global'].includes(object.sharing ?? '')).forEach((object) => {
        const list = definitions.get(object.canonicalName) ?? new Set<string>(); list.add(object.app); definitions.set(object.canonicalName, list);
    });
    definitions.forEach((apps, name) => definitionContexts.set(name, [...apps].sort()));
    const limited = (parsed: ParsedSource, message: string, target: 'lookup' | 'automatic_lookup'): void => {
        if (!parsed.warnings.includes(message)) { parsed.warnings.push(message); }
        if (!parsed.gaps?.some(row => row.message === message && row.targets.includes(target))) {
            parsed.gaps?.push({ targets: [target], message, sourceLocation: 'automatic-lookup matching' });
        }
    };
    return {
        callers(object, parsed) {
            if (!parsed.hasEventSearch || (!rules.length && catalog.complete && !catalog.privatePossible)) { return parsed; }
            const result = { ...parsed, references: [...parsed.references], warnings: [...parsed.warnings], gaps: [...(parsed.gaps ?? [])] };
            if (!['Saved Search', 'Report', 'Alert', 'Dashboard'].includes(object.objectType)) {
                limited(result, 'Implicit props applicability inherits the invoking search namespace; no caller-app automatic lookup binding is inferred for this reusable source.', 'automatic_lookup');
                return result;
            }
            // A finite exact selector is a witness of possibility, not a complete
            // event domain: OR branches, other scopes and field availability remain unknown.
            limited(result, catalog.complete ? AUTOMATIC_APPLICABILITY_LIMITATION :
                'The automatic lookup catalog is unavailable or incomplete. Potential implicit dependencies cannot be fully assessed.', 'automatic_lookup');
            const seen = new Set<string>();
            let count = 0;
            let visits = 0;
            const sourceWork = { remaining: PROPS_PATTERN_SOURCE_WORK };
            for (const selector of parsed.eventSelectors ?? []) {
                // Do not copy a potentially large bucket, or let repeated/withheld
                // candidates evade the work budget merely because no edge emits.
                for (const { item: { object: candidate, rule }, pattern } of scopes.candidates(selector, object.app)) {
                        if (visits >= AUTOMATIC_SOURCE_VISIT_LIMIT || visitsRemaining <= 0) {
                            limited(result, 'Automatic lookup caller candidate-visit budget reached; additional possible dependencies remain unverified.', 'automatic_lookup');
                            return result;
                        }
                        visits += 1; visitsRemaining -= 1;
                        const matched = matchPropsPattern(pattern, selector, [sourceWork, patternWork]);
                        if (matched === 'budget') { limited(result, 'Automatic lookup pattern-work budget reached; additional possible dependencies remain unverified.', 'automatic_lookup'); return result; }
                        if (!['match', 'case_ambiguous'].includes(matched)) { continue; }
                        if (!sourceAvailable(candidate, object.app)) { limited(result, 'Local, private or omitted automatic lookup declarations can override this source; no shared caller binding is guessed for this context.', 'automatic_lookup'); continue; }
                        const identity = `${candidate.canonicalName}\0${selector.sourceLocation}`;
                        if (seen.has(identity)) { continue; }
                        seen.add(identity);
                        if (count >= AUTOMATIC_MATCH_LIMIT || remaining <= 0) {
                            limited(result, `Automatic lookup caller matching reached a safety limit (${AUTOMATIC_MATCH_LIMIT} per object / ${AUTOMATIC_SCAN_EDGE_LIMIT} per scan); additional possible dependencies are omitted.`, 'automatic_lookup');
                            return result;
                        }
                        result.references.push({ targetType: 'automatic_lookup', targetName: candidate.canonicalName, targetObjectId: candidate.objectId,
                            relation: 'may_apply_automatic_lookup', confidence: 'medium',
                            evidence: `Potential automatic lookup: positive ${selector.field}=${selector.value} has a ${pattern.kind === 'default' ? 'captured default fallback' : `${pattern.kind} scope possibility`} in props.conf [${rule.stanza}] ${rule.attribute}. This does not establish field availability, effective precedence or actual execution.`,
                            fieldProvenance: { version: 1, kind: 'event_scope', fields: [], scope: { field: rule.scopeField, value: rule.scopeValue, exact: rule.exactScope },
                                consumerPhase: null, producerPhase: 'lookup', transformPositions: [], viaObjectIds: [], contextApps: [object.app], invocation: 'fixed_app',
                                contexts: [fieldContext(object, candidate, object.app, selector)] },
                            sourceLocation: selector.sourceLocation });
                        count += 1; remaining -= 1;
                }
            }
            return result;
        },
        bindings(object, parsed) {
            if (!parsed.automaticLookup || object.sharing !== 'global' || parsed.automaticLookup.disabled) { return parsed; }
            const rule = parsed.automaticLookup;
            const contexts = definitionContexts.get(rule.transform) ?? [];
            const alternatives = contexts.length - Number(definitions.get(rule.transform)?.has(object.app) ?? false);
            if (!alternatives) { return parsed; }
            const result = { ...parsed, references: [...parsed.references], warnings: [...parsed.warnings], gaps: [...(parsed.gaps ?? [])] };
            limited(result, 'Exported automatic lookup definition resolution can differ by invoking app. Potential app-context bindings are included, not a single proven runtime target.', 'lookup');
            let count = 0;
            let visits = 0;
            let budgetReached = false;
            for (const app of contexts) {
                if (visits >= AUTOMATIC_SOURCE_VISIT_LIMIT || visitsRemaining <= 0) {
                    limited(result, 'Automatic lookup binding candidate-visit budget reached; additional invocation contexts remain unverified.', 'lookup');
                    return result;
                }
                visits += 1; visitsRemaining -= 1;
                if (app === object.app) { continue; }
                if (remaining <= 0 || count >= AUTOMATIC_MATCH_LIMIT) { budgetReached = true; break; }
                if (!sourceAvailable(object, app)) {
                    limited(result, 'A local, private or omitted automatic lookup declaration can override this exported source in an invoking app; its guessed binding is withheld.', 'lookup');
                    continue;
                }
                result.references.push({ targetType: 'lookup', targetName: rule.transform, relation: 'may_use_lookup',
                    confidence: 'medium', contextApp: app,
                    evidence: `Exported props rule may resolve lookup definition ${rule.transform} in invoking app ${app}; this is a possible namespace binding, not observed execution.`,
                    sourceLocation: `props.conf [${rule.stanza}].${rule.attribute}` });
                remaining -= 1; count += 1;
            }
            if (budgetReached) {
                limited(result, 'Potential automatic lookup definition bindings reached the matching safety limit; additional invocation contexts remain unverified.', 'lookup');
            }
            return result;
        },
    };
}
