import React from 'react';
import { createRoot } from 'react-dom/client';
import { LayerStackGlobalProvider } from '@splunk/react-ui/Layer';
import { SplunkThemeProvider } from '@splunk/themes';
import { ContentHygieneApp, AppPage } from '@splunk/overview';
import { getThemeOptions } from '@splunk/splunk-utils/themes';
import { getHostTheme } from './hostTheme';

const mounted = new WeakSet<HTMLElement>();

// The standard Simple XML host owns authentication, locale and native chrome.
// Mount only our workspace; do not recreate a legacy header on modern Splunk.
export async function renderPage(page: AppPage): Promise<void> {
    const container = document.getElementById('content-hygiene-root');
    if (!container || mounted.has(container)) {
        return;
    }
    mounted.add(container);
    try {
        const theme = await getHostTheme();
        if (!container.closest('main, [role="main"]')) {
            container.setAttribute('role', 'main');
            container.setAttribute('aria-label', 'Content Hygiene workspace');
        }
        createRoot(container).render(
            <SplunkThemeProvider {...getThemeOptions(theme)}>
                <LayerStackGlobalProvider>
                    <ContentHygieneApp page={page} />
                </LayerStackGlobalProvider>
            </SplunkThemeProvider>,
        );
    } catch (error: unknown) {
        mounted.delete(container);
        container.setAttribute('role', 'alert');
        container.textContent = error instanceof Error ? error.message : 'The Splunk theme could not be loaded.';
    }
}
