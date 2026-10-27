import { ConfidenceLevel, FieldDependencyProvenance, FieldLineageFacts, LookupMappingFacts, PropsEventScope } from '../types';
import { hasUnboundedIndexScope } from './indexScope';

export type ReferenceTarget =
    'macro' | 'lookup' | 'lookup_file' | 'saved_search' | 'data_model' | 'index' | 'sourcetype' | 'automatic_lookup' |
    'event_type' | 'tag_binding' | 'field_extraction' | 'field_alias' | 'calculated_field' | 'field_transform' | 'app' | 'dashboard';
export interface EventSelector {
    field: 'sourcetype' | 'host' | 'source';
    value: string;
    sourceLocation: string;
}
export interface AutomaticLookupRule {
    stanza: string;
    attribute: string;
    transform: string;
    scopeField: EventSelector['field'];
    scopeValue: string;
    exactScope: boolean;
    disabled: boolean;
    fieldInputs?: string[];
    fieldInputsComplete?: boolean;
    fieldMapping?: LookupMappingFacts;
}
export interface ParsedReference {
    targetType: ReferenceTarget;
    targetName: string;
    relation: string;
    confidence: ConfidenceLevel;
    evidence: string;
    sourceLocation: string;
    macroArity?: number;
    /** Invocation namespace for a potential exported automatic-lookup binding. */
    contextApp?: string;
    /** A literal internal route names this exact app, not an exported fallback. */
    exactNamespace?: boolean;
    /** Native built-in/inherited views can be outside the shared catalog. */
    absenceUnverified?: boolean;
    /** A literal tag::<field> qualifier. A tag name alone is not a binding ID. */
    tagField?: string;
    /** Exact shared target selected by a bounded catalog matcher. */
    targetObjectId?: string;
    /** Catalog/context uncertainty must not become a missing-target assertion. */
    resolutionUncertain?: boolean;
    fieldProvenance?: FieldDependencyProvenance;
}
export interface ParsedSource {
    references: ParsedReference[];
    warnings: string[];
    gaps?: ParserCoverageGap[];
    eventSelectors?: EventSelector[];
    hasEventSearch?: boolean;
    /** Separate positive conjunctions, never the union of unrelated query branches. */
    propsEventScopes?: PropsEventScope[];
    automaticLookup?: AutomaticLookupRule;
    fieldLineage?: FieldLineageFacts;
}
export interface ParserCoverageGap {
    targets: ReferenceTarget[] | 'all';
    message: string;
    sourceLocation: string;
    targetName?: string;
    contextApp?: string;
    invocationNamespaceUnverified?: boolean;
}
interface Token {
    value: string;
    offset: number;
    quoted?: boolean;
    macro?: boolean;
    valueQuoted?: boolean;
}
const dynamicName = /\$[^$]+\$|\{[^{}]+\}|\*/;
export const SPL_SOURCE_LIMIT = 1024 * 1024;
export const KNOWLEDGE_REFERENCE_LIMIT = 250;

