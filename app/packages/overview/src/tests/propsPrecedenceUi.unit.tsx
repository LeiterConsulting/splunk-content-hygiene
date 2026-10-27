import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getTheme, SplunkThemeProvider } from '@splunk/themes';
import { PropsContextPanel } from '../components/PropsContextPanel';
import { FieldLineagePanel, FieldProvenanceDetails } from '../components/FieldLineagePanel';
import { InventoryClient, PropsContextEvidence } from '../types';
import { fieldInvestigationFixture } from './fieldFixtures';
import { readFieldLineageFacts, readFieldProvenance } from '../services/fieldLineage';
import { SettingsPage } from '../pages/SettingsPage';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';

jest.mock('../utils/downloadCsv', () => ({ downloadCsv: jest.fn() }));
jest.mock('../utils/downloadJson', () => ({ downloadJson: jest.fn() }));
beforeEach(() => jest.clearAllMocks());

const rows: PropsContextEvidence[] = Array.from({ length: 17 }, (_, index) => {
    const row: PropsContextEvidence = { version: 1, objectId: `object-${index}`, app: `context-${index}`, status: 'inherited',
        selectedObjectId: `object-${index}`, valueDigest: 'a'.repeat(64), reason: 'matched' };
    if (index === 1) { return { ...row, status: 'shadowed', selectedObjectId: 'returned-override', reason: 'different_binding' }; }
    if (index === 2) { return { ...row, status: 'unverified', selectedObjectId: null, valueDigest: null, reason: 'budget' }; }
    return row;
});
const frame = (scheme: 'light' | 'dark', child: React.ReactElement) => <SplunkThemeProvider family="enterprise" colorScheme={scheme}>{child}</SplunkThemeProvider>;

test.each(['light', 'dark'] as const)('cache-only context disclosure has wrapping-safe accessible filters, pagination and fallback drill-down in %s', async scheme => {
    const user = userEvent.setup(); render(frame(scheme, <PropsContextPanel rows={rows} truncated />));
    await user.click(screen.getByRole('button', { name: 'Inspect shared props contexts (17)' }));
    expect(screen.getByText(/does not establish per-file local\/default origin/)).toBeVisible();
    const list = screen.getByRole('list', { name: 'Shared props context observations' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(8);
    expect(screen.getByRole('link', { name: 'returned-override' })).toHaveAttribute('href', expect.stringContaining('object=returned-override'));
    const returned = screen.getByRole('link', { name: 'returned-override' }); const expected = document.createElement('span');
    expected.style.color = getTheme({ family: 'enterprise', colorScheme: scheme }).contentColorLink;
    expect(returned).toHaveAttribute('data-test', 'link'); expect(getComputedStyle(returned).color).toBe(expected.style.color);
    expect(getComputedStyle(returned).textDecoration).toContain('underline');
    expect(screen.getByText(/possible fallback, not the currently returned binding/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Next contexts' }));
    expect(screen.getByText('9–16 of 17 matching contexts')).toBeVisible();
    await user.type(screen.getByRole('textbox', { name: 'Find props context' }), 'context-16');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Next contexts' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous contexts' })).toBeDisabled();
    await user.clear(screen.getByRole('textbox', { name: 'Find props context' }));
    await user.click(screen.getByRole('combobox', { name: 'Props binding status' }));
    await user.click(screen.getByRole('option', { name: 'Unverified' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText(/bounded context-check budget was reached/)).toBeVisible();
});
test.each(['light', 'dark'] as const)('object and relationship details preserve the same native observation and legacy unknown state in %s', async scheme => {
    const { alias, data } = await fieldInvestigationFixture(); const own = { ...rows[0], app: alias.app, objectId: alias.objectId, selectedObjectId: alias.objectId };
    const facts = { ...alias.fieldLineage!, propsContexts: [own] }; const proof = { ...data.edges.find(row => row.sourceId === alias.objectId)!.fieldProvenance!,
        propsContexts: [own], contextApps: [own.app] };
    expect(readFieldLineageFacts(facts)?.propsContexts).toEqual([own]);
    expect(readFieldProvenance(proof)?.propsContexts).toEqual([own]);
    const { rerender } = render(frame(scheme, <FieldLineagePanel object={{ ...alias, fieldLineage: facts }} />));
    expect(screen.getByRole('region', { name: 'Shared props precedence' })).toBeVisible();
    expect(screen.getByText(/1 inherited merged match/)).toBeVisible();
    rerender(frame(scheme, <FieldProvenanceDetails provenance={proof} />));
    expect(screen.getByText(/1 inherited merged match/)).toBeVisible();
    rerender(frame(scheme, <FieldLineagePanel object={alias} />));
    expect(within(screen.getByRole('region', { name: 'Shared props precedence' })).getByText(/Not recorded by this snapshot. Run a new complete scan; saved decisions are unchanged/)).toBeVisible();
    expect(readFieldProvenance({ ...proof, contextApps: ['different'] })).toBeUndefined();
});
test.each(['light', 'dark'] as const)('scan diagnostics and actual export actions retain bounded read and uncertainty counters in %s', async scheme => {
    const { data } = await fieldInvestigationFixture(); const user = userEvent.setup();
    const counts = { props_context_checks: 100, props_context_reads: 42, props_context_local: 7, props_context_inherited: 8,
        props_context_shadowed: 1, props_context_unverified: 84, props_context_truncated_edges: 2, props_context_truncated_objects: 3 };
    data.scan = { ...data.scan, collectorVersions: { props_precedence: '1.0.0' }, parserCounts: counts };
    const client: InventoryClient = { isAvailable: () => false, getLatestSnapshot: jest.fn(), runBoundedScan: jest.fn(), runFullScan: jest.fn(), runUsageScan: jest.fn() };
    render(frame(scheme, <SettingsPage inventoryClient={client} snapshot={data} snapshotLoadError={null} reviews={[]} canCollect={false} onScanCompleted={jest.fn()} />));
    await user.click(screen.getByRole('button', { name: 'Shared props context diagnostics' }));
    expect(screen.getByText('1 / 84')).toBeVisible(); expect(screen.getByText('2 / 3')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Export scan report' }));
    await user.click(screen.getByRole('menuitem', { name: 'Scan report CSV' }));
    const [, columns, values] = jest.mocked(downloadCsv).mock.calls[0];
    expect(JSON.parse(String(values[0][columns.indexOf('Analysis counters')]))).toEqual(counts);
    await user.click(screen.getByRole('button', { name: 'Export scan report' }));
    await user.click(screen.getByRole('menuitem', { name: 'Scan report JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-scan-report.json', expect.objectContaining({ scan: expect.objectContaining({ parserCounts: counts }) }));
    expect(client.runFullScan).not.toHaveBeenCalled();
});
