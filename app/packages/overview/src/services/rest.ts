/* eslint-disable no-restricted-syntax -- UTF-8 accounting stops at a fixed response byte ceiling. */
import { createFetchInit } from '@splunk/splunk-utils/fetch';

async function limitedBody(response: Response, limit: number): Promise<string> {
    const fail = (): Error => new Error('Native metadata response exceeds the bounded byte budget.');
    if (Number(response.headers?.get('content-length')) > limit) { await response.body?.cancel(); throw fail(); }
    if (response.body?.getReader) {
        const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
        try {
            while (true) {
                // eslint-disable-next-line no-await-in-loop
                const chunk = await reader.read();
                if (chunk.done) { break; }
                bytes += chunk.value.byteLength;
                if (bytes > limit) {
                    // eslint-disable-next-line no-await-in-loop -- Release the bounded stream immediately on overflow.
                    await reader.cancel(); throw fail();
                }
                chunks.push(chunk.value);
            }
        } finally { reader.releaseLock(); }
        const data = new Uint8Array(bytes); let offset = 0;
        chunks.forEach(chunk => { data.set(chunk, offset); offset += chunk.byteLength; });
        return new TextDecoder('utf-8', { fatal: true }).decode(data);
    }
    // Non-streaming test/older fetch implementations still fail closed.
    const body = typeof response.text === 'function' ? await response.text() : JSON.stringify(await response.json());
    let bytes = 0;
    for (const character of body) {
        const point = character.codePointAt(0)!;
        if (point <= 0x7f) { bytes += 1; }
        else if (point <= 0x7ff) { bytes += 2; }
        else if (point <= 0xffff) { bytes += 3; }
        else { bytes += 4; }
        if (bytes > limit) { throw fail(); }
    }
    return body;
}

export class SplunkRequestError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'SplunkRequestError';
        this.status = status;
    }
}

/** Retry reads only; an uncertain write response must never be replayed. */
export async function splunkRequest<T>(
    url: string,
    init: RequestInit = {},
    expectedStatuses = [200],
    timeoutMs = 20000,
    maxResponseBytes?: number,
): Promise<T> {
    // Context probes own a strict total read budget: do not hide extra retries.
    const attempts = (!init.method || init.method === 'GET') && maxResponseBytes === undefined ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const controller = new AbortController();
        const abort = (): void => controller.abort();
        if (init.signal?.aborted) {
            controller.abort();
        }
        init.signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, timeoutMs);
        try {
            // eslint-disable-next-line no-await-in-loop
            const response = await fetch(
                url,
                createFetchInit({
                    ...init,
                    signal: controller.signal,
                    headers: { Accept: 'application/json', ...(init.headers ?? {}) },
                }),
            );
            // Bound errors too; an HTTP error body is still untrusted input.
            // eslint-disable-next-line no-await-in-loop -- Each attempt consumes its response once, within its deadline.
            const bounded = maxResponseBytes === undefined ? undefined : await limitedBody(response, maxResponseBytes);
            if (!expectedStatuses.includes(response.status)) {
                if (attempt + 1 < attempts && [429, 502, 503, 504].includes(response.status)) {
                    // eslint-disable-next-line no-await-in-loop
                    await new Promise<void>((resolve) => {
                        setTimeout(resolve, 300);
                    });
                    // eslint-disable-next-line no-continue -- Only a safe read reaches this bounded retry.
                    continue;
                }
                let message = `Splunk request failed with status ${response.status}`;
                try {
                    // eslint-disable-next-line no-await-in-loop
                    const body = bounded === undefined ? await response.json() : JSON.parse(bounded);
                    message =
                        body.messages?.find((item: { text?: string }) => item.text)?.text ??
                        message;
                } catch {
                    /* Retain the HTTP status for a non-JSON error. */
                }
                throw new SplunkRequestError(response.status, message);
            }
            if (response.status === 204) {
                return null as T;
            }
            if (bounded !== undefined) { return bounded ? JSON.parse(bounded) as T : null as T; }
            if (typeof response.text !== 'function') {
                // eslint-disable-next-line no-await-in-loop
                return (await response.json()) as T;
            }
            // eslint-disable-next-line no-await-in-loop
            const body = await response.text();
            return body ? (JSON.parse(body) as T) : (null as T);
        } catch (error) {
            if (controller.signal.aborted) {
                const cancelled = new Error(
                    init.signal?.aborted
                        ? 'Operation cancelled; the previous inventory remains available.'
                        : `Splunk request timed out after ${timeoutMs / 1000} seconds.`,
                );
                cancelled.name = init.signal?.aborted ? 'AbortError' : 'TimeoutError';
                throw cancelled;
            }
            throw error;
        } finally {
            clearTimeout(timer);
            init.signal?.removeEventListener('abort', abort);
        }
    }
    throw new Error('Splunk read retry limit reached.');
}
