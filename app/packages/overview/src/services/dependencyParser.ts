import { ConfidenceLevel } from '../types';

export type ReferenceTarget =
    'macro' | 'lookup' | 'lookup_file' | 'saved_search' | 'data_model' | 'index' | 'sourcetype';
export interface ParsedReference {
    targetType: ReferenceTarget;
    targetName: string;
    relation: string;
    confidence: ConfidenceLevel;
    evidence: string;
    sourceLocation: string;
    macroArity?: number;
}
export interface ParsedSource {
    references: ParsedReference[];
    warnings: string[];
}
interface Token {
    value: string;
    offset: number;
    quoted?: boolean;
    macro?: boolean;
}
const dynamicName = /\$[^$]+\$|\{[^{}]+\}|\*/;

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
            tokens.push({ value, offset, quoted });
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

export function parseSpl(sourceText: string, sourceLocation = 'search'): ParsedSource {
    const { tokens, warnings } = tokenize(sourceText);
    const references: ParsedReference[] = [];
    const add = (
        token: Token | undefined,
        targetType: ReferenceTarget,
        relation: string,
        extra: Partial<ParsedReference> = {},
    ): void => {
        if (!token || !token.value || (!token.quoted && '|[](),'.includes(token.value))) {
            warnings.push(`Missing ${targetType} reference at ${sourceLocation}`);
            return;
        }
        if (dynamicName.test(token.value)) {
            warnings.push(`Dynamic ${targetType} reference at ${sourceLocation}:${token.offset}`);
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
    const consumed = new Set<number>();
    const commandStack: Array<{ command: string; negations: boolean[] }> = [];
    const filterCommands = new Set(['search', 'tstats', 'mstats', 'from']);
    const initialCommands = new Set([...filterCommands, 'lookup', 'inputlookup', 'outputlookup', 'savedsearch', 'datamodel']);
    tokens.forEach((token, index) => {
        if (consumed.has(index)) {
            return;
        }
        if (token.value === '[' && !token.quoted) {
            commandStack.push({ command, negations });
            command = 'search';
            negations = [false];
            pendingNot = false;
            expectCommand = true;
            explicitCommand = false;
            return;
        }
        if (token.value === ']' && !token.quoted) {
            const previous = commandStack.pop();
            command = previous?.command ?? 'search';
            negations = previous?.negations ?? [false];
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
                warnings.push(`${reason} at ${sourceLocation}:${token.offset}`);
            }
            return;
        }
        if (expectCommand && !token.quoted) {
            if (token.value.includes('$') && !token.value.includes('=')) {
                warnings.push(`Dynamic SPL command or query at ${sourceLocation}:${token.offset}`);
            }
            expectCommand = false;
            const name = token.value.toLowerCase();
            // A leading free-text term is an implicit search, not a command.
            // Only a pipe (or a recognized initial generating command) changes
            // command context; filter parentheses do not become target names.
            command = !token.value.includes('=') && (explicitCommand || initialCommands.has(name)) ? name : 'search';
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
                    add(tokens[next], 'saved_search', 'invokes');
                } else if (command === 'datamodel') {
                    add(tokens[next], 'data_model', 'uses');
                } else {
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
        if (command === 'from' && /^datamodel:/i.test(token.value)) {
            add(
                { ...token, value: token.value.replace(/^datamodel:/i, '').split('.')[0] },
                'data_model',
                'uses',
            );
        }
        if (filterCommands.has(command)) {
            if (/^(index|sourcetype|datamodel)$/i.test(token.value) && tokens[index + 1]?.value.toUpperCase() === 'IN' && tokens[index + 2]?.value === '(') {
                const type = token.value.toLowerCase();
                let next = index + 3;
                while (next < tokens.length && tokens[next].value !== ')' && !'|[]('.includes(tokens[next].value)) {
                    const member = tokens[next];
                    if (member.value !== ',' && !excluded) {
                        add(type === 'datamodel' ? { ...member, value: member.value.split('.')[0] } : member, type === 'datamodel' ? 'data_model' : (type as ReferenceTarget), type === 'datamodel' ? 'uses' : 'searches');
                    }
                    next += 1;
                }
                if (tokens[next]?.value !== ')') {
                    warnings.push(`Unsupported or unterminated ${type} IN list at ${sourceLocation}:${token.offset}`);
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
            const constraint = token.value.match(/^(index|sourcetype|datamodel)=(.*)$/i);
            if (constraint) {
                const valueToken = constraint[2]
                    ? { ...token, value: constraint[2] }
                    : tokens[index + 1];
                const type = constraint[1].toLowerCase();
                add(
                    type === 'datamodel' && valueToken
                        ? { ...valueToken, value: valueToken.value.split('.')[0] }
                        : valueToken,
                    type === 'datamodel' ? 'data_model' : (type as ReferenceTarget),
                    type === 'datamodel' ? 'uses' : 'searches',
                );
            } else if (
                /^(index|sourcetype|datamodel)$/i.test(token.value) &&
                tokens[index + 1]?.value === '='
            ) {
                const type = token.value.toLowerCase();
                add(
                    tokens[index + 2],
                    type === 'datamodel' ? 'data_model' : (type as ReferenceTarget),
                    type === 'datamodel' ? 'uses' : 'searches',
                );
            }
        }
    });
    return { references, warnings: [...new Set(warnings)] };
}

export function parseDashboard(text: string, sourceLocation = 'dashboard'): ParsedSource {
    const references: ParsedReference[] = [];
    const warnings: string[] = [];
    const search = (query: string, path: string): void => {
        const parsed = parseSpl(query, path);
        references.push(...parsed.references);
        warnings.push(...parsed.warnings);
    };
    const savedSearch = (name: string, path: string): void => {
        if (dynamicName.test(name)) {
            warnings.push(`Dynamic saved-search reference at ${path}`);
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
                    warnings.push(`Dashboard nesting limit at ${path}`);
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
                    search(options.query, `${path}.options.query`);
                }
                Object.entries(record).forEach(([key, child]) =>
                    walk(child, `${path}.${key}`, depth + 1),
                );
            };
            walk(JSON.parse(text), sourceLocation, 0);
        } catch {
            warnings.push('Dashboard JSON could not be parsed; dependencies are incomplete');
        }
    } else if (typeof DOMParser !== 'undefined') {
        const document = new DOMParser().parseFromString(text, 'text/xml');
        if (document.querySelector('parsererror')) {
            warnings.push('Dashboard XML could not be parsed; dependencies are incomplete');
        } else if (!['dashboard', 'form'].includes(document.documentElement.tagName)) {
            warnings.push('Custom view format is not a supported dashboard parser');
        } else {
            if (document.documentElement.getAttribute('version') === '2') {
                const definition = document.querySelector('definition')?.textContent?.trim() ?? '';
                if (!definition.startsWith('{')) {
                    warnings.push('Dashboard Studio definition is missing or is not JSON');
                } else {
                    const studio = parseDashboard(definition, `${sourceLocation}.definition`);
                    references.push(...studio.references);
                    warnings.push(...studio.warnings);
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
                search(element.textContent ?? '', `${sourceLocation}.query[${index}]`),
            );
        }
    } else {
        warnings.push('XML parser unavailable; dashboard dependencies are incomplete');
    }
    return { references, warnings: [...new Set(warnings)] };
}

export const extractSplReferences = (text: string, path?: string): ParsedReference[] =>
    parseSpl(text, path).references;
export const extractDashboardReferences = (text: string, path?: string): ParsedReference[] =>
    parseDashboard(text, path).references;
