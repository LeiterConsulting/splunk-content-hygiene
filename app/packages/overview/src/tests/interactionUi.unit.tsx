// Synthetic React contracts only. Native runtime/theme qualification is separate.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplunkThemeProvider } from '@splunk/themes';
import { DependencyPage } from '../pages/DependencyPage';
import { InUseContentPage } from '../pages/InUseContentPage';
import { ReviewLibraryPage } from '../pages/ReviewLibraryPage';
import { ReviewNavigationProvider } from '../components/ReviewNavigationContext';
import { ScanStatusBanner } from '../components/ScanStatusBanner';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { interactionFixture } from './interactionFixtures';
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

test.each(['light', 'dark'] as const)('Explorer CSV keeps declared navigation targets and provenance distinct from execution in %s', async scheme => {
    const { data, saved, nav, view, report } = await interactionFixture(); const original = JSON.stringify(saved); const user = userEvent.setup();
    window.history.replaceState(null, '', `/?object=${encodeURIComponent(nav.objectId)}`);
    render(frame(<DependencyPage {...actions} reviews={[saved]} snapshot={data} isLoading={false} />, scheme));
    expect(screen.getByText('Configuration is not execution evidence')).toBeVisible();
    expect(screen.getByText(/Interaction links retain exact declared destinations, not clicks or execution/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Export investigation' }));
    await user.click(screen.getByRole('menuitem', { name: 'Filtered relationships CSV' }));
    const [, columns, rows] = jest.mocked(downloadCsv).mock.calls[0];
    const target = columns.indexOf('Related object ID'); const relation = columns.indexOf('Relation');
    expect(rows.find(row => row[target] === view.objectId)?.[relation]).toBe('navigates_to');
    expect(rows.find(row => row[target] === report.objectId)?.[relation]).toBe('links_to_report');
    expect(rows.find(row => row[target] === view.objectId)?.[columns.indexOf('Source location')]).toBe('eai:data.nav.view[1]@name');
    expect(rows.every(row => row[columns.indexOf('Potential implicit relationship')] === false)).toBe(true);
    expect(actions.onSaveReview).not.toHaveBeenCalled(); expect(actions.onDeleteReview).not.toHaveBeenCalled(); expect(JSON.stringify(saved)).toBe(original);
});

test.each(['light', 'dark'] as const)('Explorer JSON retains declared navigation provenance without changing decisions in %s', async scheme => {
    const { data, saved, nav } = await interactionFixture(); const original = JSON.stringify(saved); const user = userEvent.setup();
    window.history.replaceState(null, '', `/?object=${encodeURIComponent(nav.objectId)}`);
    render(frame(<DependencyPage {...actions} reviews={[saved]} snapshot={data} isLoading={false} />, scheme));
    expect(screen.getByText('Configuration is not execution evidence')).toBeVisible();
    expect(screen.getByText(/Interaction links retain exact declared destinations, not clicks or execution/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Export investigation' }));
    await user.click(screen.getByRole('menuitem', { name: 'Filtered relationships JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-dependencies.json', expect.objectContaining({
        centerObject: expect.objectContaining({ objectId: nav.objectId }),
        relationships: expect.arrayContaining([expect.objectContaining({ edge: expect.objectContaining({ relation: 'navigates_to',
            evidence: expect.stringContaining('not observed execution'), sourceLocation: 'eai:data.nav.view[1]@name' }) })]),
    }));
    expect(actions.onSaveReview).not.toHaveBeenCalled(); expect(actions.onDeleteReview).not.toHaveBeenCalled(); expect(JSON.stringify(saved)).toBe(original);
});

test.each(['light', 'dark'] as const)('required-content exports configured destinations without manufacturing observed roots in %s', async scheme => {
    const { data, saved, nav, view, report } = await interactionFixture(); const user = userEvent.setup();
    window.history.replaceState(null, '', `/?object=${encodeURIComponent(nav.objectId)}`);
    render(frame(<InUseContentPage snapshot={data} isLoading={false} reviews={[saved]} reviewsVerified />, scheme));
    await user.click(screen.getByRole('button', { name: view.name }));
    expect(screen.getByText('Supported configuration path or explicit starting object')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Export required-content report' }));
    await user.click(screen.getByRole('menuitem', { name: 'All included objects CSV (partial scope)' }));
    const [, columns, rows] = jest.mocked(downloadCsv).mock.calls[0];
    expect(rows.find(row => row[columns.indexOf('Object ID')] === view.objectId)?.[columns.indexOf('Relation')]).toBe('navigates_to');
    await user.click(screen.getByRole('button', { name: 'Export required-content report' }));
    await user.click(screen.getByRole('menuitem', { name: 'Full footprint and coverage JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-required-content.json', expect.objectContaining({
        rows: expect.arrayContaining([expect.objectContaining({ objectId: report.objectId, usage: null })]),
        gaps: expect.arrayContaining([expect.stringContaining('configured interactions are not observed activity')]),
    }));
    expect(actions.onSaveReview).not.toHaveBeenCalled();
});

test.each(['light', 'dark'] as const)('Library retains the original v4 decision and exposes expanded-policy re-review in %s', async scheme => {
    const { data, saved, nav } = await interactionFixture(); const original = JSON.stringify(saved); const user = userEvent.setup();
    render(frame(<ReviewLibraryPage {...actions} snapshot={data} isLoading={false} loadError={null} reviews={[saved]} />, scheme));
    expect(screen.getByRole('button', { name: 'Needs re-review: 1' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Export filtered reviews' }));
    await user.click(screen.getByRole('menuitem', { name: 'Review library JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-review-library.json', expect.objectContaining({
        reviews: expect.arrayContaining([expect.objectContaining({ stage: 'investigating', note: 'Original rationale',
            assignedTo: 'original-team', reviewEvidenceStatus: expect.objectContaining({ status: 'needs_review' }) })]),
    }));
    await user.click(screen.getByRole('button', { name: nav.name }));
    expect(screen.getByRole('textbox', { name: 'Investigation note' })).toHaveValue('Original rationale');
    expect(screen.getByRole('button', { name: 'Explore dependencies' })).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Evidence & changes' }));
    expect(screen.getByText(/Dependency coverage policy expanded/)).toBeVisible();
    expect(actions.onSaveReview).not.toHaveBeenCalled(); expect(JSON.stringify(saved)).toBe(original);
});

test.each(['light', 'dark'] as const)('scan notices distinguish older snapshots from current interaction collectors in %s', async scheme => {
    const { data } = await interactionFixture();
    const old = { ...data.scan, collectorCounts: { saved_searches: 1 }, collectorVersions: {} };
    const view = render(frame(<ScanStatusBanner scan={old} isLoading={false} loadError={null} />, scheme));
    expect(screen.getByText(/This snapshot predates current workflow\/navigation coverage/)).toBeVisible();
    view.rerender(frame(<ScanStatusBanner scan={data.scan} isLoading={false} loadError={null} />, scheme));
    expect(screen.queryByText(/This snapshot predates current workflow\/navigation coverage/)).not.toBeInTheDocument();
});
