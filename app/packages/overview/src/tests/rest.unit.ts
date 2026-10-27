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

test.each([200, 403, 503])('bounded metadata reads limit even HTTP %s error bodies and never retry', async status => {
    globalThis.fetch = jest.fn().mockResolvedValue({ status, text: async () => '☃'.repeat(4) });
    await expect(splunkRequest('/native-metadata', {}, [200], 1000, 10)).rejects.toThrow('byte budget');
    expect(fetch).toHaveBeenCalledTimes(1);
});
test('streaming metadata stops before parsing an oversized chunk', async () => {
    const cancel = jest.fn(); const releaseLock = jest.fn(); const read = jest.fn().mockResolvedValue({ done: false, value: new Uint8Array(11) });
    globalThis.fetch = jest.fn().mockResolvedValue({ status: 200, body: { getReader: () => ({ read, cancel, releaseLock }) } });
    await expect(splunkRequest('/native-metadata', {}, [200], 1000, 10)).rejects.toThrow('byte budget');
    expect(cancel).toHaveBeenCalledTimes(1); expect(releaseLock).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(1);
});
