/* eslint-disable no-restricted-syntax, no-continue -- Lexing and parsing have explicit byte/token/depth budgets. */
import { CatalogIssue, CatalogResult, decodeSharedKnowledgeIdentity, NativeKnowledgeEntry, SharedKnowledgeIdentity } from './knowledgeCatalog';
import { FieldAliasMapping, FieldDependencyProvenance, FieldLineageFacts, FieldScope } from '../types';

export type { FieldAliasMapping, FieldScope } from '../types';

/** Declared metadata only. This module never evaluates customer SPL or PCRE. */
export type FieldCatalog = 'field_extractions' | 'field_aliases' | 'calculated_fields' | 'field_transforms';
export interface FieldLineageDefinition extends SharedKnowledgeIdentity {
    canonicalName: string;
    objectType: 'Field Extraction' | 'Field Alias' | 'Calculated Field' | 'Field Transform';
    operation: 'inline' | 'report' | 'alias' | 'eval' | 'transform';
    stanza: string | null;
    attribute: string | null;
    scope: FieldScope | null;
    /** null also means the native props handler exposes no enabled flag. */
    enabled: boolean | null;
    inputs: string[];
    outputs: string[];
    aliases: FieldAliasMapping[];
    transforms: string[];
    syntax: 'declared' | 'partial' | 'unsupported';
    sourceLocation: string;
}
export const FIELD_DECLARATION_BYTES = 65536;
export const FIELD_DECLARATION_ITEMS = 250;
export const FIELD_EXPRESSION_TOKENS = 2048;
export const FIELD_EXPRESSION_DEPTH = 32;

/** An explicit projection prevents raw native declaration values leaking into KV. */
export function fieldLineageFacts(definition: FieldLineageDefinition, issues: CatalogIssue[]): FieldLineageFacts {
    return { version: 1, operation: definition.operation, stanza: definition.stanza, attribute: definition.attribute,
        scope: definition.scope, enabled: definition.enabled, inputs: definition.inputs, outputs: definition.outputs,
        aliases: definition.aliases, transforms: definition.transforms, syntax: definition.syntax,
        sourceLocation: definition.sourceLocation, limitations: [...new Set([...issues.map(issue => issue.message),
            ...(definition.enabled === null ? ['Native metadata does not establish enabled state; configured applicability is potential.'] : []),
            ...(definition.scope && !definition.scope.exact ? ['Pattern, default, rule or encoded props scopes are not evaluated by the exact-scope matcher.'] : [])])] };
}

/** Treat old/invalid compact cache values as unavailable, never as field proof. */
export function readFieldLineageFacts(value: unknown): FieldLineageFacts | undefined {
    const row = value as FieldLineageFacts | undefined;
    const names = (items: unknown): items is string[] => Array.isArray(items) && items.length <= FIELD_DECLARATION_ITEMS && items.every(identifier);
    if (!row || row.version !== 1 || !['inline', 'report', 'alias', 'eval', 'transform', 'lookup'].includes(row.operation) ||
        !['declared', 'partial', 'unsupported'].includes(row.syntax) || typeof row.sourceLocation !== 'string' ||
        ![null, true, false].includes(row.enabled) || !names(row.inputs) || !names(row.outputs) || !names(row.transforms) ||
        !Array.isArray(row.aliases) || row.aliases.length > FIELD_DECLARATION_ITEMS || row.aliases.some(mapping =>
            !mapping || !identifier(mapping.input) || !identifier(mapping.output) || !['AS', 'ASNEW'].includes(mapping.mode)) ||
        !Array.isArray(row.limitations) || row.limitations.length > FIELD_DECLARATION_ITEMS || row.limitations.some(message => typeof message !== 'string') ||
        (row.stanza !== null && !identifier(row.stanza)) || (row.attribute !== null && !identifier(row.attribute)) ||
        row.scope !== null && (!row.scope || !['sourcetype', 'host', 'source'].includes(row.scope.field) || !identifier(row.scope.value) || typeof row.scope.exact !== 'boolean')) { return undefined; }
    return { version: 1, operation: row.operation, stanza: row.stanza, attribute: row.attribute,
        scope: row.scope ? { field: row.scope.field, value: row.scope.value, exact: row.scope.exact } : null,
        enabled: row.enabled, inputs: row.inputs, outputs: row.outputs, aliases: row.aliases.map(mapping => ({ input: mapping.input, output: mapping.output, mode: mapping.mode })),
        transforms: row.transforms, syntax: row.syntax, sourceLocation: row.sourceLocation, limitations: row.limitations };
}

