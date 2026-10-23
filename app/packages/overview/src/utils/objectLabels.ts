import { ContentObject } from '../types';

export function ownerLabel(contentObject: Pick<ContentObject, 'owner' | 'sharing'>): string {
    if (contentObject.owner) { return contentObject.owner; }
    if (contentObject.sharing === 'app' || contentObject.sharing === 'global') {
        return `${contentObject.sharing} scope`;
    }
    return contentObject.sharing === 'user' ? 'Ownership gap' : 'Owner metadata unavailable';
}
