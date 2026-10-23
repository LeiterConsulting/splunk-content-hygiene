import { createStaticURL } from '@splunk/splunk-utils/url';
import { getUserTheme } from '@splunk/splunk-utils/themes';

interface NativeThemeApi { getTheme: () => Promise<string> }
/* eslint-disable no-unused-vars -- Ambient native-loader contract. */
declare global {
    interface Window {
        requirejs?: (modules: string[], ready: (module: unknown) => void, failed?: (error: unknown) => void) => void;
    }
}
/* eslint-enable no-unused-vars */

export function getHostTheme(): Promise<string> {
    if (!window.requirejs) {
        return getUserTheme();
    }
    // The native theme API is UMD: in Simple XML it exports through AMD,
    // not window.__get_theme__. Loading it with scriptjs would silently use
    // the light fallback even when the signed-in user has selected dark.
    return new Promise((resolve, reject) => {
        const finish = (error: unknown, theme?: string): void => {
            clearTimeout(timer);
            if (error) {
                reject(error instanceof Error ? error : new Error('The native Splunk theme could not be loaded.'));
            } else {
                resolve(theme ?? 'light');
            }
        };
        const timer = setTimeout(() => finish(new Error('The native Splunk theme request timed out.')), 15000);
        window.requirejs?.([createStaticURL('build/api/get_theme.js')], (module) => {
            const api = module as NativeThemeApi | null;
            if (typeof api?.getTheme !== 'function') {
                finish(new Error('The native Splunk theme API is unavailable.'));
                return;
            }
            api.getTheme().then((theme) => finish(null, theme), finish);
        }, finish);
    });
}
