import { createFetchInit } from '@splunk/splunk-utils/fetch';

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
): Promise<T> {
    const attempts = !init.method || init.method === 'GET' ? 2 : 1;
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
                    const body = await response.json();
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
