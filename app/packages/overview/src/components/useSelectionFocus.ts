import { useEffect, useRef } from 'react';

/** Move keyboard focus with the list/detail transition; leave initial list focus alone. */
export function useSelectionFocus(selectedId?: string, scrollListContainer = false) {
    const detailTitle = useRef<HTMLHeadingElement | null>(null);
    const listTitle = useRef<HTMLHeadingElement | null>(null);
    const previous = useRef('');
    useEffect(() => {
        if (selectedId || previous.current) {
            const target = selectedId ? detailTitle.current : listTitle.current;
            target?.focus({ preventScroll: true });
            // Keep Back/Previous/Next visible above the selected object title.
            const top = selectedId || scrollListContainer ? target?.closest('[data-investigation-workspace]') ?? target : target;
            top?.scrollIntoView?.({ block: 'start' });
        }
        previous.current = selectedId ?? '';
    }, [selectedId, scrollListContainer]);
    return { detailTitle, listTitle };
}
