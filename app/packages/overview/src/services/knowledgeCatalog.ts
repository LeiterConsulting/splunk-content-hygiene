/** Bounded native metadata contracts. No SPL, regex or customer code is executed. */
export interface NativeKnowledgeEntry {
    name?: unknown;
    acl?: unknown;
    content?: unknown;
}
export interface SharedKnowledgeIdentity {
    nativeName: string;
    app: string;
    owner: string | null;
    sharing: 'app' | 'global';
}
export interface CatalogIssue {
    code: 'private_excluded' | 'unsupported_visibility' | 'identity_unavailable' |
        'invalid_definition' | 'unknown_state' | 'encoded_value' | 'invalid_binding' | 'limit';
    message: string;
    sourceLocation: string;
}
export interface CatalogResult<T> { records: T[]; issues: CatalogIssue[] }
export interface EventTypeDefinition extends SharedKnowledgeIdentity {
    canonicalName: string;
    search: string;
    enabled: boolean | null;
    priority: number | null;
    sourceLocation: string;
}
export interface TagBinding extends SharedKnowledgeIdentity {
    canonicalName: string;
    tag: string;
    field: string;
    rawFieldValue: string;
    /** URI-like values are retained but not silently decoded into another identity. */
    literalFieldValue: string | null;
    configuredEnabled: boolean;
    enabled: boolean | null;
    sourceLocation: string;
}
export const MAX_TAG_BINDINGS_PER_STANZA = 250;
const record = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
const identifier = (value: unknown): value is string => typeof value === 'string' &&
    value.length > 0 && value.length <= 4096 && value.trim() === value &&
    !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const disabled = (value: unknown): boolean | null => {
    if ([true, 1, '1', 'true'].includes(value as boolean | number | string)) {return true;}
    if ([false, 0, '0', 'false'].includes(value as boolean | number | string)) {return false;}
    return null;
};
function bindingEnabled(configuredEnabled: boolean, parentDisabled: boolean | null): boolean | null {
    if (!configuredEnabled || parentDisabled === true) { return false; }
    return parentDisabled === false ? true : null;
}
export function decodeSharedKnowledgeIdentity(entry: NativeKnowledgeEntry, catalog: string): CatalogResult<SharedKnowledgeIdentity> {
    const content = record(entry.content);
    const acl = entry.acl === undefined ? record(content?.['eai:acl']) : record(entry.acl);
    // Check exclusion before reading names: private identities must never enter
    // persisted shared records, messages, or source-location examples.
    if (acl?.sharing === 'user') {return { records: [], issues: [{ code: 'private_excluded',
        message: 'Private knowledge object excluded from shared inventory.', sourceLocation: catalog }] };}
    if (acl?.sharing === 'system') {return { records: [], issues: [{ code: 'unsupported_visibility',
        message: 'System-scoped inheritance remains unverified in the supported shared catalog scope.', sourceLocation: catalog }] };}
    if (!identifier(entry.name) || !identifier(acl?.app) || (acl?.sharing !== 'app' && acl?.sharing !== 'global')) {
        return { records: [], issues: [{ code: 'identity_unavailable',
            message: 'Native namespace, identity or shared ACL is unavailable; no identity is guessed.', sourceLocation: catalog }] };
    }
    return { records: [{ nativeName: entry.name, app: acl.app,
        owner: identifier(acl.owner) && !['nobody', 'system'].includes(acl.owner) ? acl.owner : null,
        sharing: acl.sharing as 'app' | 'global' }], issues: [] };
}

