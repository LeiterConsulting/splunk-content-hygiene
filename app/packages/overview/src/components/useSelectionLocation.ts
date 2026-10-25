import { useEffect } from 'react';
import { readQueryParams, serializeQuery } from '../utils/navigation';

export function useSelectionLocation(objectId: string): void {
    useEffect(() => {
        const params = readQueryParams();
        if (objectId) { params.set('object', objectId); } else { params.delete('object'); }
        const query = serializeQuery(params);
        window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    }, [objectId]);
}
