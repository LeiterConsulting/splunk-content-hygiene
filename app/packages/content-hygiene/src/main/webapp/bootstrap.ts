import './publicPath';
import { AppPage } from '@splunk/overview';
import { renderPage } from './renderPage';

const pages: Record<string, AppPage> = {
    Overview: 'overview',
    CleanupCandidates: 'cleanup-candidates',
    DependencyExplorer: 'dependency-explorer',
    InUseContent: 'in-use-content',
    ReviewLibrary: 'review-library',
    Ownership: 'ownership',
    Settings: 'settings',
};
const view = window.location.pathname.split('/').filter(Boolean).pop() ?? 'Overview';
const mount = (): void => { renderPage(pages[view] ?? 'overview'); };

if (window.requirejs) {
    window.requirejs(['splunkjs/mvc/simplexml/ready!'], mount);
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
    mount();
}
