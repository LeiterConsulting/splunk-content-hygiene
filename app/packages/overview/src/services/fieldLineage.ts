/* eslint-disable no-restricted-syntax, no-continue -- Lexing and parsing have explicit byte/token/depth budgets. */
import { CatalogIssue, CatalogResult, decodeSharedKnowledgeIdentity, NativeKnowledgeEntry, SharedKnowledgeIdentity } from './knowledgeCatalog';
import { ExtractionOutputProvenance, FieldAliasMapping, FieldContextEvidence, FieldDependencyProvenance, FieldLineageFacts, FieldOutputDeclaration, FieldScope, LookupMappingFacts, ProducerOutputDeclaration } from '../types';
import { inlineExtractionDeclarations, namedCaptureDeclarations } from './extractionDeclarations';
import { readPropsContexts } from './propsEvidence';
import { readCrossStanzaProps } from './crossStanzaEvidence';
import { readPropsCallerWitnesses } from './propsCallerScopes';
import { compilePropsPattern, propsScopeLabel } from './propsPatterns';

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
    outputProvenance?: ExtractionOutputProvenance;
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
        ...(definition.outputProvenance ? { outputProvenance: definition.outputProvenance } : {}),
        sourceLocation: definition.sourceLocation, limitations: [...new Set([...issues.map(issue => issue.message),
            ...(definition.enabled === null ? ['Native metadata does not establish enabled state; configured applicability is potential.'] : []),
            ...(definition.scope && !definition.scope.exact ? [`Props declaration scope: ${propsScopeLabel(definition.scope)}. Compatible bounded domains can expose potential field producers, not observed event matches.`] : [])])] };
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
    const outputProvenance = row.outputProvenance === undefined ? undefined : readOutputProvenance(row.outputProvenance);
    const lookupMapping = row.lookupMapping === undefined ? undefined : readLookupMapping(row.lookupMapping);
    const propsContexts = row.propsContexts === undefined ? undefined : readPropsContexts(row.propsContexts);
    const crossStanzaProps = row.crossStanzaProps === undefined ? undefined : readCrossStanzaProps(row.crossStanzaProps);
    if (row.crossStanzaProps !== undefined && !crossStanzaProps || row.crossStanzaPropsTruncated !== undefined && typeof row.crossStanzaPropsTruncated !== 'boolean') { return undefined; }
    if (row.propsContexts !== undefined && !propsContexts || row.propsContextsTruncated !== undefined && typeof row.propsContextsTruncated !== 'boolean') { return undefined; }
    if (row.lookupMapping !== undefined && (!lookupMapping || row.operation !== 'lookup' ||
        JSON.stringify(row.inputs) !== JSON.stringify(lookupMapping.inputs.map(item => item.eventField)) ||
        JSON.stringify(row.outputs) !== JSON.stringify(lookupMapping.outputs.map(item => item.eventField)))) { return undefined; }
    if (row.outputProvenance !== undefined && (!outputProvenance ||
        (outputProvenance.method === 'inline_named_captures' ? row.operation !== 'inline' : row.operation !== 'transform') ||
        outputProvenance.declarations.some(item => !row.outputs.includes(item.field)) || row.outputs.some(name => !outputProvenance.declarations.some(item => item.field === name)) ||
        (outputProvenance.sourceField === null ? row.inputs.length !== 0 : row.inputs.length !== 1 || row.inputs[0] !== outputProvenance.sourceField))) { return undefined; }
    return { version: 1, operation: row.operation, stanza: row.stanza, attribute: row.attribute,
        scope: row.scope ? { field: row.scope.field, value: row.scope.value, exact: row.scope.exact } : null,
        enabled: row.enabled, inputs: row.inputs, outputs: row.outputs, aliases: row.aliases.map(mapping => ({ input: mapping.input, output: mapping.output, mode: mapping.mode })),
        transforms: row.transforms, syntax: row.syntax, sourceLocation: row.sourceLocation, limitations: row.limitations,
        ...(outputProvenance ? { outputProvenance } : {}), ...(lookupMapping ? { lookupMapping } : {}),
        ...(propsContexts ? { propsContexts } : {}), ...(row.propsContextsTruncated !== undefined ? { propsContextsTruncated: row.propsContextsTruncated } : {}),
        ...(crossStanzaProps ? { crossStanzaProps } : {}), ...(row.crossStanzaPropsTruncated !== undefined ? { crossStanzaPropsTruncated: row.crossStanzaPropsTruncated } : {}) };
}

