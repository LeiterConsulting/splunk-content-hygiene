import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Modal from '@splunk/react-ui/Modal';
import { InlineNotice, StyledButton } from '../AppStyles';

interface DraftState { objectId: string; dirty: boolean; busy: boolean; onDiscard?: () => void }
const ReviewNavigationContext = createContext({
    navigate: (action: () => void): void => action(),
    setDraft: (_state: DraftState): void => undefined,
});
export const useReviewNavigation = () => useContext(ReviewNavigationContext);

export function ReviewNavigationProvider({ children }: { children: React.ReactNode }): React.ReactElement {
    const draft = useRef<DraftState>({ objectId: '', dirty: false, busy: false });
    const origin = useRef<HTMLElement | null>(null);
    const [pending, setPending] = useState<(() => void) | null>(null);
    const [busyNotice, setBusyNotice] = useState(false);
    const setDraft = useCallback((state: DraftState) => { draft.current = state; if (!state.busy) { setBusyNotice(false); } }, []);
    const navigate = useCallback((action: () => void) => {
        if (draft.current.busy) { setBusyNotice(true); return; }
        if (!draft.current.dirty) { action(); return; }
        origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setPending(() => action);
    }, []);
    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent): void => {
            if (draft.current.dirty || draft.current.busy) { event.preventDefault(); Object.assign(event, { returnValue: '' }); }
        };
        const followLink = (event: MouseEvent): void => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) { return; }
            const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
            if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.hasAttribute('download')) { return; }
            const destination = new URL(link.href, window.location.href);
            if (destination.pathname === window.location.pathname && destination.search === window.location.search && destination.hash) { return; }
            if (draft.current.dirty || draft.current.busy) {
                event.preventDefault(); event.stopPropagation();
                navigate(() => window.location.assign(link.href));
            }
        };
        window.addEventListener('beforeunload', beforeUnload);
        document.addEventListener('click', followLink, true);
        return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', followLink, true); };
    }, [navigate]);
    const context = useMemo(() => ({ navigate, setDraft }), [navigate, setDraft]);
    return <ReviewNavigationContext.Provider value={context}>
        {busyNotice ? <InlineNotice role="status">Wait for the review save to finish before leaving this object.</InlineNotice> : null}
        {children}
        <Modal open={pending !== null} onRequestClose={() => setPending(null)}
            returnFocus={() => origin.current?.isConnected && origin.current.focus()}
            style={{ width: 520, maxWidth: 'calc(100vw - 32px)' }}>
            <Modal.Header title="Leave unsaved review changes?" />
            <Modal.Body>Your investigation note, stage, or reviewer has unsaved changes. Stay to save them, or discard this draft and continue. The saved decision will not be changed.</Modal.Body>
            <Modal.Footer>
                <StyledButton onClick={() => { const action = pending; draft.current.onDiscard?.(); draft.current = { ...draft.current, dirty: false }; origin.current = null; setPending(null); action?.(); }}>Discard draft and continue</StyledButton>
                <StyledButton $primary onClick={() => setPending(null)}>Keep editing</StyledButton>
            </Modal.Footer>
        </Modal>
    </ReviewNavigationContext.Provider>;
}
