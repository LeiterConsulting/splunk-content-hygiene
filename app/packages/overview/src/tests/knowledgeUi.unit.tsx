// Synthetic React contracts only. Native runtime/theme qualification is separate.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplunkThemeProvider } from '@splunk/themes';
import { DependencyPage } from '../pages/DependencyPage';
import { InUseContentPage } from '../pages/InUseContentPage';
import { ReviewLibraryPage } from '../pages/ReviewLibraryPage';
import { SettingsPage } from '../pages/SettingsPage';
import { ReviewNavigationProvider } from '../components/ReviewNavigationContext';
import { ScanStatusBanner } from '../components/ScanStatusBanner';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { InventoryClient } from '../types';
import { knowledgeFixture } from './knowledgeFixtures';
import { now } from './milestoneFixtures';

jest.mock('../utils/downloadCsv', () => ({ downloadCsv: jest.fn() }));
jest.mock('../utils/downloadJson', () => ({ downloadJson: jest.fn() }));
const actions = { canWriteReviews: true, onSaveReview: jest.fn(), onDeleteReview: jest.fn() };
function frame(children: React.ReactNode, scheme: 'light' | 'dark') {
    return <SplunkThemeProvider family="enterprise" colorScheme={scheme}>
        <ReviewNavigationProvider>{children}</ReviewNavigationProvider>
    </SplunkThemeProvider>;
}
beforeEach(() => {
    window.history.replaceState(null, '', '/'); jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(now);
});
afterEach(() => jest.restoreAllMocks());

