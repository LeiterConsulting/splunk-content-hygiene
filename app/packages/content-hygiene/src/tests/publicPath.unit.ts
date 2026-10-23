import { createStaticURL } from '@splunk/splunk-utils/url';

jest.mock('@splunk/splunk-utils/url', () => ({
    createStaticURL: jest.fn(() => '/proxy/en-US/static/@build:32/app/content_hygiene/pages/'),
}));

test('uses the native proxy/locale/build-aware app path instead of automatic script inference', () => {
    Object.defineProperty(globalThis, '__webpack_public_path__', { value: '', writable: true, configurable: true });
    jest.isolateModules(() => { jest.requireActual('../main/webapp/publicPath'); });
    expect(createStaticURL).toHaveBeenCalledWith('app/content_hygiene/pages/');
    expect(Reflect.get(globalThis, '__webpack_public_path__')).toBe('/proxy/en-US/static/@build:32/app/content_hygiene/pages/');
    Reflect.deleteProperty(globalThis, '__webpack_public_path__');
});
