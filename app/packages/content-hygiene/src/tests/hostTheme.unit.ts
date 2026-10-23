import { getUserTheme } from '@splunk/splunk-utils/themes';
import { createStaticURL } from '@splunk/splunk-utils/url';
import { getHostTheme } from '../main/webapp/hostTheme';

jest.mock('@splunk/splunk-utils/themes', () => ({ getUserTheme: jest.fn() }));
jest.mock('@splunk/splunk-utils/url', () => ({ createStaticURL: jest.fn(() => '/proxy/en-US/static/@build/build/api/get_theme.js') }));
afterEach(() => { delete window.requirejs; jest.clearAllMocks(); jest.useRealTimers(); });

test('loads the native AMD API and preserves the user dark preference instead of a light fallback', async () => {
    const api = { getTheme: jest.fn().mockResolvedValue('dark') };
    window.requirejs = jest.fn((_modules, ready) => ready(api));
    await expect(getHostTheme()).resolves.toBe('dark');
    expect(createStaticURL).toHaveBeenCalledWith('build/api/get_theme.js');
    expect(window.requirejs).toHaveBeenCalledWith(['/proxy/en-US/static/@build/build/api/get_theme.js'], expect.any(Function), expect.any(Function));
    expect(getUserTheme).not.toHaveBeenCalled();
});

test('a malformed AMD theme module fails visibly instead of reporting light as a verified preference', async () => {
    window.requirejs = jest.fn((_modules, ready) => ready({}));
    await expect(getHostTheme()).rejects.toThrow('theme API is unavailable');
});

test('native theme rejection is propagated without an unhandled promise', async () => {
    window.requirejs = jest.fn((_modules, ready) => ready({ getTheme: () => Promise.reject(new Error('Denied')) }));
    await expect(getHostTheme()).rejects.toThrow('Denied');
});

test('a non-responsive native loader is bounded', async () => {
    jest.useFakeTimers();
    window.requirejs = jest.fn();
    const pending = expect(getHostTheme()).rejects.toThrow('timed out');
    jest.advanceTimersByTime(15000);
    await pending;
});
