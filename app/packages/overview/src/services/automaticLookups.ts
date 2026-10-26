/* eslint-disable no-restricted-syntax, no-continue -- Bounded indexed matching exits immediately at the per-source/scan budgets. */
import { ContentObject } from '../types';
import { AutomaticLookupRule, EventSelector, ParsedReference, ParsedSource } from './dependencyParser';

export const AUTOMATIC_MATCH_LIMIT = 250;
export const AUTOMATIC_SCAN_EDGE_LIMIT = 50000;
export const AUTOMATIC_APPLICABILITY_LIMITATION =
    'Automatic lookup caller links are potential matches of positive exact event selectors, not observed execution. Wildcard/implicit scopes, props precedence, sourcetype renames, field availability and runtime invocation context remain unverified.';

const exactScope = (value: string): boolean => Boolean(value) &&
    !/[$*+?()[\]{}|^\\]/.test(value) && !value.includes('...');
// Ordinary SPL search field values are case-insensitive. Props identities are
// unchanged; case variants are separate possible rules, not merged identities.
const scopeKey = (field: EventSelector['field'], value: string): string =>
    `${field}\0${value.toLowerCase()}`;

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
    const disabled = [true, 1, '1', 'true'].includes(value.disabled as string | number | boolean);
    if (!transform || /[$*{}\r\n]/.test(transform)) {
        return fail('Automatic lookup target definition is empty or dynamic; no missing target is asserted.');
    }
    const declaration = string('value');
    const first = declaration.match(/^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+)/)?.[0] ?? '';
    const firstName = /^['"]/.test(first) ? first.slice(1, -1).replace(/\\(["'\\])/g, '$1') : first;
    if (!declaration || (firstName !== transform && !declaration.startsWith(`${transform} `))) {
        return fail('Automatic lookup canonical target and returned LOOKUP value disagree or are unavailable.');
    }
    const rule: AutomaticLookupRule = { stanza, attribute, transform, scopeField, scopeValue,
        exactScope: exactScope(scopeValue) && stanza !== 'default' && !/^(?:rule|delayedrule)::/.test(stanza), disabled };
    return { warnings: [], gaps: [], automaticLookup: rule, references: disabled ? [] : [{
        targetType: 'lookup', targetName: transform, relation: 'uses_lookup', confidence: 'high',
        evidence: `props.conf [${stanza}] ${attribute} explicitly names lookup definition ${transform}; this is configuration, not proof of execution`,
        sourceLocation: `${sourceLocation}.${attribute}`,
    }] };
}

interface IndexedRule { object: ContentObject; rule: AutomaticLookupRule }
/** One scope index per scan. Matching is bounded before generating graph edges. */
export function buildAutomaticLookupMatcher(rules: IndexedRule[], objects: ContentObject[], catalog: { complete: boolean; privatePossible: boolean }): {
    callers: (object: ContentObject, parsed: ParsedSource) => ParsedSource;
    bindings: (object: ContentObject, parsed: ParsedSource) => ParsedSource;
} {
    const scopes = new Map<string, IndexedRule[]>();
    const definitions = new Map<string, Set<string>>();
    const definitionContexts = new Map<string, string[]>();
    let remaining = AUTOMATIC_SCAN_EDGE_LIMIT;
    rules.filter(({ rule }) => rule.exactScope && !rule.disabled).forEach((item) => {
        if (!['app', 'global'].includes(item.object.sharing ?? '')) { return; }
        const key = `${scopeKey(item.rule.scopeField, item.rule.scopeValue)}\0${item.object.sharing === 'global' ? '*' : item.object.app}`;
        const list = scopes.get(key) ?? []; list.push(item); scopes.set(key, list);
    });
    scopes.forEach((list) => list.sort((a, b) => a.object.canonicalName.localeCompare(b.object.canonicalName) || a.object.objectId.localeCompare(b.object.objectId)));
    objects.filter((object) => object.objectType === 'Lookup Definition' && ['app', 'global'].includes(object.sharing ?? '')).forEach((object) => {
        const list = definitions.get(object.canonicalName) ?? new Set<string>(); list.add(object.app); definitions.set(object.canonicalName, list);
    });
    definitions.forEach((apps, name) => definitionContexts.set(name, [...apps].sort()));
    const limited = (parsed: ParsedSource, message: string, target: 'lookup' | 'automatic_lookup'): void => {
        parsed.warnings.push(message);
        parsed.gaps?.push({ targets: [target], message, sourceLocation: 'automatic-lookup matching' });
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
            for (const selector of parsed.eventSelectors ?? []) {
                const key = scopeKey(selector.field, selector.value);
                const candidates = [...(scopes.get(`${key}\0${object.app}`) ?? []), ...(scopes.get(`${key}\0*`) ?? [])];
                for (const { object: candidate, rule } of candidates) {
                    if (seen.has(candidate.canonicalName)) { continue; }
                    seen.add(candidate.canonicalName);
                    if (count >= AUTOMATIC_MATCH_LIMIT || remaining <= 0) {
                        limited(result, `Automatic lookup caller matching reached a safety limit (${AUTOMATIC_MATCH_LIMIT} per object / ${AUTOMATIC_SCAN_EDGE_LIMIT} per scan); additional possible dependencies are omitted.`, 'automatic_lookup');
                        return result;
                    }
                    result.references.push({ targetType: 'automatic_lookup', targetName: candidate.canonicalName,
                        relation: 'may_apply_automatic_lookup', confidence: 'medium',
                        evidence: `Potential automatic lookup: positive ${selector.field}=${selector.value} matches props.conf [${rule.stanza}] ${rule.attribute}. This does not establish field availability, precedence or actual execution.`,
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
            for (const app of contexts) {
                if (app === object.app) { continue; }
                if (remaining <= 0 || count >= AUTOMATIC_MATCH_LIMIT) { break; }
                result.references.push({ targetType: 'lookup', targetName: rule.transform, relation: 'may_use_lookup',
                    confidence: 'medium', contextApp: app,
                    evidence: `Exported props rule may resolve lookup definition ${rule.transform} in invoking app ${app}; this is a possible namespace binding, not observed execution.`,
                    sourceLocation: `props.conf [${rule.stanza}].${rule.attribute}` });
                remaining -= 1; count += 1;
            }
            if (count < alternatives) {
                limited(result, 'Potential automatic lookup definition bindings reached the matching safety limit; additional invocation contexts remain unverified.', 'lookup');
            }
            return result;
        },
    };
}
