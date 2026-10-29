/** Event-driven focus after a persistent evidence tab changes. Never focus a new object accidentally. */
export function focusInvestigation(getTarget: () => HTMLElement | null, objectId: string): void {
    window.requestAnimationFrame(() => {
        const target = getTarget();
        if (!target?.isConnected || target.closest('[hidden]') || target.closest('[data-investigation-object-id]')?.getAttribute('data-investigation-object-id') !== objectId) { return; }
        target.focus({ preventScroll: true });
        target.scrollIntoView?.({ block: 'nearest' });
    });
}
