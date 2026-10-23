import { useEffect } from 'react';

export function useSelectionLocation(objectId: string): void {
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (objectId) { params.set('object', objectId); } else { params.delete('object'); }
        const query = params.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    }, [objectId]);
}
