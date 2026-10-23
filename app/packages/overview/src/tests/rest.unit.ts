import { splunkRequest } from '../services/rest';

jest.mock('@splunk/splunk-utils/fetch', () => ({ createFetchInit: (init: RequestInit) => init }));
const reply = (status: number): Response =>
    ({ status, text: async () => '{"ok":true}', json: async () => ({}) }) as Response;

test('transient reads retry once, but uncertain writes are never replayed', async () => {
    globalThis.fetch = jest
        .fn()
        .mockResolvedValueOnce(reply(503))
        .mockResolvedValueOnce(reply(200));
    await expect(splunkRequest('/read')).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    globalThis.fetch = jest.fn().mockResolvedValue(reply(503));
    await expect(splunkRequest('/app-local-write', { method: 'POST', body: '{}' })).rejects.toThrow(
        '503',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
});

test('an explicit cancellation propagates to the fetch without a retry', async () => {
    globalThis.fetch = jest.fn(
        (_url, init: RequestInit) =>
            new Promise((_resolve, reject) => {
                init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
            }),
    ) as jest.Mock;
    const controller = new AbortController();
    const pending = splunkRequest('/read', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(1);
});

test('requests have a bounded timeout', async () => {
    globalThis.fetch = jest.fn(
        (_url, init: RequestInit) =>
            new Promise((_resolve, reject) => {
                init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
            }),
    ) as jest.Mock;
    await expect(splunkRequest('/slow-read', {}, [200], 10)).rejects.toMatchObject({
        name: 'TimeoutError',
    });
});
