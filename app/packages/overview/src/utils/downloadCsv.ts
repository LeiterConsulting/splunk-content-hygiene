export type CsvCell = string | number | boolean | null;

function escapeCsv(value: CsvCell): string {
    const normalized = value === null ? '' : String(value);
    return `"${normalized.replace(/"/g, '""')}"`;
}

export function downloadCsv(
    filename: string,
    header: string[],
    rows: CsvCell[][]
): void {
    const csv = [
        header.map(escapeCsv).join(','),
        ...rows.map((row) => row.map(escapeCsv).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}
