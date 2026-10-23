import { usageValidity } from '../services/usage';
import { ContentObject } from '../types';

export function downloadJson(filename: string, value: unknown): void {
    const json = `${JSON.stringify(
        value,
        (_key, item) => {
            if (
                item &&
                typeof item === 'object' &&
                'objectId' in item &&
                'objectType' in item &&
                'usageEvidence' in item
            ) {
                return { ...item, usageValidity: usageValidity(item as ContentObject) };
            }
            return item;
        },
        2,
    )}\n`;
    const blob = new Blob([json], {
        type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}
