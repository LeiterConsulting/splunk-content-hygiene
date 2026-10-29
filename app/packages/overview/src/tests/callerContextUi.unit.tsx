// Synthetic UI contracts only; native runtime/theme qualification is separate.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplunkThemeProvider } from '@splunk/themes';
import { CallerContextPanel } from '../components/CallerContextPanel';
import { ReviewNavigationProvider } from '../components/ReviewNavigationContext';
import { DependencyPage } from '../pages/DependencyPage';
import { ReviewLibraryPage } from '../pages/ReviewLibraryPage';
import { emptyCallerContext, mergeCallerContext } from '../services/callerContextDiagnostics';
import { parseSpl } from '../services/dependencyParser';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { object, review, snapshot } from './milestoneFixtures';

jest.mock('../utils/downloadCsv', () => ({ downloadCsv: jest.fn() }));
jest.mock('../utils/downloadJson', () => ({ downloadJson: jest.fn() }));
const frame = (scheme: 'light' | 'dark', child: React.ReactElement) => <SplunkThemeProvider family="enterprise" colorScheme={scheme}><ReviewNavigationProvider>{child}</ReviewNavigationProvider></SplunkThemeProvider>;
const actions = { canWriteReviews: true, onSaveReview: jest.fn(), onDeleteReview: jest.fn() };
beforeEach(() => { window.history.replaceState(null, '', '/'); jest.clearAllMocks(); });
function caller() {
    const item = object('caller', 'Report'); item.callerContext = emptyCallerContext();
    for (let i = 0; i < 8; i += 1) { mergeCallerContext(item.callerContext, parseSpl('`scope` host=$node$ OR sourcetype=x', `dashboard.query[${i}]`).callerContext!); }
    mergeCallerContext(item.callerContext, parseSpl('host=node sourcetype=x', 'dashboard.base').callerContext!);
    mergeCallerContext(item.callerContext, parseSpl('host=node sourcetype=x', 'dashboard.chain').callerContext!, true);
    return item;
}

