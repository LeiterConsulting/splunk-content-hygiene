export function downloadJson(filename: string, value: unknown): void {
    const json = `${JSON.stringify(value, null, 2)}\n`;
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
