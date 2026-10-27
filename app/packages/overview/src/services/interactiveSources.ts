/* eslint-disable no-restricted-syntax, no-continue -- Bounded XML traversal stops before inspecting more nodes or references. */
/** Read declared metadata only. Never follow a link, evaluate a token or run SPL. */
import { ParsedReference, ParsedSource, ParserCoverageGap, ReferenceTarget, parseSpl, SPL_SOURCE_LIMIT } from './dependencyParser';

export const INTERACTION_REFERENCE_LIMIT = 250;
export const NAVIGATION_NODE_LIMIT = 1000;
export const NAVIGATION_DEPTH_LIMIT = 3;
export const INTERACTION_SCAN_CHARACTER_LIMIT = 8 * 1024 * 1024;
export const INTERACTION_SCAN_REFERENCE_LIMIT = 50000;
const application = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(value) && !['.', '..'].includes(value);
const hasControl = (value: string): boolean => Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const literal = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1024 && value.trim() === value && !/[$*?{}\\]/.test(value) && !hasControl(value);
const namespaces: ReferenceTarget[] = ['macro', 'lookup', 'lookup_file', 'saved_search', 'data_model', 'event_type', 'tag_binding'];
const create = (): ParsedSource => ({ references: [], warnings: [], gaps: [] });
function gap(result: ParsedSource, message: string, sourceLocation: string, targets: ReferenceTarget[] | 'all' = [], extra: Partial<ParserCoverageGap> = {}): void {
    if (!result.warnings.includes(message)) { result.warnings.push(message); }
    result.gaps!.push({ targets, message, sourceLocation, ...extra });
}
function add(result: ParsedSource, targetType: ReferenceTarget, name: string, app: string, relation: string, sourceLocation: string): void {
    if (result.references.length >= INTERACTION_REFERENCE_LIMIT) {
        if (!result.warnings.some(value => value.startsWith('Interaction reference budget'))) {
            gap(result, `Interaction reference budget (${INTERACTION_REFERENCE_LIMIT}) reached; additional configured references are unverified.`, sourceLocation, 'all');
        }
        return;
    }
    result.references.push({ targetType, targetName: name, contextApp: app, exactNamespace: true,
        absenceUnverified: true, relation, confidence: 'high', sourceLocation,
        evidence: `Declared ${relation.replace(/_/g, ' ')}: ${targetType === 'dashboard' ? 'view' : targetType.replace(/_/g, ' ')} ${name} in exact app ${app}. This is a configured interaction, not observed execution or activity.` });
}

/** Only root-relative /app/<app>[/<view>] routes, with an optional literal locale.
 * Query strings/fragments are not interpreted, persisted or fetched. */