test.each(['light', 'dark'] as const)('Explorer and CSV/JSON retain exclusions, exact assignments and potential contexts in %s', async scheme => {
    const { data, saved, tag, root } = await knowledgeFixture(); const bytes = JSON.stringify(saved); const user = userEvent.setup();
    window.history.replaceState(null, '', `/?object=${encodeURIComponent(tag.objectId)}`);
    render(frame(<DependencyPage {...actions} reviews={[saved]} snapshot={data} isLoading={false} />, scheme));
    expect(screen.getByText('Configuration is not execution evidence')).toBeVisible();
    expect(screen.getAllByText('Potential — not observed execution')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Export investigation' }));
    await user.click(screen.getByRole('menuitem', { name: 'Filtered relationships CSV' }));
    const [, columns, rows] = jest.mocked(downloadCsv).mock.calls[0];
    const relation = columns.indexOf('Relation'); const potential = columns.indexOf('Potential implicit relationship');
    const identity = columns.indexOf('Related object ID');
    expect(rows.find(row => row[identity] === root.objectId)?.[relation]).toBe('excludes_tag');
    expect(rows.filter(row => row[relation] === 'may_tag_event_type' && row[potential] === true)).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Export investigation' }));
    await user.click(screen.getByRole('menuitem', { name: 'Filtered relationships JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-dependencies.json', expect.objectContaining({
        centerObject: expect.objectContaining({ objectId: tag.objectId }),
        relationships: expect.arrayContaining([expect.objectContaining({ edge: expect.objectContaining({ relation: 'excludes_tag' }) })]),
    }));
    expect(actions.onSaveReview).not.toHaveBeenCalled(); expect(JSON.stringify(saved)).toBe(bytes);
});

test.each(['light', 'dark'] as const)('required-content CSV/JSON retain potential status beyond event types into explicit macro dependencies in %s', async scheme => {
    const { data, saved, root, macro } = await knowledgeFixture(); const user = userEvent.setup();
    window.history.replaceState(null, '', `/?object=${encodeURIComponent(root.objectId)}`);
    render(frame(<InUseContentPage snapshot={data} isLoading={false} reviews={[saved]} reviewsVerified />, scheme));
    await user.click(screen.getByRole('button', { name: macro.name }));
    expect(screen.getByText('Potential implicit dependency — not observed execution')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Export required-content report' }));
    await user.click(screen.getByRole('menuitem', { name: 'All included objects CSV (partial scope)' }));
    const [, columns, rows] = jest.mocked(downloadCsv).mock.calls[0];
    const row = rows.find(value => value[columns.indexOf('Object ID')] === macro.objectId)!;
    expect(row[columns.indexOf('Witness contains potential implicit dependency')]).toBe(true);
    expect(row[columns.indexOf('Witness path confidence')]).toBe('medium');
    await user.click(screen.getByRole('button', { name: 'Export required-content report' }));
    await user.click(screen.getByRole('menuitem', { name: 'Full footprint and coverage JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-required-content.json', expect.objectContaining({
        rows: expect.arrayContaining([expect.objectContaining({ objectId: macro.objectId, via: expect.objectContaining({ conditional: true }) })]),
    }));
});

test.each(['light', 'dark'] as const)('Library preserves a Retain decision and exports expanded-policy re-review without saving in %s', async scheme => {
    const { data, saved, macro } = await knowledgeFixture(); const bytes = JSON.stringify(saved); const user = userEvent.setup();
    render(frame(<ReviewLibraryPage {...actions} snapshot={data} isLoading={false} loadError={null} reviews={[saved]} />, scheme));
    expect(screen.getByRole('button', { name: 'Needs re-review: 1' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Export filtered reviews' }));
    await user.click(screen.getByRole('menuitem', { name: 'Review library JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-review-library.json', expect.objectContaining({
        reviews: expect.arrayContaining([expect.objectContaining({ stage: 'retain', note: 'Original rationale',
            assignedTo: 'original-team', reviewEvidenceStatus: expect.objectContaining({ status: 'needs_review' }) })]),
    }));
    await user.click(screen.getByRole('button', { name: macro.name }));
    await user.click(screen.getByRole('tab', { name: 'Review decision' }));
    expect(screen.getByRole('textbox', { name: 'Investigation note' })).toHaveValue('Original rationale');
    expect(screen.getByRole('button', { name: 'Explore dependencies' })).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Evidence & changes' }));
    expect(within(screen.getByRole('region', { name: 'Changes since review' })).getByText(/Dependency coverage policy expanded/)).toBeVisible();
    expect(actions.onSaveReview).not.toHaveBeenCalled(); expect(JSON.stringify(saved)).toBe(bytes);
});

test('scan reporting separates native stanza counts from expanded assignment records and exports both units', async () => {
    const { data } = await knowledgeFixture(); const user = userEvent.setup();
    const client: InventoryClient = { isAvailable: () => false, getLatestSnapshot: jest.fn(),
        runBoundedScan: jest.fn(), runFullScan: jest.fn(), runUsageScan: jest.fn() };
    render(frame(<SettingsPage inventoryClient={client} canCollect={false} snapshot={data} snapshotLoadError={null}
        reviews={[]} onScanCompleted={jest.fn()} />, 'light'));
    expect(screen.getByText('Splunk Enterprise 10.2.5 or later; see the compatibility policy for exact tested builds.')).toBeVisible();
    const row = screen.getByText('tag binding stanzas').closest('tr')!;
    expect(within(row).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['tag binding stanzas', '1', '1', '2']);
    await user.click(screen.getByRole('button', { name: 'Export scan report' }));
    await user.click(screen.getByRole('menuitem', { name: 'Scan report JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-scan-report.json', expect.objectContaining({
        scan: expect.objectContaining({ collectorCounts: expect.objectContaining({ tag_bindings: 2 }),
            collectorNativeCounts: expect.objectContaining({ tag_bindings: 1 }) }),
    }));
    expect(client.runFullScan).not.toHaveBeenCalled();
});

test('older snapshots request a new complete scan without starting one during navigation', async () => {
    const { data } = await knowledgeFixture();
    const old = { ...data.scan, collectorCounts: { saved_searches: 1, automatic_lookups: 1 } };
    render(frame(<ScanStatusBanner scan={old} isLoading={false} loadError={null} />, 'dark'));
    expect(screen.getByText(/This snapshot predates event-type\/tag coverage/)).toBeVisible();
});

test('partial analysis is a coverage limitation, not an assertion that only part of the cache was updated', async () => {
    const { data } = await knowledgeFixture();
    const scan = { ...data.scan, status: 'partial' as const, analysisStatus: 'partial' as const };
    render(frame(<ScanStatusBanner scan={scan} isLoading={false} loadError={null} />, 'light'));
    expect(screen.getByText('Live inventory has coverage limitations')).toBeVisible();
    expect(screen.queryByText('Live inventory cache partially updated')).not.toBeInTheDocument();
});