// Quoted strings, macro bodies, and comments are indivisible. A pipe in a
// literal must never become an executable command boundary.
function tokenize(text: string): { tokens: Token[]; warnings: string[] } {
    const tokens: Token[] = [];
    const warnings: string[] = [];
    let index = 0;
    while (index < text.length) {
        if (/\s/.test(text[index])) {
            index += 1;
        } else if (text.startsWith('```', index)) {
            const end = text.indexOf('```', index + 3);
            if (end < 0) {
                warnings.push('Unterminated SPL comment');
                break;
            }
            index = end + 3;
        } else if ('|[](),'.includes(text[index])) {
            tokens.push({ value: text[index], offset: index });
            index += 1;
        } else if (text[index] === '`') {
            const start = index;
            index += 1;
            const bodyStart = index;
            let quote = '';
            let depth = 0;
            let escaped = false;
            while (index < text.length) {
                const character = text[index];
                if (escaped) {
                    escaped = false;
                } else if (character === '\\') {
                    escaped = true;
                } else if (quote) {
                    if (character === quote) {
                        quote = '';
                    }
                } else if (character === '"' || character === "'") {
                    quote = character;
                } else if (character === '(') {
                    depth += 1;
                } else if (character === ')') {
                    depth = Math.max(0, depth - 1);
                } else if (character === '`' && depth === 0) {
                    break;
                }
                index += 1;
            }
            const end = index < text.length ? index : -1;
            if (end < 0) {
                warnings.push('Unterminated macro invocation');
                break;
            }
            tokens.push({ value: text.slice(bodyStart, end), offset: start, macro: true });
            index = end + 1;
        } else {
            const offset = index;
            const quoted = text[index] === '"' || text[index] === "'";
            let value = '';
            while (index < text.length && !/[\s|[\]`(),]/.test(text[index])) {
                if (text[index] === '"' || text[index] === "'") {
                    const quote = text[index];
                    index += 1;
                    let closed = false;
                    while (index < text.length) {
                        if (text[index] === '\\' && index + 1 < text.length) {
                            value += text[index + 1];
                            index += 2;
                        } else if (text[index] === quote) {
                            index += 1;
                            closed = true;
                            break;
                        } else {
                            value += text[index];
                            index += 1;
                        }
                    }
                    if (!closed) {
                        warnings.push('Unterminated SPL string');
                    }
                } else {
                    value += text[index];
                    index += 1;
                }
            }
            tokens.push({ value, offset, quoted, valueQuoted: /^[^=]*!?=["']/.test(text.slice(offset, index)) });
        }
    }
    return { tokens, warnings };
}

function argumentCount(args: string): number {
    if (!args.trim()) {
        return 0;
    }
    let count = 1;
    let depth = 0;
    let quote = '';
    let escaped = false;
    [...args].forEach((character) => {
        if (escaped) {
            escaped = false;
        } else if (character === '\\') {
            escaped = true;
        } else if (quote) {
            if (character === quote) {
                quote = '';
            }
        } else if (character === '"' || character === "'") {
            quote = character;
        } else if ('([{'.includes(character)) {
            depth += 1;
        } else if (')]}'.includes(character)) {
            depth -= 1;
        } else if (character === ',' && depth === 0) {
            count += 1;
        }
    });
    return count;
}

/** Deliberately narrow initial-search grammar. Existing possible selectors are
 * broader; they must not silently become simultaneous event-domain evidence.
 * No PCRE/SPL evaluation, OR/NOT/IN, macros, subsearches or grouping. */
function propsEventScope(tokens: Token[], sourceLocation: string, malformed: boolean, sourceText: string): PropsEventScope[] {
    if (malformed || sourceLocation.length > 4096) { return []; }
    const end = tokens.findIndex(token => token.value === '|' && !token.quoted);
    const clause = tokens.slice(0, end < 0 ? tokens.length : end);
    if (!clause.length || clause.length > 512 || sourceText.slice(0, end < 0 ? sourceText.length : tokens[end].offset).includes('\\')) { return []; }
    let start = 0;
    if (!clause[0].quoted && clause[0].value.toLowerCase() === 'search') { start = 1; }
    const selectors: PropsEventScope['selectors'] = [];
    const values = new Map<string, string>(); let terms = 0; let and = false;
    for (let index = start; index < clause.length; index += 1) {
        const token = clause[index];
        if (token.macro || token.quoted || /[[\](),]/.test(token.value) && !token.valueQuoted) { return []; }
        if (token.value.toUpperCase() === 'AND') {
            if (!terms || and || index === clause.length - 1) { return []; } and = true;
            // eslint-disable-next-line no-continue -- A validated conjunction token carries no selector.
            continue;
        }
        const assignment = token.value.match(/^([A-Za-z_][\w.:-]*)=(.*)$/);
        let field = assignment?.[1]; let value = assignment?.[2]; let location = token.offset;
        if (!assignment && /^[A-Za-z_][\w.:-]*$/.test(token.value) && clause[index + 1]?.value === '=') {
            field = token.value; value = clause[index + 2]?.value; location = clause[index + 2]?.offset ?? token.offset; index += 2;
        } else if (assignment && !value) { index += 1; value = clause[index]?.value; location = clause[index]?.offset ?? token.offset; }
        if (!field || !value || value.length > 4096 || value.trim() !== value || /[$`{}]/.test(value) ||
            Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
            !assignment?.[2] && !clause[index]?.quoted && /^(AND|OR|NOT|IN|CASE|TERM)$|^[|[\](),]$/i.test(value)) { return []; }
        terms += 1; and = false;
        if (['sourcetype', 'host', 'source'].includes(field)) {
            if (/[*?+()[\]{}|^\\]/.test(value) || value.includes('...')) { return []; }
            if (values.has(field) && values.get(field) !== value) { return []; }
            if (!values.has(field)) { selectors.push({ field: field as EventSelector['field'], value, sourceLocation: `${sourceLocation}:${location}` }); values.set(field, value); }
        }
    }
    return selectors.length ? [{ sourceLocation, selectors }] : [];
}

const commandOptions: Record<string, Set<string>> = {
    lookup: new Set(['local', 'update']),
    inputlookup: new Set(['append', 'strict', 'start', 'max']),
    outputlookup: new Set([
        'append',
        'create_empty',
        'override_if_empty',
        'key_field',
        'output_format',
        'max',
        'allow_updates',
        'createinapp',
    ]),
};

export function parseSpl(sourceText: string, sourceLocation = 'search', assessIndexScope = true, implicitEventSearch = false): ParsedSource {
    if (sourceText.length > SPL_SOURCE_LIMIT) {
        const message = `SPL source exceeds the ${SPL_SOURCE_LIMIT}-character parse budget; dependency coverage is unverified.`;
        return { references: [], warnings: [message], gaps: [{ targets: 'all', message, sourceLocation }] };
    }
    const { tokens, warnings } = tokenize(sourceText);
    const malformedTokens = warnings.some(message => message.startsWith('Unterminated'));
    const gaps: ParserCoverageGap[] = warnings.map((message) => ({ targets: 'all', message, sourceLocation }));
    const warn = (message: string, targets: ReferenceTarget[] | 'all' = 'all'): void => {
        warnings.push(message);
        gaps.push({ message, targets, sourceLocation });
    };
    const references: ParsedReference[] = [];
    const eventSelectors: EventSelector[] = [];
    let hasEventSearch = false;
    const add = (
        token: Token | undefined,
        targetType: ReferenceTarget,
        relation: string,
        extra: Partial<ParsedReference> = {},
    ): void => {
        if (!token || !token.value || (!token.quoted &&
            ('|[](),'.includes(token.value) || ['AND', 'OR', 'NOT'].includes(token.value.toUpperCase())))) {
            warn(`Missing ${targetType} reference at ${sourceLocation}`, ['lookup', 'lookup_file'].includes(targetType) ? ['lookup', 'lookup_file'] : [targetType]);
            return;
        }
        if (dynamicName.test(token.value)) {
            warn(`Dynamic ${targetType} reference at ${sourceLocation}:${token.offset}`, ['lookup', 'lookup_file'].includes(targetType) ? ['lookup', 'lookup_file'] : [targetType]);
            return;
        }
        references.push({
            targetType,
            targetName: token.value,
            relation,
            confidence: 'medium',
            evidence: `SPL ${relation} ${targetType.replace(/_/g, ' ')} ${token.value}`,
            sourceLocation: `${sourceLocation}:${token.offset}`,
            ...extra,
        });
    };
    let expectCommand = true;
    let explicitCommand = false;
    let command = 'search';
    let negations = [false];
    let pendingNot = false;
    let queryStart = true;
    let eventBased = false;
    const consumed = new Set<number>();
    const resourceArguments = new Set<number>();
    let knowledgeReferences = 0;
    const commandStack: Array<{ command: string; negations: boolean[]; queryStart: boolean; eventBased: boolean }> = [];
    const filterCommands = new Set(['search', 'tstats', 'mstats', 'from']);
    const initialCommands = new Set([...filterCommands, 'lookup', 'inputlookup', 'outputlookup', 'savedsearch', 'datamodel']);
    const namedKnowledge = (token: Token, index: number, excluded: boolean): boolean => {
        // Built-in field names are exact. An unrelated EventType/TAG field is
        // not silently treated as the lowercase search-time knowledge field.
        const assignment = token.value.match(/^(eventtype|tag(?:::[A-Za-z_][\w.:-]*)?)(!?=)(.*)$/);
        const field = assignment?.[1] ?? (/^(eventtype|tag(?:::[A-Za-z_][\w.:-]*)?)$/.test(token.value) ? token.value : null);
        if (!field) { return false; }
        const targetType: ReferenceTarget = field === 'eventtype' ? 'event_type' : 'tag_binding';
        const inList = !assignment && tokens[index + 1]?.value.toUpperCase() === 'IN';
        const operator = assignment?.[2] ?? tokens[index + 1]?.value.match(/^(!?=)/)?.[1];
        if (!inList && !operator) { return false; }
        const unavailable = (reason: string): void => warn(`${reason} at ${sourceLocation}:${token.offset}`, [targetType]);
        if (malformedTokens) { unavailable('Malformed SPL prevents literal event-type/tag resolution'); return true; }
        if (command !== 'search' || !eventBased) {
            // A search filter after eval/stats/inputlookup may refer to a
            // manufactured field, not the original event knowledge object.
            if (command === 'search' || ['where', 'tstats', 'mstats'].includes(command)) {
                unavailable('Event-type/tag filter context is not an established original event search');
            }
            return true;
        }
        const values: Token[] = [];
        if (inList) {
            if (tokens[index + 2]?.value !== '(') { unavailable('Unsupported event-type/tag IN list'); return true; }
            let next = index + 3;
            while (next < tokens.length && (tokens[next].quoted || !'|[]()'.includes(tokens[next].value))) {
                if (tokens[next].quoted || tokens[next].value !== ',') { values.push(tokens[next]); }
                next += 1;
            }
            if (tokens[next]?.value !== ')' || !values.length) { unavailable('Empty or unterminated event-type/tag IN list'); return true; }
            for (let item = index + 1; item <= next; item += 1) { consumed.add(item); }
        } else if (assignment?.[3]) {
            values.push({ ...token, value: assignment[3], quoted: token.valueQuoted });
        } else {
            const operatorIndex = assignment ? index : index + 1;
            const joined = assignment ? '' : tokens[operatorIndex]?.value.slice(operator!.length);
            if (joined) { values.push({ ...tokens[operatorIndex], value: joined, quoted: tokens[operatorIndex].valueQuoted }); consumed.add(operatorIndex); }
            else if (tokens[operatorIndex + 1]) {
                const value = tokens[operatorIndex + 1];
                values.push(value);
                if (value.quoted || !'|[](),'.includes(value.value)) { consumed.add(operatorIndex + 1); }
            }
            if (!assignment) { consumed.add(operatorIndex); }
        }
        const negative = excluded !== (operator === '!=');
        values.forEach((value) => {
            if (!value.value || value.value.trim() !== value.value || value.value.length > 4096 ||
                Array.from(value.value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
                /[$*?{}]/.test(value.value) || (!value.quoted &&
                    ('|[](),'.includes(value.value) || /^(AND|OR|NOT|CASE|TERM)$/i.test(value.value)))) {
                unavailable('Dynamic, missing or unsupported literal event-type/tag reference'); return;
            }
            if (knowledgeReferences >= KNOWLEDGE_REFERENCE_LIMIT) {
                const message = `Event-type/tag reference limit (${KNOWLEDGE_REFERENCE_LIMIT}) reached; remaining names are unverified at ${sourceLocation}`;
                if (!warnings.includes(message)) { warn(message, ['event_type', 'tag_binding']); }
                return;
            }
            knowledgeReferences += 1;
            references.push({ targetType, targetName: value.value,
                relation: `${negative ? 'excludes' : 'matches'}_${targetType === 'event_type' ? 'event_type' : 'tag'}`,
                confidence: 'medium', sourceLocation: `${sourceLocation}:${token.offset}`,
                evidence: `SPL ${negative ? 'excludes' : 'matches'} literal ${field}=${value.value}; declared filter semantics, not observed execution`,
                ...(field.startsWith('tag::') ? { tagField: field.slice(5) } : {}),
            });
        });
        if (!values.length) { unavailable('Missing literal event-type/tag reference'); }
        return true;
    };
    const addConstraint = (field: string, token: Token | undefined, rawField = field): void => {
        if (command === 'search' && eventBased && rawField === field && ['sourcetype', 'host', 'source'].includes(field)) {
            if (token?.value && !/[$*?{}]/.test(token.value) && !/^(CASE|TERM)$/i.test(token.value) && !'|[](),'.includes(token.value)) {
                eventSelectors.push({ field: field as EventSelector['field'], value: token.value,
                    sourceLocation: `${sourceLocation}:${token.offset}` });
            } else {
                warn(`Dynamic or unavailable event ${field} selector at ${sourceLocation}`, ['automatic_lookup']);
            }
        }
        if (field === 'host' || field === 'source') { return; }
        add(field === 'datamodel' && token ? { ...token, value: token.value.split('.')[0] } : token,
            field === 'datamodel' ? 'data_model' : field as ReferenceTarget,
            field === 'datamodel' ? 'uses' : 'searches');
    };
    tokens.forEach((token, index) => {
        if (consumed.has(index)) {
            return;
        }
        if (!expectCommand && !token.macro && !resourceArguments.has(index) && /\$[^$]+\$/.test(token.value) &&
            !/^(?:index|sourcetype|datamodel)=/i.test(token.value)) {
            warn(`Runtime token in SPL expression at ${sourceLocation}:${token.offset}`);
        }
        if (token.value === '[' && !token.quoted) {
            commandStack.push({ command, negations, queryStart, eventBased });
            command = 'search';
            negations = [false];
            pendingNot = false;
            expectCommand = true;
            explicitCommand = false;
            queryStart = true;
            eventBased = false;
            return;
        }
        if (token.value === ']' && !token.quoted) {
            const previous = commandStack.pop();
            command = previous?.command ?? 'search';
            negations = previous?.negations ?? [false];
            queryStart = previous?.queryStart ?? false;
            eventBased = previous?.eventBased ?? false;
            pendingNot = false;
            expectCommand = false;
            return;
        }
        if (token.value === '|' && !token.quoted) {
            expectCommand = true;
            explicitCommand = true;
            negations = [false];
            pendingNot = false;
            return;
        }
        if (!token.quoted && token.value === '(') {
            negations.push(negations[negations.length - 1] !== pendingNot);
            pendingNot = false;
            return;
        }
        if (!token.quoted && token.value === ')') {
            if (negations.length > 1) {
                negations.pop();
            }
            pendingNot = false;
            return;
        }
        if (!token.quoted && filterCommands.has(command) && (!expectCommand || !explicitCommand)) {
            if (token.value.toUpperCase() === 'NOT') {
                pendingNot = !pendingNot;
                return;
            }
            if (['AND', 'OR'].includes(token.value.toUpperCase())) {
                pendingNot = false;
                return;
            }
        }
        if (!token.quoted && token.value === ',') {
            return;
        }
        if (token.macro) {
            // An unexpanded macro can generate a search or alter its event fields.
            // Keep explicit references, but do not treat later fields as props scopes.
            hasEventSearch = true;
            eventBased = false;
            queryStart = false;
            pendingNot = false;
            const invocation = token.value.match(/^([\w.:/-]+)(?:\(([\s\S]*)\))?$/);
            if (invocation) {
                add({ ...token, value: invocation[1] }, 'macro', 'uses', {
                    macroArity: invocation[2] === undefined ? 0 : argumentCount(invocation[2]),
                    evidence: `SPL invokes macro \`${invocation[1]}\``,
                });
            } else {
                const reason = dynamicName.test(token.value)
                    ? 'Dynamic macro reference'
                    : 'Unsupported macro invocation';
                warn(`${reason} at ${sourceLocation}:${token.offset}`, ['macro']);
            }
            return;
        }
        if (expectCommand && !token.quoted) {
            if (token.value.includes('$') && !token.value.includes('=')) {
                warn(`Dynamic SPL command or query at ${sourceLocation}:${token.offset}`);
            }
            expectCommand = false;
            const name = token.value.toLowerCase();
            // A leading free-text term is an implicit search, not a command.
            // Only a pipe (or a recognized initial generating command) changes
            // command context; filter parentheses do not become target names.
            command = !token.value.includes('=') && (explicitCommand || !implicitEventSearch && initialCommands.has(name)) ? name : 'search';
            if (queryStart) {
                eventBased = command === 'search';
                queryStart = false;
            } else if (command !== 'search') {
                // A later command may replace sourcetype/host/source or transform
                // the event stream. Only untouched search filters are selectors.
                eventBased = false;
            }
            hasEventSearch ||= eventBased;
            if (['map', 'loadjob', 'script', 'run', 'rest'].includes(command)) {
                warn(`Runtime or external ${command} command is outside static dependency coverage at ${sourceLocation}:${token.offset}`);
            }
            if (
                ['lookup', 'inputlookup', 'outputlookup', 'savedsearch', 'datamodel'].includes(
                    command,
                )
            ) {
                let next = index + 1;
                // Command options precede the table/search name.
                while (tokens[next] && !tokens[next].quoted) {
                    const option = tokens[next].value.match(/^([a-z_]+)=(.*)$/i);
                    if (option && commandOptions[command]?.has(option[1].toLowerCase())) {
                        next += option[2] ? 1 : 2;
                    } else if (
                        commandOptions[command]?.has(tokens[next].value.toLowerCase()) &&
                        tokens[next + 1]?.value === '='
                    ) {
                        next += 3;
                    } else {
                        break;
                    }
                }
                if (command === 'savedsearch') {
                    resourceArguments.add(next);
                    add(tokens[next], 'saved_search', 'invokes');
                } else if (command === 'datamodel') {
                    resourceArguments.add(next);
                    add(tokens[next], 'data_model', 'uses');
                } else {
                    resourceArguments.add(next);
                    add(
                        tokens[next],
                        /\.csv(?:\.gz)?$/i.test(tokens[next]?.value ?? '')
                            ? 'lookup_file'
                            : 'lookup',
                        command === 'outputlookup' ? 'writes' : 'reads',
                    );
                }
            }
        }
        const excluded = negations[negations.length - 1] !== pendingNot;
        pendingNot = false;
        if (token.quoted) {
            return;
        }
        if (namedKnowledge(token, index, excluded)) { return; }
        if (['eval', 'where', 'fieldformat'].includes(command) &&
            /(?:^|=)lookup$/i.test(token.value) && tokens[index + 1]?.value === '(') {
            resourceArguments.add(index + 2);
            add(tokens[index + 2], /\.csv(?:\.gz)?$/i.test(tokens[index + 2]?.value ?? '')
                ? 'lookup_file' : 'lookup', 'reads');
        }
        if (command === 'from' && /^datamodel:/i.test(token.value)) {
            add(
                { ...token, value: token.value.replace(/^datamodel:/i, '').split('.')[0] },
                'data_model',
                'uses',
            );
        }
        if (filterCommands.has(command)) {
            if (/^(index|sourcetype|datamodel|host|source)$/i.test(token.value) && tokens[index + 1]?.value.toUpperCase() === 'IN' && tokens[index + 2]?.value === '(') {
                const type = token.value.toLowerCase();
                let next = index + 3;
                while (next < tokens.length && tokens[next].value !== ')' && !'|[]('.includes(tokens[next].value)) {
                    const member = tokens[next];
                    if (member.value !== ',' && !excluded) {
                        resourceArguments.add(next);
                        addConstraint(type, member, token.value);
                    }
                    next += 1;
                }
                if (tokens[next]?.value !== ')') {
                    let target = type as ReferenceTarget;
                    if (type === 'datamodel') { target = 'data_model'; }
                    else if (['host', 'source'].includes(type)) { target = 'automatic_lookup'; }
                    warn(`Unsupported or unterminated ${type} IN list at ${sourceLocation}:${token.offset}`, [target]);
                } else {
                    for (let item = index + 1; item <= next; item += 1) {consumed.add(item);}
                }
                return;
            }
            // Excluded resources are not positive dependencies. A subsearch
            // has its own context because it still executes under an outer NOT.
            if (excluded) {
                return;
            }
            const constraint = token.value.match(/^(index|sourcetype|datamodel|host|source)=(.*)$/i);
            if (constraint) {
                if (!constraint[2]) { resourceArguments.add(index + 1); }
                const valueToken = constraint[2]
                    ? { ...token, value: constraint[2] }
                    : tokens[index + 1];
                const type = constraint[1].toLowerCase();
                addConstraint(type, valueToken, constraint[1]);
            } else if (
                /^(index|sourcetype|datamodel|host|source)$/i.test(token.value) &&
                tokens[index + 1]?.value === '='
            ) {
                const type = token.value.toLowerCase();
                resourceArguments.add(index + 2);
                addConstraint(type, tokens[index + 2], token.value);
            }
        }
    });
    if (assessIndexScope && hasUnboundedIndexScope(tokens) &&
        !gaps.some((gap) => gap.targets === 'all' || gap.targets.includes('index'))) {
        warn(`Implicit/default index scope is not established for every query branch at ${sourceLocation}`, ['index']);
    }
    return { references, warnings: [...new Set(warnings)], gaps, eventSelectors, hasEventSearch,
        propsEventScopes: propsEventScope(tokens, sourceLocation, malformedTokens, sourceText) };
}

/** Event types are base-search definitions, not arbitrary executable pipelines. */
export function parseEventType(text: string, sourceLocation = 'eventtypes.conf.search'): ParsedSource {
    // Bare command-like words are search terms in an event-type definition,
    // not an implicit savedsearch/inputlookup/datamodel execution instruction.
    const parsed = parseSpl(text, sourceLocation, true, true);
    const tokens = text.length <= SPL_SOURCE_LIMIT ? tokenize(text).tokens : [];
    const invalidPipeline = tokens.some(token => !token.quoted && !token.macro && ['|', '[', ']'].includes(token.value));
    const invalidTag = tokens.some((token, index) => !token.quoted && !token.macro &&
        (/^tag(?:::[A-Za-z_][\w.:-]*)?(!?=)/.test(token.value) ||
            (/^tag(?:::[A-Za-z_][\w.:-]*)?$/.test(token.value) && /^(IN|!?=)/i.test(tokens[index + 1]?.value ?? ''))));
    if (invalidPipeline || invalidTag) {
        const message = 'Event-type definitions cannot contain pipelines, subsearches or tag filters; returned definition is unverified.';
        return { references: [], warnings: [...parsed.warnings, message],
            gaps: [...(parsed.gaps ?? []), { targets: 'all', message, sourceLocation }] };
    }
    return parsed;
}

export function parseDashboard(text: string, sourceLocation = 'dashboard'): ParsedSource {
    const references: ParsedReference[] = [];
    const warnings: string[] = [];
    const gaps: ParserCoverageGap[] = [];
    const eventSelectors: EventSelector[] = [];
    const propsEventScopes: PropsEventScope[] = [];
    let hasEventSearch = false;
    const warn = (message: string, path = sourceLocation, targets: ReferenceTarget[] | 'all' = 'all'): void => {
        warnings.push(message); gaps.push({ message, targets, sourceLocation: path });
    };
    const search = (query: string, path: string, eventSource = true): void => {
        const parsed = parseSpl(query, path);
        references.push(...parsed.references);
        warnings.push(...parsed.warnings);
        gaps.push(...(parsed.gaps ?? []));
        if (eventSource) {
            eventSelectors.push(...(parsed.eventSelectors ?? []));
            if (propsEventScopes.length < 250) { propsEventScopes.push(...(parsed.propsEventScopes ?? []).slice(0, 250 - propsEventScopes.length)); }
            hasEventSearch ||= parsed.hasEventSearch === true;
        }
    };
    const savedSearch = (name: string, path: string): void => {
        if (dynamicName.test(name)) {
            warn(`Dynamic saved-search reference at ${path}`, path, ['saved_search']);
            return;
        }
        references.push({
            targetType: 'saved_search',
            targetName: name.trim(),
            relation: 'references',
            confidence: 'high',
            evidence: `Dashboard explicitly references saved search ${name}`,
            sourceLocation: path,
        });
    };
    if (text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) {
        try {
            const walk = (value: unknown, path: string, depth: number): void => {
                if (depth > 32) {
                    warn(`Dashboard nesting limit at ${path}`, path);
                    return;
                }
                if (!value || typeof value !== 'object') {
                    return;
                }
                if (Array.isArray(value)) {
                    value.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
                    return;
                }
                const record = value as Record<string, unknown>;
                const options = record.options as Record<string, unknown> | undefined;
                if (String(record.type).startsWith('ds.') &&
                    !['ds.search', 'ds.chain', 'ds.savedSearch'].includes(String(record.type))) {
                    warn(`Unsupported Studio data-source type at ${path}`, path);
                }
                if (
                    String(record.type).toLowerCase().includes('savedsearch') &&
                    typeof options?.ref === 'string'
                ) {
                    savedSearch(options.ref, `${path}.options.ref`);
                }
                if (
                    ['ds.search', 'ds.chain'].includes(String(record.type)) &&
                    typeof options?.query === 'string'
                ) {
                    search(options.query, `${path}.options.query`, record.type !== 'ds.chain');
                }
                if (String(record.type) === 'ds.search' && typeof options?.query !== 'string') {
                    warn(`Studio search query is unavailable at ${path}`, path);
                }
                Object.entries(record).forEach(([key, child]) =>
                    walk(child, `${path}.${key}`, depth + 1),
                );
            };
            walk(JSON.parse(text), sourceLocation, 0);
        } catch {
            warn('Dashboard JSON could not be parsed; dependencies are incomplete');
        }
    } else if (typeof DOMParser !== 'undefined') {
        const document = new DOMParser().parseFromString(text, 'text/xml');
        if (document.querySelector('parsererror')) {
            warn('Dashboard XML could not be parsed; dependencies are incomplete');
        } else if (!['dashboard', 'form'].includes(document.documentElement.tagName)) {
            warn('Custom view format is not a supported dashboard parser');
        } else {
            if (document.documentElement.getAttribute('version') === '2') {
                const definition = document.querySelector('definition')?.textContent?.trim() ?? '';
                if (!definition.startsWith('{')) {
                    warn('Dashboard Studio definition is missing or is not JSON');
                } else {
                    const studio = parseDashboard(definition, `${sourceLocation}.definition`);
                    references.push(...studio.references);
                    warnings.push(...studio.warnings);
                    gaps.push(...(studio.gaps ?? []));
                    eventSelectors.push(...(studio.eventSelectors ?? []));
                    if (propsEventScopes.length < 250) { propsEventScopes.push(...(studio.propsEventScopes ?? []).slice(0, 250 - propsEventScopes.length)); }
                    hasEventSearch ||= studio.hasEventSearch === true;
                }
            }
            [...document.querySelectorAll('search[ref]')].forEach((element, index) =>
                savedSearch(
                    element.getAttribute('ref') ?? '',
                    `${sourceLocation}.search[${index}].ref`,
                ),
            );
            [...document.querySelectorAll('savedsearch')].forEach((element, index) =>
                savedSearch(element.textContent ?? '', `${sourceLocation}.savedsearch[${index}]`),
            );
            [...document.querySelectorAll('query')].forEach((element, index) =>
                search(element.textContent ?? '', `${sourceLocation}.query[${index}]`, !element.parentElement?.hasAttribute('base')),
            );
        }
    } else {
        warn('XML parser unavailable; dashboard dependencies are incomplete');
    }
    return { references, warnings: [...new Set(warnings)], gaps, eventSelectors, hasEventSearch, propsEventScopes };
}

/** Parse authoritative model constraints/calculations, not regenerated preview searches. */
export function parseDataModel(text: string, sourceLocation = 'description'): ParsedSource {
    const references: ParsedReference[] = [];
    const warnings: string[] = [];
    const gaps: ParserCoverageGap[] = [];
    let hasEventSearch = false;
    const warn = (message: string, path: string, targets: ReferenceTarget[] | 'all' = 'all'): void => {
        warnings.push(message); gaps.push({ message, targets, sourceLocation: path });
    };
    const search = (query: unknown, path: string): void => {
        if (typeof query !== 'string') { warn(`Data-model search is unavailable at ${path}`, path); return; }
        const parsed = parseSpl(query, path, false);
        references.push(...parsed.references); warnings.push(...parsed.warnings); gaps.push(...(parsed.gaps ?? []));
        hasEventSearch ||= parsed.hasEventSearch === true;
    };
    try {
        const definition = JSON.parse(text);
        if (!definition || !Array.isArray(definition.objects)) {
            throw new Error('Unsupported definition');
        }
        const byName = new Map<string, Record<string, unknown>>(definition.objects
            .filter((item: Record<string, unknown>) => typeof item?.objectName === 'string')
            .map((item: Record<string, unknown>) => [item.objectName, item]));
        const effective = new Map<Record<string, unknown>, string>();
        const queryFor = (object: Record<string, unknown>, seen = new Set<Record<string, unknown>>()): string => {
            if (effective.has(object)) { return effective.get(object)!; }
            if (seen.has(object) || seen.size > 32) { throw new Error('Model inheritance cycle or depth limit'); }
            if (typeof object.objectSearchNoFields === 'string' && object.objectSearchNoFields.trim()) {
                effective.set(object, object.objectSearchNoFields); return object.objectSearchNoFields;
            }
            const own = Array.isArray(object.constraints) ? object.constraints
                .filter((item) => typeof item?.search === 'string').map((item) => `(${item.search})`).join(' AND ') : '';
            const parent = byName.get(String(object.parentName));
            let base = '';
            if (typeof object.baseSearch === 'string' && object.baseSearch.trim()) { base = object.baseSearch; }
            else if (parent) { base = queryFor(parent, new Set([...seen, object])); }
            if (!base && object.parentName && !['BaseEvent', 'BaseSearch'].includes(String(object.parentName))) {
                throw new Error('Unknown model source');
            }
            const query = base ? `${base}${own ? ` | search ${own}` : ''}` : own || '*';
            effective.set(object, query); return query;
        };
        definition.objects.forEach((object: Record<string, unknown>, index: number) => {
            const path = `${sourceLocation}.objects[${index}]`;
            if (!object || typeof object !== 'object') { warn(`Invalid data-model dataset at ${path}`, path); return; }
            try {
                const scoped = parseSpl(queryFor(object), `${path}.effectiveSearch`);
                warnings.push(...scoped.warnings); gaps.push(...(scoped.gaps ?? []));
                hasEventSearch ||= scoped.hasEventSearch === true;
            } catch { warn(`Data-model inherited source scope could not be established at ${path}`, path); }
            if (object.baseSearch !== undefined) { search(object.baseSearch, `${path}.baseSearch`); }
            if (!Array.isArray(object.constraints)) { warn(`Data-model constraints are unavailable at ${path}`, path); }
            else { object.constraints.forEach((item, constraint) => search(item?.search, `${path}.constraints[${constraint}].search`)); }
            if (!Array.isArray(object.calculations)) { warn(`Data-model calculations are unavailable at ${path}`, path); }
            else { object.calculations.forEach((item, calculation) => {
                const location = `${path}.calculations[${calculation}]`;
                if (item?.calculationType === 'Lookup') {
                    const name = item.lookupName;
                    if (typeof name !== 'string' || !name || dynamicName.test(name)) {
                        warn(`Dynamic or missing data-model lookup at ${location}`, location, ['lookup', 'lookup_file']);
                    } else {
                        references.push({ targetType: /\.csv(?:\.gz)?$/i.test(name) ? 'lookup_file' : 'lookup',
                            targetName: name, relation: 'reads', confidence: 'high',
                            evidence: `Data-model calculation explicitly names lookup ${name}`, sourceLocation: `${location}.lookupName` });
                    }
                } else if (item?.calculationType === 'Eval') {
                    search(typeof item.expression === 'string' ? `| eval __hygiene_expression=${item.expression}` : undefined, `${location}.expression`);
                } else if (!['Rex', 'GeoIP'].includes(item?.calculationType)) {
                    warn(`Unsupported data-model calculation at ${location}`, location);
                }
            }); }
        });
    } catch {
        warn('Data-model JSON could not be parsed; dependencies are incomplete', sourceLocation);
    }
    return { references, warnings: [...new Set(warnings)], gaps, hasEventSearch };
}

export const extractSplReferences = (text: string, path?: string): ParsedReference[] =>
    parseSpl(text, path).references;
export const extractDashboardReferences = (text: string, path?: string): ParsedReference[] =>
    parseDashboard(text, path).references;