export function readLookupMapping(value: unknown): LookupMappingFacts | undefined {
    const row = value as LookupMappingFacts | undefined;
    const mappings = (items: unknown): items is LookupMappingFacts['inputs'] => Array.isArray(items) && items.length <= FIELD_DECLARATION_ITEMS &&
        items.every((item, index) => item && identifier(item.lookupField) && identifier(item.eventField) && item.position === index + 1) &&
        new Set(items.map(item => item.lookupField)).size === items.length && new Set(items.map(item => item.eventField)).size === items.length;
    if (!row || row.version !== 1 || !['OUTPUT', 'OUTPUTNEW', 'implicit'].includes(row.outputMode) ||
        !mappings(row.inputs) || !row.inputs.length || !mappings(row.outputs) || (row.outputMode === 'implicit') !== !row.outputs.length) { return undefined; }
    return { version: 1, outputMode: row.outputMode, inputs: row.inputs.map(item => ({ lookupField: item.lookupField, eventField: item.eventField, position: item.position })),
        outputs: row.outputs.map(item => ({ lookupField: item.lookupField, eventField: item.eventField, position: item.position })) };
}

function readContext(value: unknown): FieldContextEvidence | undefined {
    const row = value as FieldContextEvidence | undefined;
    if (!row || !identifier(row.declaringApp) || !identifier(row.invokingApp) || row.dependencyApp !== null && !identifier(row.dependencyApp) ||
        !['local_candidate', 'exported_candidate'].includes(row.declaration) || !['local_candidate', 'exported_candidate', 'unresolved'].includes(row.dependency) ||
        (row.declaration === 'local_candidate') !== (row.declaringApp === row.invokingApp) ||
        (row.dependency === 'unresolved') !== (row.dependencyApp === null) ||
        row.dependencyApp !== null && (row.dependency === 'local_candidate') !== (row.dependencyApp === row.invokingApp) ||
        row.selector !== null && (!row.selector || !['sourcetype', 'host', 'source'].includes(row.selector.field) ||
            !identifier(row.selector.value) || !identifier(row.selector.sourceLocation))) { return undefined; }
    return { declaringApp: row.declaringApp, dependencyApp: row.dependencyApp, invokingApp: row.invokingApp,
        declaration: row.declaration, dependency: row.dependency, selector: row.selector ? {
            field: row.selector.field, value: row.selector.value, sourceLocation: row.selector.sourceLocation } : null };
}

