import { createRoot } from 'react-dom/client';
import { getUserTheme } from '@splunk/splunk-utils/themes';
import { renderPage } from '../main/webapp/renderPage';

jest.mock('react-dom/client', () => ({ createRoot: jest.fn(() => ({ render: jest.fn() })) }));
jest.mock('@splunk/overview', () => ({ ContentHygieneApp: jest.fn(() => null) }));
jest.mock('@splunk/splunk-utils/themes', () => ({
    getUserTheme: jest.fn(),
    getThemeOptions: (colorScheme: string) => ({ family: 'enterprise', colorScheme }),
}));

let container: HTMLDivElement;
beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement('div');
    container.id = 'content-hygiene-root';
    document.body.appendChild(container);
    jest.mocked(getUserTheme).mockResolvedValue('light');
});
afterEach(() => { document.body.replaceChildren(); });

test.each(['light', 'dark'])('mounts the workspace once using the real user %s theme', async (theme) => {
    jest.mocked(getUserTheme).mockResolvedValue(theme);
    await Promise.all([renderPage('overview'), renderPage('overview')]);
    expect(createRoot).toHaveBeenCalledTimes(1);
    expect(createRoot).toHaveBeenCalledWith(container);
    expect(container.getAttribute('role')).toBe('main');
    const root = jest.mocked(createRoot).mock.results[0].value;
    expect(root.render).toHaveBeenCalledWith(expect.objectContaining({
        props: expect.objectContaining({ colorScheme: theme }),
    }));
});

test('preserves an existing native main landmark instead of nesting another one', async () => {
    const nativeMain = document.createElement('main');
    nativeMain.appendChild(container);
    document.body.appendChild(nativeMain);
    await renderPage('dependency-explorer');
    expect(container.hasAttribute('role')).toBe(false);
    expect(document.querySelectorAll('main, [role="main"]')).toHaveLength(1);
});

test('theme failure is visible text, never executable HTML, and can be retried', async () => {
    jest.mocked(getUserTheme).mockRejectedValueOnce(new Error('<script>unsafe()</script>'));
    await renderPage('overview');
    expect(createRoot).not.toHaveBeenCalled();
    expect(container.getAttribute('role')).toBe('alert');
    expect(container.textContent).toContain('<script>');
    expect(container.querySelector('script')).toBeNull();
    await renderPage('overview');
    expect(createRoot).toHaveBeenCalledTimes(1);
});

test('does not create a second document or native header when the host is missing', async () => {
    container.remove();
    await renderPage('overview');
    expect(getUserTheme).not.toHaveBeenCalled();
    expect(createRoot).not.toHaveBeenCalled();
    expect(document.body.children).toHaveLength(0);
});