export function decodeEventType(entry: NativeKnowledgeEntry, sourceLocation = 'saved/eventtypes'): CatalogResult<EventTypeDefinition> {
    const scope = decodeSharedKnowledgeIdentity(entry, 'saved/eventtypes');
    if (!scope.records.length) {return { records: [], issues: scope.issues };}
    const content = record(entry.content);
    const search = content?.search;
    if (typeof search !== 'string' || !search.trim() || search.length > 1024 * 1024) {
        return { records: [], issues: [{ code: 'invalid_definition',
            message: 'Event-type search metadata is missing, malformed or exceeds its parse budget.', sourceLocation }] };
    }
    const state = disabled(content?.disabled);
    const issues: CatalogIssue[] = state === null ? [{ code: 'unknown_state',
        message: 'Event-type enabled state is unknown; applicability is not assumed.', sourceLocation }] : [];
    const priority = typeof content?.priority === 'number' || typeof content?.priority === 'string'
        ? Number(content.priority) : NaN;
    return { records: [{ ...scope.records[0], canonicalName: scope.records[0].nativeName, search,
        enabled: state === null ? null : !state,
        priority: Number.isInteger(priority) && priority >= 1 && priority <= 10 ? priority : null,
        sourceLocation }], issues };
}

export function decodeTagBindings(entry: NativeKnowledgeEntry, sourceLocation = 'configs/conf-tags'): CatalogResult<TagBinding> {
    const scope = decodeSharedKnowledgeIdentity(entry, 'configs/conf-tags');
    if (!scope.records.length) {return { records: [], issues: scope.issues };}
    const content = record(entry.content);
    const name = scope.records[0].nativeName;
    const separator = name.indexOf('=');
    const field = name.slice(0, separator);
    const rawFieldValue = name.slice(separator + 1);
    if (!content || separator < 1 || !/^[A-Za-z_][\w.:-]*$/.test(field) || !identifier(rawFieldValue)) {
        return { records: [], issues: [{ code: 'invalid_binding',
            message: 'Tag stanza is not a supported literal field/value binding.', sourceLocation }] };
    }
    const issues: CatalogIssue[] = [];
    const records: TagBinding[] = [];
    const literalFieldValue = /%[\da-f]{2}/i.test(rawFieldValue) ? null : rawFieldValue;
    if (literalFieldValue === null) {issues.push({ code: 'encoded_value',
        message: 'URI-like tag field value retained verbatim; target identity needs verified encoding semantics.', sourceLocation });}
    const parentDisabled = disabled(content.disabled);
    if (parentDisabled === null) {issues.push({ code: 'unknown_state',
        message: 'Tag stanza enabled state is unknown; active applicability is not assumed.', sourceLocation });}
    Object.keys(content).sort().forEach((tag) => {
        if (tag.startsWith('eai:')) {
            if (content[tag] === 'enabled' || content[tag] === 'disabled') {issues.push({ code: 'invalid_binding',
                message: 'Reserved tag attribute cannot be distinguished from native metadata.', sourceLocation });}
            return;
        }
        if (tag === 'disabled' && disabled(content[tag]) !== null) {return;}
        if (!identifier(tag) || tag === 'disabled' || (content[tag] !== 'enabled' && content[tag] !== 'disabled')) {
            issues.push({ code: 'invalid_binding', message: 'Tag attribute is unsupported or indistinguishable from native metadata.', sourceLocation });
            return;
        }
        if (records.length >= MAX_TAG_BINDINGS_PER_STANZA) {
            if (!issues.some(issue => issue.code === 'limit')) {issues.push({ code: 'limit',
                message: `Tag stanza exceeds the ${MAX_TAG_BINDINGS_PER_STANZA}-binding budget; additional bindings are unverified.`, sourceLocation });}
            return;
        }
        const configuredEnabled = content[tag] === 'enabled';
        records.push({ ...scope.records[0], canonicalName: JSON.stringify([name, tag]), tag,
            field, rawFieldValue, literalFieldValue, configuredEnabled,
            enabled: bindingEnabled(configuredEnabled, parentDisabled),
            sourceLocation: `${sourceLocation}[${JSON.stringify(name)}][${JSON.stringify(tag)}]` });
    });
    return { records, issues };
}