export function readFieldProvenance(value: unknown): FieldDependencyProvenance | undefined {
    const row = value as FieldDependencyProvenance | undefined;
    const names = (items: unknown): items is string[] => Array.isArray(items) && items.length <= FIELD_DECLARATION_ITEMS && items.every(identifier);
    const identities = (items: unknown): items is string[] => Array.isArray(items) && items.length <= FIELD_DECLARATION_ITEMS && items.every(item =>
        typeof item === 'string' && item.length > 0 && item.length <= 16384 && Array.from(item).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127));
    const phases = ['extraction', 'alias', 'calculated', 'lookup'];
    if (!row || row.version !== 1 || !['report_binding', 'field_input', 'event_scope'].includes(row.kind) ||
        !names(row.fields) || !identities(row.viaObjectIds) || !names(row.contextApps) ||
        !phases.includes(row.producerPhase) || row.consumerPhase !== null && !phases.includes(row.consumerPhase) ||
        !['fixed_app', 'invoking_app_unverified'].includes(row.invocation) ||
        !Array.isArray(row.transformPositions) || row.transformPositions.length > FIELD_DECLARATION_ITEMS ||
        row.transformPositions.some(position => !Number.isSafeInteger(position) || position < 1 || position > FIELD_DECLARATION_ITEMS) ||
        row.scope !== null && (!row.scope || !['sourcetype', 'host', 'source'].includes(row.scope.field) || !identifier(row.scope.value) || typeof row.scope.exact !== 'boolean')) { return undefined; }
    return { version: 1, kind: row.kind, fields: row.fields, scope: row.scope ? { field: row.scope.field, value: row.scope.value, exact: row.scope.exact } : null,
        consumerPhase: row.consumerPhase, producerPhase: row.producerPhase, transformPositions: row.transformPositions,
        viaObjectIds: row.viaObjectIds, contextApps: row.contextApps, invocation: row.invocation };
}
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 && value.trim() === value &&
    !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const literalField = (value: string): boolean => identifier(value) && !['$', '*', '?', '{', '}', '[', ']'].some(character => value.includes(character));
