import React from 'react';
import layout from '@splunk/react-page/18';
import { ContentHygieneApp, AppPage } from '@splunk/overview';
import { getUserTheme } from '@splunk/splunk-utils/themes';

export function renderPage(page: AppPage): void {
    getUserTheme()
        .then((theme) => {
            layout(<ContentHygieneApp page={page} />, { theme });
        })
        .catch((error: unknown) => {
            const errorElement = document.createElement('p');
            errorElement.setAttribute('role', 'alert');
            errorElement.textContent =
                error instanceof Error
                    ? error.message
                    : 'The Splunk theme could not be loaded.';
            document.body.appendChild(errorElement);
        });
}