export function parseInternalLink(uri: unknown, sourceLocation = 'link.uri'): ParsedSource {
    const result = create();
    if (typeof uri !== 'string' || !uri || uri.length > 8192 || uri.trim() !== uri || /[\\ ]/.test(uri) || hasControl(uri)) {
        gap(result, 'Link URI is missing, oversized or outside the bounded internal-route syntax; no target is guessed.', sourceLocation, ['app', 'dashboard'], { invocationNamespaceUnverified: true });
        return result;
    }
    const path = uri.split(/[?#]/, 1)[0];
    const match = path.match(/^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?app\/([^/]+)(?:\/([^/]+))?\/?$/);
    if (!match) {
        gap(result, 'External, relative, dynamic or non-view routes are not followed or resolved as internal dependencies.', sourceLocation, ['app', 'dashboard'], { invocationNamespaceUnverified: true });
        return result;
    }
    let app: string; let view: string | undefined;
    try { app = decodeURIComponent(match[1]); view = match[2] === undefined ? undefined : decodeURIComponent(match[2]); }
    catch { gap(result, 'Internal route encoding is malformed; no identity is guessed.', sourceLocation, ['app', 'dashboard'], { invocationNamespaceUnverified: true }); return result; }
    if (!application(app) || (view !== undefined && (!literal(view) || /[%/:#]/.test(view) || ['.', '..'].includes(view)))) {
        gap(result, 'Internal route has a dynamic, encoded separator or ambiguous app/view identity; no target is guessed.', sourceLocation, ['app', 'dashboard'], { invocationNamespaceUnverified: true });
        return result;
    }
    add(result, 'app', app, app, 'opens_app', sourceLocation);
    if (view) { add(result, 'dashboard', view, app, 'opens_view', sourceLocation); }
    else { gap(result, 'An app-only link does not identify its runtime landing view.', sourceLocation, ['dashboard'], { contextApp: app }); }
    if (uri.length !== path.length) {
        gap(result, 'Link query/fragment parameters are not interpreted; additional search, token or redirect dependencies remain unverified.', sourceLocation, 'all', { contextApp: app, invocationNamespaceUnverified: true });
    }
    return result;
}

export function parseWorkflowAction(text: string, sourceLocation = 'workflow_actions.conf'): ParsedSource {
    const result = create();
    if (text.length > SPL_SOURCE_LIMIT) { gap(result, 'Workflow metadata exceeds the source parse budget.', sourceLocation, 'all', { invocationNamespaceUnverified: true }); return result; }
    let value: Record<string, unknown>;
    try {
        const data: unknown = JSON.parse(text);
        if (!data || typeof data !== 'object' || Array.isArray(data)) { throw new Error(); }
        value = data as Record<string, unknown>;
    } catch { gap(result, 'Workflow metadata is unavailable or malformed.', sourceLocation, 'all', { invocationNamespaceUnverified: true }); return result; }
    // Native workflow definitions require both type and label. A missing label
    // is not invented from the stanza name and cannot prove an executable action.
    if (typeof value.label !== 'string' || !value.label.trim() || !['search', 'link'].includes(String(value.type))) {
        gap(result, 'Workflow type or required label is missing/unsupported; no runnable action is inferred.', sourceLocation, 'all', { invocationNamespaceUnverified: true }); return result;
    }
    gap(result, 'Workflow references describe configuration, not event-menu applicability, field availability or observed execution.', sourceLocation);
    const state = typeof value.disabled === 'string' ? value.disabled.toLowerCase() : value.disabled;
    if (![false, 0, 'false', '0'].includes(state as boolean | number | string)) {
        gap(result, 'Workflow action is disabled or its enabled state is unknown; configured links are not evidence of current activity.', sourceLocation);
    }
    if (value.type === 'link') {
        if (value['link.method'] !== undefined && value['link.method'] !== 'get') {
            gap(result, 'POST or unsupported workflow link methods are not resolved as navigation; no request is sent.', `${sourceLocation}.link.method`, ['app', 'dashboard'], { invocationNamespaceUnverified: true });
            return result;
        }
        const parsed = parseInternalLink(value['link.uri'], `${sourceLocation}.link.uri`);
        result.references.push(...parsed.references); result.warnings.push(...parsed.warnings); result.gaps!.push(...(parsed.gaps ?? []));
        return result;
    }
    const app = application(value['search.app']) ? value['search.app'] : null;
    if (app) { add(result, 'app', app, app, 'runs_in_app', `${sourceLocation}.search.app`); }
    else { gap(result, 'Workflow search namespace is runtime-inherited or dynamic; the owning app is not assumed to be the invoking app.', `${sourceLocation}.search.app`, namespaces, { invocationNamespaceUnverified: true }); }
    if (literal(value['search.view']) && app) {
        add(result, 'dashboard', value['search.view'], app, 'opens_view', `${sourceLocation}.search.view`);
    } else {
        gap(result, 'Workflow view or its invoking app is runtime-inherited/dynamic; no owning-app view is guessed.', `${sourceLocation}.search.view`, ['dashboard'], app ? { contextApp: app } : { invocationNamespaceUnverified: true });
    }
    const search = value['search.search_string'];
    if (typeof search !== 'string' || !search.trim() || /\$/.test(search)) {
        gap(result, 'Workflow search body is unavailable or contains runtime field tokens; no partial template is treated as executable SPL.', `${sourceLocation}.search.search_string`, 'all', app ? { contextApp: app } : { invocationNamespaceUnverified: true });
        return result;
    }
    const parsed = parseSpl(search, `${sourceLocation}.search.search_string`);
    const room = INTERACTION_REFERENCE_LIMIT - result.references.length;
    for (const reference of parsed.references.slice(0, room)) {
        const globalTarget = ['index', 'sourcetype'].includes(reference.targetType);
        result.references.push({ ...reference, ...(app ? { contextApp: app } : { resolutionUncertain: !globalTarget }), absenceUnverified: true });
    }
    if (parsed.references.length > room) {
        gap(result, `Interaction reference budget (${INTERACTION_REFERENCE_LIMIT}) reached; additional configured references are unverified.`, sourceLocation, 'all', app ? { contextApp: app } : { invocationNamespaceUnverified: true });
    }
    result.warnings.push(...parsed.warnings);
    result.gaps!.push(...(parsed.gaps ?? []).map(item => ({ ...item, ...(app ? { contextApp: app } : { invocationNamespaceUnverified: true }) })));
    // Deliberately do not infer implicit props callers from a workflow template.
    return result;
}

export function parseNavigation(text: string, app: string | undefined, sourceLocation = 'eai:data'): ParsedSource {
    const result = create();
    if (!application(app) || text.length > SPL_SOURCE_LIMIT || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text) || typeof DOMParser === 'undefined') {
        gap(result, 'Navigation app identity/XML parser is unavailable, or XML exceeds the safe source subset; no links are guessed.', sourceLocation, ['app', 'dashboard', 'saved_search'], { invocationNamespaceUnverified: true }); return result;
    }
    const document = new DOMParser().parseFromString(text, 'text/xml');
    const root = document.documentElement;
    if (document.querySelector('parsererror') || root?.tagName !== 'nav' || root.namespaceURI) {
        gap(result, 'Navigation XML is malformed or not a supported nav document.', sourceLocation, ['app', 'dashboard', 'saved_search'], { invocationNamespaceUnverified: true }); return result;
    }
    if (root.hasAttribute('search_view')) {
        const name = root.getAttribute('search_view');
        if (literal(name)) { add(result, 'dashboard', name, app, 'uses_search_view', `${sourceLocation}.nav@search_view`); }
        else { gap(result, 'Navigation search view is dynamic or unavailable.', `${sourceLocation}.nav@search_view`, ['dashboard']); }
    }
    let visited = 0;
    const walk = (parent: Element, path: string, depth: number): void => {
        for (let index = 0; index < parent.children.length; index += 1) {
            if (visited >= NAVIGATION_NODE_LIMIT || result.references.length >= INTERACTION_REFERENCE_LIMIT) {
                gap(result, `Navigation inspection/reference budget (${NAVIGATION_NODE_LIMIT} nodes / ${INTERACTION_REFERENCE_LIMIT} references) reached; remaining items are unverified.`, path, ['app', 'dashboard', 'saved_search'], { invocationNamespaceUnverified: true }); return;
            }
            const node = parent.children[index]; visited += 1;
            const location = `${path}.${node.tagName}[${index + 1}]`;
            if (node.namespaceURI) { gap(result, 'Namespaced/custom navigation elements are not interpreted.', location, ['app', 'dashboard', 'saved_search'], { invocationNamespaceUnverified: true }); continue; }
            if (node.tagName === 'collection') {
                if (depth >= NAVIGATION_DEPTH_LIMIT) { gap(result, 'Navigation collection nesting exceeds the supported depth; nested links are unverified.', location, ['app', 'dashboard', 'saved_search'], { invocationNamespaceUnverified: true }); }
                else { walk(node, location, depth + 1); }
            } else if (['view', 'saved'].includes(node.tagName)) {
                const type: ReferenceTarget = node.tagName === 'view' ? 'dashboard' : 'saved_search';
                const name = node.getAttribute('name');
                if (!literal(name) || node.hasAttribute('source') || node.hasAttribute('match') || node.hasAttribute('app') || node.hasAttribute('namespace')) {
                    gap(result, 'Dynamic navigation lists, unsupported namespace attributes or nonliteral names are not expanded into dependencies.', location, [type],
                        node.hasAttribute('app') || node.hasAttribute('namespace') ? { invocationNamespaceUnverified: true } : {}); continue;
                }
                add(result, type, name, app, type === 'dashboard' ? 'navigates_to' : 'links_to_report', `${location}@name`);
                if (node.tagName === 'saved' && node.hasAttribute('view')) {
                    const view = node.getAttribute('view');
                    if (literal(view)) { add(result, 'dashboard', view, app, 'opens_view', `${location}@view`); }
                    else { gap(result, 'Saved-report rendering view is dynamic or unavailable.', `${location}@view`, ['dashboard']); }
                }
            } else if (node.tagName === 'a') {
                const parsed = parseInternalLink(node.getAttribute('href'), `${location}@href`);
                const room = INTERACTION_REFERENCE_LIMIT - result.references.length;
                result.references.push(...parsed.references.slice(0, room)); result.warnings.push(...parsed.warnings); result.gaps!.push(...(parsed.gaps ?? []));
                if (parsed.references.length > room) { gap(result, 'Navigation reference budget reached; remaining link targets are unverified.', location, ['app', 'dashboard']); }
            } else if (node.tagName !== 'divider') {
                gap(result, 'Custom navigation elements are not interpreted; nested content is not treated as an authoritative menu.', location, ['app', 'dashboard', 'saved_search'], { invocationNamespaceUnverified: true });
            }
        }
    };
    walk(root, `${sourceLocation}.nav`, 1);
    result.warnings = [...new Set(result.warnings)];
    return result;
}

/** One factory per scan; duplicates and unresolved candidates spend the same
 * budget as resolved links. Exhausting the budget never becomes an empty source. */
export function createInteractionParser(): (kind: 'workflow_action' | 'navigation', text: string, app: string | undefined, sourceLocation: string) => ParsedSource {
    let remainingCharacters = INTERACTION_SCAN_CHARACTER_LIMIT;
    let remainingReferences = INTERACTION_SCAN_REFERENCE_LIMIT;
    return (kind, text, app, sourceLocation) => {
        const budgetGap = (result: ParsedSource): ParsedSource => {
            gap(result, `Interaction whole-scan budget (${INTERACTION_SCAN_CHARACTER_LIMIT} source characters / ${INTERACTION_SCAN_REFERENCE_LIMIT} inspected references) reached; additional dependencies remain unverified.`,
                sourceLocation, 'all', { invocationNamespaceUnverified: true }); return result;
        };
        if (text.length > remainingCharacters || remainingReferences <= 0) { remainingCharacters = 0; return budgetGap(create()); }
        remainingCharacters -= text.length;
        const parsed = kind === 'navigation' ? parseNavigation(text, app, sourceLocation) : parseWorkflowAction(text, sourceLocation);
        if (parsed.references.length > remainingReferences) {
            parsed.references = parsed.references.slice(0, remainingReferences); remainingReferences = 0;
            return budgetGap(parsed);
        }
        remainingReferences -= parsed.references.length;
        return parsed;
    };
}