const withinBudget = (text: string): boolean => {
    if (text.length > FIELD_DECLARATION_BYTES) { return false; }
    let bytes = 0;
    for (const character of text) {
        const code = character.codePointAt(0)!;
        if (code <= 0x7f) { bytes += 1; }
        else if (code <= 0x7ff) { bytes += 2; }
        else if (code <= 0xffff) { bytes += 3; }
        else { bytes += 4; }
        if (bytes > FIELD_DECLARATION_BYTES) { return false; }
    }
    return true;
};
const state = (value: unknown): boolean | null => {
    if ([true, 1, '1', 'true'].includes(value as string | boolean | number)) { return false; }
    if ([false, 0, '0', 'false'].includes(value as string | boolean | number)) { return true; }
    return null;
};
export function declaredFieldScope(stanza: string): FieldScope {
    let field: FieldScope['field'] = 'sourcetype';
    if (stanza.startsWith('host::')) { field = 'host'; }
    else if (stanza.startsWith('source::')) { field = 'source'; }
    const value = field === 'sourcetype' ? stanza : stanza.slice(field.length + 2);
    return { field, value, exact: Boolean(value) && identifier(value) && stanza !== 'default' &&
        !/^(?:rule|delayedrule)::/.test(stanza) && !/[$*+?()[\]{}|^\\]/.test(value) && !value.includes('...') && !/%[\da-f]{2}/i.test(value) };
}
interface Token { value: string; kind: 'word' | 'field' | 'string' | 'number' | 'symbol' }
function tokens(text: string, expression: boolean): Token[] | null {
    if (!text.trim() || !withinBudget(text) || Array.from(text).some(character => {
        const code = character.charCodeAt(0); return code === 127 || (code < 32 && ![9, 10, 13].includes(code));
    })) { return null; }
    const result: Token[] = [];
    for (let i = 0; i < text.length;) {
        if (result.length >= FIELD_EXPRESSION_TOKENS) { return null; }
        const c = text[i];
        if (/\s/.test(c)) { i += 1; continue; }
        if (c === '"' || c === "'") {
            let value = ''; let closed = false; i += 1;
            while (i < text.length) {
                const next = text[i]; i += 1;
                if (next === c) { closed = true; break; }
                if (next === '\\') {
                    const escaped = text[i];
                    if (escaped === undefined) { return null; }
                    // String contents are opaque; field identifiers accept only
                    // literal quote/backslash escapes, not invented decoding.
                    if ((!expression || c === "'") && escaped !== c && escaped !== '\\') { return null; }
                    value += escaped; i += 1;
                } else { value += next; }
            }
            if (!closed || ((!expression || c === "'") && !literalField(value))) { return null; }
            result.push({ value, kind: expression && c === '"' ? 'string' : 'field' });
            continue;
        }
        const rest = text.slice(i);
        const number = expression ? rest.match(/^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/)?.[0] : null;
        if (number) { result.push({ value: number, kind: 'number' }); i += number.length; continue; }
        const word = rest.match(expression ? /^[A-Za-z_][A-Za-z0-9_]*/ : /^[A-Za-z_][A-Za-z0-9_.:-]*/)?.[0];
        if (word) { result.push({ value: word, kind: 'word' }); i += word.length; continue; }
        const operator = expression ? rest.match(/^(?:<=|>=|!=|==|[(),+*/%^.<>!=-])/)?.[0] : null;
        if (!operator) { return null; }
        result.push({ value: operator, kind: 'symbol' }); i += operator.length;
    }
    return result;
}
export interface CalculatedInputs { inputs: string[]; complete: boolean }
/** A small syntax parser, not an eval implementation. Unknown functions fail closed. */
export function calculatedFieldInputs(text: string): CalculatedInputs {
    const list = tokens(text, true);
    if (!list) { return { inputs: [], complete: false }; }
    const inputs = new Set<string>(); let cursor = 0;
    const precedence: Record<string, number> = { OR: 1, XOR: 2, AND: 3, '=': 4, '==': 4, '!=': 4, '<': 4, '>': 4, '<=': 4, '>=': 4, '.': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7, '^': 8 };
    const arity: Record<string, [number, number]> = { coalesce: [1, 250], if: [3, 3], case: [2, 250],
        lower: [1, 1], upper: [1, 1], len: [1, 1], isnull: [1, 1], isnotnull: [1, 1],
        trim: [1, 2], ltrim: [1, 2], rtrim: [1, 2], tonumber: [1, 2], tostring: [1, 2],
        abs: [1, 1], ceil: [1, 1], floor: [1, 1], round: [1, 2], min: [1, 250], max: [1, 250],
        json_extract: [2, 250], null: [0, 0], true: [0, 0], false: [0, 0] };
    const expression = (minimum: number, depth: number): boolean => {
        if (depth > FIELD_EXPRESSION_DEPTH) { return false; }
        const token = list[cursor]; if (!token) { return false; }
        cursor += 1;
        if (token.kind === 'symbol' && ['+', '-'].includes(token.value) || token.kind === 'word' && token.value.toUpperCase() === 'NOT') {
            if (!expression(9, depth + 1)) { return false; }
        } else if (token.kind === 'symbol' && token.value === '(') {
            if (!expression(1, depth + 1) || list[cursor]?.value !== ')') { return false; }
            cursor += 1;
        } else if (token.kind === 'word' && list[cursor]?.value === '(') {
            const limits = Object.prototype.hasOwnProperty.call(arity, token.value) ? arity[token.value] : undefined;
            if (!limits) { return false; }
            cursor += 1; let count = 0;
            if (list[cursor]?.value !== ')') {
                do {
                    if (count) { cursor += 1; }
                    if (!expression(1, depth + 1)) { return false; }
                    count += 1;
                } while (list[cursor]?.value === ',');
            }
            if (list[cursor]?.value !== ')' || count < limits[0] || count > limits[1] || token.value === 'case' && count % 2 !== 0) { return false; }
            cursor += 1;
        } else if (['word', 'field'].includes(token.kind)) {
            if (token.kind === 'word' && ['AND', 'OR', 'XOR'].includes(token.value.toUpperCase())) { return false; }
            inputs.add(token.value);
            if (inputs.size > FIELD_DECLARATION_ITEMS) { return false; }
        } else if (!['number', 'string'].includes(token.kind)) { return false; }
        while (cursor < list.length) {
            const next = list[cursor];
            const operator = next.kind === 'word' ? next.value.toUpperCase() : next.value;
            const rank = next.kind !== 'field' && next.kind !== 'string' ? precedence[operator] : undefined;
            if (rank === undefined || rank < minimum) { break; }
            cursor += 1;
            if (!expression(rank + 1, depth + 1)) { return false; }
        }
        return true;
    };
    const complete = expression(1, 0) && cursor === list.length;
    return { inputs: complete ? [...inputs] : [], complete };
}

