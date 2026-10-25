const viewNames = {
    overview: 'Overview',
    candidates: 'CleanupCandidates',
    dependencies: 'DependencyExplorer',
    reviews: 'ReviewLibrary',
    ownership: 'Ownership',
    settings: 'Settings',
} as const;

export type AppView = keyof typeof viewNames;

/** Native dashboard navigation can preserve form-style '+' as a literal plus.
 * Keep spaces and real plus signs distinct across redirects and reloads. */
export function serializeQuery(params: URLSearchParams): string {
    return params.toString().replace(/\+/g, '%20');
}

export function readQueryParams(search = window.location.search): URLSearchParams {
    return new URLSearchParams(search.replace(/\+/g, '%20'));
}

export function viewPath(
    view: AppView,
    params: Record<string, string | null | undefined> = {}
): string {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value) {
            search.set(key, value);
        }
    });
    const query = serializeQuery(search);
    return `./${viewNames[view]}${query ? `?${query}` : ''}`;
}

export function navigateToView(view: AppView, params: Record<string, string | null | undefined> = {}): void {
    window.location.assign(viewPath(view, params));
}

export function readQueryParam(name: string): string {
    return readQueryParams().get(name) ?? '';
}