const OUTPUT_METHODS: ExtractionOutputProvenance['method'][] = ['inline_named_captures', 'transform_named_captures', 'transform_format', 'transform_fields'];
const OUTPUT_ATTRIBUTES = { inline_named_captures: 'value', transform_named_captures: 'REGEX', transform_format: 'FORMAT', transform_fields: 'FIELDS' } as const;
function readOutputDeclaration(value: unknown): FieldOutputDeclaration | undefined {
    const row = value as FieldOutputDeclaration | undefined;
    if (!row || !identifier(row.field) || row.capture !== null && (!Number.isSafeInteger(row.capture) || row.capture < 1 || row.capture > FIELD_DECLARATION_ITEMS) ||
        !Number.isSafeInteger(row.offset) || row.offset < 0 || row.offset >= FIELD_DECLARATION_BYTES || !['value', 'REGEX', 'FORMAT', 'FIELDS'].includes(row.attribute)) { return undefined; }
    return { field: row.field, capture: row.capture, offset: row.offset, attribute: row.attribute };
}
export function readOutputProvenance(value: unknown): ExtractionOutputProvenance | undefined {
    const row = value as ExtractionOutputProvenance | undefined;
    if (!row || row.version !== 1 || !OUTPUT_METHODS.includes(row.method) || row.sourceField !== null && !identifier(row.sourceField) ||
        !['default_raw', 'explicit_inline', 'source_key', 'unknown'].includes(row.sourceOrigin) || row.regexCaptureCount !== null &&
        (!Number.isSafeInteger(row.regexCaptureCount) || row.regexCaptureCount < 0 || row.regexCaptureCount > FIELD_DECLARATION_ITEMS) ||
        !Array.isArray(row.declarations) || !row.declarations.length || row.declarations.length > FIELD_DECLARATION_ITEMS ||
        row.sourceOrigin === 'default_raw' && row.sourceField !== '_raw' || row.sourceOrigin === 'unknown' && row.sourceField !== null ||
        ['explicit_inline', 'source_key'].includes(row.sourceOrigin) && row.sourceField === null ||
        (row.method === 'inline_named_captures' ? !['default_raw', 'explicit_inline'].includes(row.sourceOrigin) : row.sourceOrigin === 'explicit_inline') ||
        row.sourceOrigin === 'explicit_inline' && !/^[A-Za-z0-9_]+$/.test(row.sourceField!) ||
        (row.method === 'transform_fields' ? row.regexCaptureCount !== null : row.regexCaptureCount === null || row.regexCaptureCount < 1)) { return undefined; }
    const declarations = row.declarations.map(readOutputDeclaration);
    if (declarations.some(item => !item || item.attribute !== OUTPUT_ATTRIBUTES[row.method] ||
        (row.method === 'transform_fields' ? item.capture !== null : item.capture === null || item.capture > row.regexCaptureCount!))) { return undefined; }
    return { version: 1, method: row.method, sourceField: row.sourceField, sourceOrigin: row.sourceOrigin,
        regexCaptureCount: row.regexCaptureCount, declarations: declarations as FieldOutputDeclaration[] };
}