test.each(['light', 'dark'] as const)('diagnostics filter, paginate, disclose provenance and export all exact rows in %s', async scheme => {
    const user = userEvent.setup(); const item = caller(); const bytes = JSON.stringify(item);
    render(frame(scheme, <CallerContextPanel object={item} />));
    expect(screen.getByText('1–6 of 8 matching recorded query diagnostics')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Next query diagnostics' }));
    expect(screen.getByText('7–8 of 8 matching recorded query diagnostics')).toBeVisible();
    await user.click(screen.getByRole('textbox', { name: 'Find query diagnostic' }));
    await user.paste('query[7]');
    expect(screen.getByText('1–1 of 1 matching recorded query diagnostics')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Inspect query provenance' }));
    expect(screen.getByText(item.callerContext!.rows[7].queryDigest)).toBeVisible();
    expect(screen.getByText(/Initial clause invokes a macro; Initial clause contains a dynamic term; OR branches/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Export caller context JSON' }));
    expect(jest.mocked(downloadJson).mock.calls[0][1]).toMatchObject({ objectId: item.objectId, diagnostics: item.callerContext });
    await user.click(screen.getByRole('button', { name: 'Export caller context CSV' }));
    expect(jest.mocked(downloadCsv).mock.calls[0][2]).toHaveLength(10);
    await user.clear(screen.getByRole('textbox', { name: 'Find query diagnostic' }));
    await user.click(screen.getByRole('combobox', { name: 'Query context outcome' }));
    await user.click(screen.getByRole('option', { name: 'Post-process / chain excluded' }));
    expect(screen.getByText(/Excluded as an independent original-event caller/)).toBeVisible();
    await user.click(screen.getByRole('combobox', { name: 'Query context outcome' }));
    await user.click(screen.getByRole('option', { name: 'Retained static conjunctions' }));
    expect(screen.getByText('Retained static conjunction')).toBeVisible();
    expect(JSON.stringify(item)).toBe(bytes);
});

test.each(['light', 'dark'] as const)('old, unavailable and budgeted evidence stays unknown and exportable in %s', async scheme => {
    const user = userEvent.setup(); const item = object('old-caller', 'Report');
    const { rerender } = render(frame(scheme, <CallerContextPanel object={item} />));
    expect(screen.getByText(/Not recorded in this snapshot/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Export caller context CSV' }));
    expect(jest.mocked(downloadCsv).mock.calls[0][2][0][4]).toBe('not_recorded');
    item.callerContext = emptyCallerContext('unavailable');
    rerender(frame(scheme, <CallerContextPanel object={item} />));
    expect(screen.getByText(/Caller source could not be assessed/)).toBeVisible();
    item.callerContext = { ...emptyCallerContext('budget'), counts: { queries: 12, retained: 0, withheld: 12, postProcess: 0 } };
    rerender(frame(scheme, <CallerContextPanel object={item} />));
    expect(screen.getByText(/0 query detail\(s\) retained of 12 counted occurrences/)).toBeVisible();
    expect(screen.queryByText(/No inline query occurrences were extracted/)).not.toBeInTheDocument();
});

test.each(['light', 'dark'] as const)('Explorer exact caller context tab preserves analytical facts and decisions in %s', async scheme => {
    const item = caller(); const saved = review(item.objectId, { objectType: item.objectType }); const data = snapshot([item]);
    const bytes = JSON.stringify([data, saved]);
    window.history.replaceState(null, '', '/?object=caller&tab=context');
    render(frame(scheme, <DependencyPage {...actions} snapshot={data} isLoading={false} reviews={[saved]} />));
    expect(screen.getByRole('region', { name: 'Caller context diagnostics' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Caller context' })).toHaveAttribute('aria-selected', 'true');
    expect(JSON.stringify([data, saved])).toBe(bytes);
    expect(actions.onSaveReview).not.toHaveBeenCalled(); expect(actions.onDeleteReview).not.toHaveBeenCalled();
});

test.each(['light', 'dark'] as const)('Library investigates current context without saving or changing the baseline in %s', async scheme => {
    const user = userEvent.setup(); const item = caller(); const saved = review(item.objectId, { objectType: item.objectType }); const bytes = JSON.stringify(saved);
    render(frame(scheme, <ReviewLibraryPage {...actions} snapshot={snapshot([item])} isLoading={false} loadError={null} reviews={[saved]} />));
    await user.click(screen.getByRole('button', { name: item.name }));
    await user.click(screen.getByRole('tab', { name: 'Caller context' }));
    const panel = within(screen.getByRole('region', { name: 'Caller context diagnostics' }));
    expect(panel.getByText('1–6 of 8 matching recorded query diagnostics')).toBeVisible();
    await user.click(panel.getByRole('button', { name: 'Export caller context JSON' }));
    expect(jest.mocked(downloadJson).mock.calls[0][1]).toMatchObject({ objectId: item.objectId, diagnostics: item.callerContext });
    expect(JSON.stringify(saved)).toBe(bytes); expect(actions.onSaveReview).not.toHaveBeenCalled(); expect(actions.onDeleteReview).not.toHaveBeenCalled();
});

test('historical review and reusable definitions never substitute for an independent current caller', async () => {
    const user = userEvent.setup(); const saved = review('absent', { objectType: 'Report' });
    const { unmount } = render(frame('dark', <ReviewLibraryPage {...actions} snapshot={snapshot([])} isLoading={false} loadError={null} reviews={[saved]} />));
    await user.click(screen.getByRole('button', { name: 'absent' })); await user.click(screen.getByRole('tab', { name: 'Caller context' }));
    expect(screen.getByText(/not inferred from historical review data/)).toBeVisible(); unmount();
    render(frame('dark', <CallerContextPanel object={object('macro')} />));
    expect(screen.getByText(/not an independent saved-search or dashboard caller/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Export caller context JSON' })).not.toBeInTheDocument();
});
