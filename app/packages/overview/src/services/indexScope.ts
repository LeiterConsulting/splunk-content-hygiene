interface ScopeToken { value: string; quoted?: boolean }
interface Guard { yes: boolean; no: boolean }
const unknown = (): Guard => ({ yes: false, no: false });
const dynamic = /\$[^$]+\$|\{[^{}]+\}|\*/;

/** Abstract boolean interpretation: every successful branch must have a positive
 * static index/model guard. AND needs either guard; OR needs both. NOT swaps the
 * success/failure facts, so exclusions never masquerade as positive selection. */
function guarded(tokens: ScopeToken[]): boolean {
    const values: Guard[] = [];
    const operators: string[] = [];
    const precedence: Record<string, number> = { OR: 1, AND: 2, NOT: 3 };
    let previousValue = false;
    let invalid = false;
    const apply = (): void => {
        const op = operators.pop();
        const right = values.pop();
        if (!right) { invalid = true; values.push(unknown()); return; }
        if (op === 'NOT') { values.push({ yes: right.no, no: right.yes }); return; }
        const left = values.pop();
        if (!left) { invalid = true; values.push(unknown()); return; }
        values.push(op === 'AND' ? { yes: left.yes || right.yes, no: left.no && right.no }
            : { yes: left.yes && right.yes, no: left.no || right.no });
    };
    const binary = (op: string): void => {
        while (operators.length && operators[operators.length - 1] !== '(' &&
            precedence[operators[operators.length - 1]] >= precedence[op]) { apply(); }
        operators.push(op); previousValue = false;
    };
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        const word = token.value.toUpperCase();
        if (!token.quoted && ['AND', 'OR'].includes(word)) { binary(word); }
        else if (!token.quoted && word === 'NOT') {
            if (previousValue) { binary('AND'); }
            operators.push('NOT'); previousValue = false;
        } else if (!token.quoted && token.value === '(') {
            if (previousValue) { binary('AND'); }
            operators.push('('); previousValue = false;
        } else if (!token.quoted && token.value === ')') {
            while (operators.length && operators[operators.length - 1] !== '(') { apply(); }
            if (operators.pop() !== '(') { invalid = true; }
            previousValue = true;
        } else {
            if (previousValue) { binary('AND'); }
            let guard = false;
            if (!token.quoted) {
                const assignment = token.value.match(/^(index|datamodel)=(.*)$/i);
                if (assignment) {
                    let value: string | undefined = assignment[2];
                    if (!value) { index += 1; value = tokens[index]?.value; }
                    guard = Boolean(value && !dynamic.test(value));
                } else if (/^(index|datamodel)$/i.test(token.value)) {
                    if (tokens[index + 1]?.value === '=') {
                        const value = tokens[index + 2]?.value;
                        guard = Boolean(value && !dynamic.test(value)); index += 2;
                    } else if (tokens[index + 1]?.value.toUpperCase() === 'IN' && tokens[index + 2]?.value === '(') {
                        let next = index + 3; let count = 0; let valid = true;
                        while (next < tokens.length && tokens[next].value !== ')') {
                            if (tokens[next].value !== ',') { count += 1; valid = valid && !dynamic.test(tokens[next].value); }
                            next += 1;
                        }
                        guard = valid && count > 0 && tokens[next]?.value === ')'; index = next;
                    }
                }
            }
            values.push(guard ? { yes: true, no: false } : unknown()); previousValue = true;
        }
    }
    while (operators.length) {
        if (operators[operators.length - 1] === '(') { invalid = true; operators.pop(); }
        else { apply(); }
    }
    return !invalid && values.length === 1 && values[0].yes;
}

/** Inspect each query/subsearch's generating segment independently. Stream
 * filters after a pipe cannot establish the input query's index selection. */
export function hasUnboundedIndexScope(tokens: ScopeToken[]): boolean {
    interface Context { prefix: ScopeToken[]; leadingPipe: boolean; finished: boolean }
    const root: Context = { prefix: [], leadingPipe: false, finished: false };
    const contexts = [root]; const stack = [root];
    tokens.forEach((token) => {
        const current = stack[stack.length - 1];
        if (!token.quoted && token.value === '[') {
            if (!current.finished) { current.prefix.push({ value: 'subsearch-results', quoted: true }); }
            const child: Context = { prefix: [], leadingPipe: false, finished: false };
            contexts.push(child); stack.push(child);
        } else if (!token.quoted && token.value === ']') {
            if (stack.length > 1) { stack.pop(); }
        } else if (!token.quoted && token.value === '|') {
            if (!current.prefix.length) { current.leadingPipe = true; } else { current.finished = true; }
        } else if (!current.finished) { current.prefix.push(token); }
    });
    return contexts.some(({ prefix, leadingPipe }) => {
        if (!prefix.length) { return false; }
        const first = prefix[0].value.toLowerCase();
        const direct = ['search', 'tstats', 'mstats'].includes(first);
        const delegated = ['lookup', 'inputlookup', 'outputlookup', 'savedsearch', 'datamodel', 'from'].includes(first);
        if (!direct && (leadingPipe || delegated)) { return false; }
        if (['tstats', 'mstats'].includes(first)) {
            if (prefix.some((token) => !token.quoted && /^datamodel=.+/i.test(token.value) && !dynamic.test(token.value))) { return false; }
            const where = prefix.findIndex((token) => !token.quoted && token.value.toUpperCase() === 'WHERE');
            return where < 0 || !guarded(prefix.slice(where + 1));
        }
        return !guarded(first === 'search' ? prefix.slice(1) : prefix);
    });
}