const catalogs: Record<FieldCatalog, { endpoint: string; objectType: FieldLineageDefinition['objectType']; operation: FieldLineageDefinition['operation'] }> = {
    field_extractions: { endpoint: 'data/props/extractions', objectType: 'Field Extraction', operation: 'inline' },
    field_aliases: { endpoint: 'data/props/fieldaliases', objectType: 'Field Alias', operation: 'alias' },
    calculated_fields: { endpoint: 'data/props/calcfields', objectType: 'Calculated Field', operation: 'eval' },
    field_transforms: { endpoint: 'data/transforms/extractions', objectType: 'Field Transform', operation: 'transform' },
};
export function decodeFieldLineage(entry: NativeKnowledgeEntry, catalog: FieldCatalog): CatalogResult<FieldLineageDefinition> {
    if (!Object.prototype.hasOwnProperty.call(catalogs, catalog)) {
        return { records: [], issues: [{ code: 'invalid_definition', message: 'Unsupported field-lineage catalog.', sourceLocation: 'field-lineage' }] };
    }
    const config = catalogs[catalog];
    const identity = decodeSharedKnowledgeIdentity(entry, config.endpoint);
    if (!identity.records.length) { return { records: [], issues: identity.issues }; }
    const content = object(entry.content);
    const issues: CatalogIssue[] = [];
    const definition: FieldLineageDefinition = { ...identity.records[0], canonicalName: identity.records[0].nativeName,
        objectType: config.objectType, operation: config.operation, stanza: null, attribute: null, scope: null,
        enabled: state(content?.disabled), inputs: [], outputs: [], aliases: [], transforms: [], syntax: 'declared', sourceLocation: config.endpoint };
    const gap = (message: string, code: CatalogIssue['code'] = 'invalid_definition'): void => {
        definition.syntax = definition.syntax === 'unsupported' ? 'unsupported' : 'partial';
        issues.push({ code, message, sourceLocation: definition.sourceLocation });
    };
    const unsupported = (message: string): void => { definition.syntax = 'unsupported'; gap(message); };
    const text = typeof content?.value === 'string' && content.value.trim() && withinBudget(content.value) ? content.value : null;
    if (catalog === 'field_transforms') {
        definition.sourceLocation = `transforms.conf[${JSON.stringify(definition.nativeName)}]`;
        const source = content?.SOURCE_KEY;
        if (typeof source === 'string' && literalField(source) && !/^(?:MetaData:|field:)/.test(source)) { definition.inputs = [source]; }
        const indexOnly = content?.WRITE_META === true || content?.WRITE_META === 'true' || content?.WRITE_META === 1 || content?.WRITE_META === '1' ||
            typeof content?.DEST_KEY === 'string' && content.DEST_KEY.length > 0 || typeof content?.CLONE_SOURCETYPE === 'string' && content.CLONE_SOURCETYPE.length > 0;
        if (indexOnly) { unsupported('Transform has index-time or routing attributes; search-time field outputs are not inferred.'); }
        else if (typeof content?.FIELDS === 'string' && withinBudget(content.FIELDS)) {
            const names = content.FIELDS.split(',').map(name => name.trim());
            if (!names.length || names.some(name => !/^[A-Za-z_][\w.:-]*$/.test(name))) { unsupported('Transform FIELDS is not a supported literal output list.'); }
            else {
                definition.outputs = names.slice(0, FIELD_DECLARATION_ITEMS);
                if (names.length > FIELD_DECLARATION_ITEMS) { gap('Transform output-field budget reached.', 'limit'); }
            }
        } else if (typeof content?.FORMAT === 'string' && withinBudget(content.FORMAT) &&
            /^(?:[A-Za-z_][\w.:-]*::\$\d+)(?:\s+[A-Za-z_][\w.:-]*::\$\d+)*$/.test(content.FORMAT)) {
            const names = content.FORMAT.split(/\s+/).map(item => item.slice(0, item.lastIndexOf('::')));
            definition.outputs = [...new Set(names)].slice(0, FIELD_DECLARATION_ITEMS);
            if (names.length > FIELD_DECLARATION_ITEMS) { gap('Transform output-field budget reached.', 'limit'); }
        } else { unsupported('PCRE captures, dynamic FORMAT and effective transform outputs remain unverified; no customer regex is evaluated.'); }
        if (definition.enabled === null) { gap('Transform enabled state is unavailable; active applicability is not assumed.', 'unknown_state'); }
        return { records: [definition], issues };
    }
    if (!content || !identifier(content.stanza) || !identifier(content.attribute) || definition.nativeName !== `${content.stanza} : ${content.attribute}`) {
        unsupported('Native props identity, stanza and attribute do not agree; scope and field names are not guessed.');
        return { records: [definition], issues };
    }
    definition.stanza = content.stanza; definition.attribute = content.attribute; definition.scope = declaredFieldScope(content.stanza);
    definition.sourceLocation = `props.conf[${JSON.stringify(content.stanza)}][${JSON.stringify(content.attribute)}]`;
    let expected = /^(EXTRACT|REPORT)-.+$/;
    if (catalog === 'field_aliases') { expected = /^FIELDALIAS-.+$/; }
    else if (catalog === 'calculated_fields') { expected = /^EVAL-.+$/; }
    if (!expected.test(content.attribute) || !text) {
        unsupported('Props declaration is missing, unsupported or exceeds the bounded parse budget.');
        return { records: [definition], issues };
    }
    if (catalog === 'field_extractions') {
        const report = content.attribute.startsWith('REPORT-'); definition.operation = report ? 'report' : 'inline';
        if (content.type !== (report ? 'Uses transform' : 'Inline')) { unsupported('Native extraction type and attribute disagree.'); }
        else if (!report) { unsupported('Inline EXTRACT regex is inventoried but capture/output lineage is not interpreted or executed.'); }
        else if (['$', '*', '?', '{', '}', '[', ']', '"', "'"].some(character => text.includes(character)) || /^\s*,|,\s*$|,\s*,/.test(text)) { unsupported('REPORT target list is dynamic or unsupported; transform identities are not guessed.'); }
        else {
            const names = text.trim().split(/[,\s]+/);
            if (names.some(name => !/^[A-Za-z_][\w.:-]*$/.test(name))) { unsupported('REPORT contains an unsupported transform identity.'); }
            else {
                definition.transforms = names.slice(0, FIELD_DECLARATION_ITEMS);
                if (names.length > FIELD_DECLARATION_ITEMS) { gap('REPORT transform-reference budget reached.', 'limit'); }
            }
        }
    } else if (catalog === 'field_aliases') {
        const parts = tokens(text, false);
        const mappings: FieldAliasMapping[] = [];
        if (content.type !== 'FIELDALIAS' || !parts?.length || parts.length % 3 !== 0) { unsupported('FIELDALIAS syntax or native type is unsupported.'); }
        else {
            for (let index = 0; index < parts.length; index += 3) {
                const [input, mode, output] = parts.slice(index, index + 3);
                const operator = mode.value.toUpperCase();
                if (!literalField(input.value) || !literalField(output.value) || mode.kind !== 'word' || !['AS', 'ASNEW'].includes(operator)) {
                    unsupported('FIELDALIAS must contain literal input AS/ASNEW output assignments.'); break;
                }
                mappings.push({ input: input.value, output: output.value, mode: operator as FieldAliasMapping['mode'] });
            }
            if (definition.syntax !== 'unsupported') {
                definition.aliases = mappings.slice(0, FIELD_DECLARATION_ITEMS);
                definition.inputs = [...new Set(definition.aliases.map(item => item.input))];
                definition.outputs = [...new Set(definition.aliases.map(item => item.output))];
                if (mappings.length > FIELD_DECLARATION_ITEMS) { gap('FIELDALIAS assignment budget reached.', 'limit'); }
                const outputs = new Map<string, Set<string>>();
                mappings.forEach(mapping => { const sources = outputs.get(mapping.output) ?? new Set<string>(); sources.add(mapping.input); outputs.set(mapping.output, sources); });
                if ([...outputs.values()].some(sources => sources.size > 1)) { gap('Multiple original fields declare the same alias output; effective winning assignment remains unverified.'); }
                if (typeof content.overwrite === 'boolean' && mappings.some(mapping => (mapping.mode === 'AS') !== content.overwrite)) { gap('Native overwrite metadata and literal AS/ASNEW declarations disagree.'); }
            }
        }
    } else {
        const output = content.attribute.slice('EVAL-'.length);
        if (content.type !== 'EVAL' || !literalField(output) || content['field.name'] !== output) { unsupported('Calculated-field output identity or native type is inconsistent.'); }
        else {
            definition.outputs = [output];
            const parsed = calculatedFieldInputs(text);
            definition.inputs = parsed.inputs;
            if (!parsed.complete) { unsupported('Calculated-field expression is outside the bounded literal/operator/function subset; complete input lineage is not inferred.'); }
        }
    }
    return { records: [definition], issues };
}