export function readFieldProvenance(value: unknown): FieldDependencyProvenance | undefined {
    const row = value as FieldDependencyProvenance | undefined;
    const names = (items: unknown): items is string[] => Array.isArray(items) && items.length <= FIELD_DECLARATION_ITEMS && items.every(identifier);
    const identities = (items: unknown): items is string[] => Array.isArray(items) && items.length <= FIELD_DECLARATION_ITEMS && items.every(item =>
        typeof item === 'string' && item.length > 0 && item.length <= 16384 && Array.from(item).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127));
    const phases = ['extraction', 'alias', 'calculated', 'lookup'];
    if (!row || row.version !== 1 || !['report_binding', 'lookup_binding', 'field_input', 'event_scope'].includes(row.kind) ||
        !names(row.fields) || !identities(row.viaObjectIds) || !names(row.contextApps) ||
        !phases.includes(row.producerPhase) || row.consumerPhase !== null && !phases.includes(row.consumerPhase) ||
        !['fixed_app', 'invoking_app_unverified'].includes(row.invocation) ||
        !Array.isArray(row.transformPositions) || row.transformPositions.length > FIELD_DECLARATION_ITEMS ||
        row.transformPositions.some(position => !Number.isSafeInteger(position) || position < 1 || position > FIELD_DECLARATION_ITEMS) ||
        row.scope !== null && (!row.scope || !['sourcetype', 'host', 'source'].includes(row.scope.field) || !identifier(row.scope.value) || typeof row.scope.exact !== 'boolean')) { return undefined; }
    let outputDeclarations: ProducerOutputDeclaration[] | undefined;
    if (row.contexts !== undefined && (!Array.isArray(row.contexts) || row.contexts.length > FIELD_DECLARATION_ITEMS)) { return undefined; }
    const contexts = row.contexts?.map(readContext);
    if (contexts?.some(item => !item || !row.contextApps.includes(item.invokingApp))) { return undefined; }
    const domain = row.scopeCompatibility;
    if (domain !== undefined && (!domain || domain.version !== 1 || row.kind !== 'field_input' || !row.scope ||
        !domain.consumer || !domain.producer || [domain.consumer, domain.producer].some(scope =>
            !['sourcetype', 'host', 'source'].includes(scope.field) || !identifier(scope.value) || typeof scope.exact !== 'boolean') ||
        domain.consumer.field !== row.scope.field || domain.consumer.value !== row.scope.value || domain.consumer.exact !== row.scope.exact ||
        !['same_literal', 'bounded_intersection', 'captured_default', 'captured_conjunction'].includes(domain.basis))) { return undefined; }
    const callerWitnesses = domain?.callerWitnesses === undefined ? undefined : readPropsCallerWitnesses(domain.callerWitnesses);
    if (domain?.callerWitnesses !== undefined && !callerWitnesses || domain?.basis === 'captured_conjunction' && (!callerWitnesses || row.invocation !== 'fixed_app' ||
        callerWitnesses.some(witness => !row.contextApps.includes(witness.app) || !witness.selectors.some(item => item.field === domain.consumer.field) ||
            !witness.selectors.some(item => item.field === domain.producer.field))) || domain?.basis !== 'captured_conjunction' && callerWitnesses) { return undefined; }
    if (domain) {
        // Validate the compact scan receipt, not the product automaton again on
        // every cached page load. Runtime readers do not reconstruct the graph.
        const left = compilePropsPattern(domain.consumer); const right = compilePropsPattern(domain.producer);
        if (left.kind === 'unsupported' || right.kind === 'unsupported') { return undefined; }
        const fallback = left.kind === 'default' || right.kind === 'default';
        const conjunction = domain.basis === 'captured_conjunction';
        if (fallback !== (domain.basis === 'captured_default') || conjunction && left.field === right.field || !fallback && !conjunction && left.field !== right.field ||
            !fallback && !conjunction && (left.kind === 'literal' && right.kind === 'literal') !== (domain.basis === 'same_literal') ||
            domain.basis === 'same_literal' && (left.field === 'host' ? left.value.toLowerCase() !== right.value.toLowerCase() : left.value !== right.value)) { return undefined; }
    }
    const propsContexts = row.propsContexts === undefined ? undefined : readPropsContexts(row.propsContexts);
    const crossStanzaProps = row.crossStanzaProps === undefined ? undefined : readCrossStanzaProps(row.crossStanzaProps);
    if (row.crossStanzaProps !== undefined && (!crossStanzaProps || crossStanzaProps.some(item => !row.contextApps.includes(item.app))) ||
        row.crossStanzaPropsTruncated !== undefined && typeof row.crossStanzaPropsTruncated !== 'boolean') { return undefined; }
    if (row.propsContexts !== undefined && (!propsContexts || propsContexts.some(item => !row.contextApps.includes(item.app))) ||
        row.propsContextsTruncated !== undefined && typeof row.propsContextsTruncated !== 'boolean') { return undefined; }
    if (row.outputDeclarations !== undefined) {
        if (!Array.isArray(row.outputDeclarations) || row.outputDeclarations.length > FIELD_DECLARATION_ITEMS) { return undefined; }
        outputDeclarations = [];
        for (const item of row.outputDeclarations) {
            const declaration = readOutputDeclaration(item);
            if (!declaration || !identities([item.objectId]) || !OUTPUT_METHODS.includes(item.method) || !row.fields.includes(item.field) ||
                row.kind !== 'field_input' || row.producerPhase !== 'extraction' || declaration.attribute !== OUTPUT_ATTRIBUTES[item.method] ||
                (item.method === 'transform_fields' ? declaration.capture !== null : declaration.capture === null)) { return undefined; }
            outputDeclarations.push({ ...declaration, objectId: item.objectId, method: item.method });
        }
    }
    return { version: 1, kind: row.kind, fields: row.fields, scope: row.scope ? { field: row.scope.field, value: row.scope.value, exact: row.scope.exact } : null,
        consumerPhase: row.consumerPhase, producerPhase: row.producerPhase, transformPositions: row.transformPositions,
        viaObjectIds: row.viaObjectIds, contextApps: row.contextApps, invocation: row.invocation,
        ...(outputDeclarations ? { outputDeclarations } : {}), ...(contexts ? { contexts: contexts as FieldContextEvidence[] } : {}),
        ...(domain ? { scopeCompatibility: { version: 1 as const, consumer: { field: domain.consumer.field, value: domain.consumer.value, exact: domain.consumer.exact },
            producer: { field: domain.producer.field, value: domain.producer.value, exact: domain.producer.exact }, basis: domain.basis,
            ...(callerWitnesses ? { callerWitnesses } : {}) } } : {}),
        ...(propsContexts ? { propsContexts } : {}), ...(row.propsContextsTruncated !== undefined ? { propsContextsTruncated: row.propsContextsTruncated } : {}),
        ...(crossStanzaProps ? { crossStanzaProps } : {}), ...(row.crossStanzaPropsTruncated !== undefined ? { crossStanzaPropsTruncated: row.crossStanzaPropsTruncated } : {}) };
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
const nativeBoolean = (value: unknown): boolean | null => {
    const normalized = typeof value === 'string' ? value.toLowerCase() : value;
    if ([true, 1, '1', 'true'].includes(normalized as string | boolean | number)) { return true; }
    if ([false, 0, '0', 'false'].includes(normalized as string | boolean | number)) { return false; }
    return null;
};
const state = (value: unknown): boolean | null => { const disabled = nativeBoolean(value); return disabled === null ? null : !disabled; };
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
        json_extract: [2, 250], mvappend: [1, 250], mvcount: [1, 1], mvindex: [2, 3],
        mvjoin: [2, 2], mvdedup: [1, 1], split: [2, 2], null: [0, 0], true: [0, 0], false: [0, 0] };
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
        let sourceField: string | null = null; let sourceOrigin: ExtractionOutputProvenance['sourceOrigin'] = 'unknown';
        if (source === undefined || source === '') { sourceField = '_raw'; sourceOrigin = 'default_raw'; }
        else if (typeof source === 'string' && literalField(source) && !/^(?:MetaData:|fields?:)/.test(source)) { sourceField = source; sourceOrigin = 'source_key'; }
        if (sourceField) { definition.inputs = [sourceField]; }
        else { gap('Transform SOURCE_KEY is not a supported literal input; indexed-field and dynamic source semantics remain unverified.'); }
        const present = (value: unknown): boolean => value !== undefined && value !== null && value !== '';
        const writeMeta = present(content?.WRITE_META) ? nativeBoolean(content?.WRITE_META) : false;
        const cleanKeys = present(content?.CLEAN_KEYS) ? nativeBoolean(content?.CLEAN_KEYS) : true;
        const indexOnly = writeMeta === true || ['DEST_KEY', 'CLONE_SOURCETYPE', 'INGEST_EVAL', 'STOP_PROCESSING_IF'].some(key => present(content?.[key]));
        const cleanName = (name: string): boolean => cleanKeys === false || cleanKeys === true && /^[A-Za-z][A-Za-z0-9_]*$/.test(name);
        const pattern = content?.REGEX; const format = content?.FORMAT; const fields = content?.FIELDS; const delims = content?.DELIMS;
        const attributeText = [pattern, format, fields, delims].every(value => !present(value) || typeof value === 'string' && withinBudget(value));
        const retain = (declarations: FieldOutputDeclaration[], method: ExtractionOutputProvenance['method'], count: number | null): void => {
            const bounded = declarations.slice(0, FIELD_DECLARATION_ITEMS);
            definition.outputs = [...new Set(bounded.map(item => item.field))];
            definition.outputProvenance = { version: 1, method, sourceField, sourceOrigin, regexCaptureCount: count, declarations: bounded };
            if (declarations.length > FIELD_DECLARATION_ITEMS) { gap('Transform output-declaration budget reached; additional positions remain unverified.', 'limit'); }
        };
        if (indexOnly) { unsupported('Transform has index-time or routing attributes; search-time field outputs are not inferred.'); }
        else if (writeMeta === null || cleanKeys === null) { unsupported('Transform boolean options are unsupported; search-time output names are not guessed.'); }
        else if (!attributeText) { unsupported('Transform declaration attributes are unsupported or exceed the bounded byte budget.'); }
        else if (typeof fields === 'string' && fields.length) {
            let offset = 0;
            const declarations = fields.split(',').map(value => {
                const item = { field: value.trim(), capture: null, offset: offset + value.length - value.trimStart().length, attribute: 'FIELDS' as const };
                offset += value.length + 1; return item;
            });
            if (declarations.some(item => !identifier(item.field) || !/^[A-Za-z_][\w.:-]*$/.test(item.field))) { unsupported('Transform FIELDS is not a supported bounded literal output list.'); }
            else {
                definition.outputs = [...new Set(declarations.slice(0, FIELD_DECLARATION_ITEMS).map(item => item.field))];
                if (!present(delims) || present(pattern) || present(format) || declarations.some(item => !cleanName(item.field))) {
                    gap('Literal FIELDS names are retained, but missing DELIMS, competing REGEX/FORMAT or key cleaning prevents unambiguous output attribution.');
                } else { retain(declarations, 'transform_fields', null); }
                if (!definition.outputProvenance && declarations.length > FIELD_DECLARATION_ITEMS) { gap('Transform output-field budget reached.', 'limit'); }
            }
        } else if (present(delims)) { unsupported('DELIMS without a supported FIELDS list does not declare literal output names.'); }
        else if (typeof format === 'string' && format.length) {
            const pieces = [...format.matchAll(/\S+/g)].map(item => ({ match: /^([A-Za-z_][\w.:-]*)::\$(\d+)$/.exec(item[0]), offset: item.index! }));
            if (!pieces.length || pieces.some(item => !item.match || !identifier(item.match[1]))) { unsupported('Dynamic, oversized or unsupported FORMAT does not declare unambiguous literal output names.'); }
            else {
                const declarations = pieces.map(item => ({ field: item.match![1], capture: Number(item.match![2]), offset: item.offset, attribute: 'FORMAT' as const }));
                definition.outputs = [...new Set(declarations.slice(0, FIELD_DECLARATION_ITEMS).map(item => item.field))];
                const captures = typeof pattern === 'string' ? namedCaptureDeclarations(pattern, cleanKeys === false) : null;
                if (!captures?.complete || declarations.some(item => !cleanName(item.field) || !Number.isSafeInteger(item.capture) || item.capture < 1 || item.capture > captures.groupCount!)) {
                    gap('Literal FORMAT names are retained, but capture numbering or key cleaning is unverified; these names are not attributed as producer outputs.');
                } else {
                    retain(declarations, 'transform_format', captures.groupCount);
                    if (captures.captures.length) { gap('Named REGEX captures coexist with FORMAT; only explicit FORMAT outputs are attributed, not additional effective fields.'); }
                }
                if (!definition.outputProvenance && declarations.length > FIELD_DECLARATION_ITEMS) { gap('Transform output-field budget reached.', 'limit'); }
            }
        } else if (typeof pattern === 'string' && pattern.length) {
            const captures = namedCaptureDeclarations(pattern, cleanKeys === false);
            if (!captures.complete || !captures.captures.length) { unsupported(captures.reason ?? 'REGEX has no supported literal named-capture outputs.'); }
            else { retain(captures.captures.map(item => ({ field: item.field, capture: item.group, offset: item.offset, attribute: 'REGEX' })), 'transform_named_captures', captures.groupCount); }
        } else { unsupported('No supported search-time output declaration is available; effective transform outputs remain unverified.'); }
        if (present(pattern)) { gap('Capture declarations are read without compiling or executing PCRE. Regex validity, matching, values and effective field availability remain unverified.'); }
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
        else if (!report) {
            const declared = inlineExtractionDeclarations(text);
            definition.inputs = declared.sourceField ? [declared.sourceField] : [];
            if (!declared.complete) { unsupported(declared.reason ?? 'Inline EXTRACT declarations are outside the supported names-only subset.'); }
            else {
                definition.outputs = [...new Set(declared.captures.map(item => item.field))];
                definition.outputProvenance = { version: 1, method: 'inline_named_captures', sourceField: declared.sourceField,
                    sourceOrigin: declared.sourceOrigin, regexCaptureCount: declared.groupCount,
                    declarations: declared.captures.map(item => ({ field: item.field, capture: item.group, offset: item.offset, attribute: 'value' })) };
            }
            gap('Named-capture declarations are read without compiling or executing PCRE. Regex validity, matching, values and effective field availability remain unverified.');
            if (declared.sourceOrigin === 'explicit_inline') { gap('An explicit inline source field is a declared input only; same-phase extraction availability and lexical ordering are not inferred.'); }
        }
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
