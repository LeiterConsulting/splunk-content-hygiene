const viewNames = {
    overview: 'Overview',
    candidates: 'CleanupCandidates',
    dependencies: 'DependencyExplorer',
    reviews: 'ReviewLibrary',
    ownership: 'Ownership',
    settings: 'Settings',
} as const;

export type AppView = keyof typeof viewNames;

export function navigateToView(
    view: AppView,
    params: Record<string, string | null | undefined> = {}
): void {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value) {
            search.set(key, value);
        }
    });
    const query = search.toString();
    window.location.assign(`./${viewNames[view]}${query ? `?${query}` : ''}`);
}

export function readQueryParam(name: string): string {
    return new URLSearchParams(window.location.search).get(name) ?? '';
}
