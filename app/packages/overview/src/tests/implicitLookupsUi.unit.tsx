// Synthetic UI contracts only. Runtime validation uses native read-only catalogs.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplunkThemeProvider } from '@splunk/themes';
import { DependencyPage } from '../pages/DependencyPage';
import { InUseContentPage } from '../pages/InUseContentPage';
import { ReviewNavigationProvider } from '../components/ReviewNavigationContext';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { edge, now, object, review, snapshot } from './milestoneFixtures';

jest.mock('../utils/downloadCsv', () => ({ downloadCsv: jest.fn() }));
jest.mock('../utils/downloadJson', () => ({ downloadJson: jest.fn() }));
const caller = object('Caller', 'Saved Search');
const automatic = object('events : LOOKUP-enrich', 'Automatic Lookup');
const definition = object('owners', 'Lookup Definition');
const file = object('owners.csv', 'Lookup File');
const potential = { ...edge(caller.objectId, automatic.objectId, 'may_apply_automatic_lookup'), confidence: 'medium' as const };
const data = snapshot([caller, automatic, definition, file], [potential,
    edge(automatic.objectId, definition.objectId, 'uses_lookup'), edge(definition.objectId, file.objectId, 'uses_file')]);
data.scan.collectorCounts.automatic_lookups = 1;
const saved = review(caller.objectId);
const actions = { reviews: [saved], canWriteReviews: true, onSaveReview: jest.fn(), onDeleteReview: jest.fn() };
function frame(children: React.ReactNode, scheme: 'light' | 'dark') {
    return <SplunkThemeProvider family="enterprise" colorScheme={scheme}>
        <ReviewNavigationProvider>{children}</ReviewNavigationProvider>
    </SplunkThemeProvider>;
}
beforeEach(() => {
    window.history.replaceState(null, '', '/');
    jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(now);
});
afterEach(() => jest.restoreAllMocks());

test.each(['light', 'dark'] as const)('Explorer labels potential callers and exports their semantics without saving decisions in %s', async (scheme) => {
    const user = userEvent.setup(); const bytes = JSON.stringify(saved);
    window.history.replaceState(null, '', `/?object=${encodeURIComponent(automatic.objectId)}`);
    render(frame(<DependencyPage {...actions} snapshot={data} isLoading={false} />, scheme));
    expect(screen.getByText('Configuration is not execution evidence')).toBeVisible();
    expect(screen.getByText('Potential — not observed execution')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Export investigation' }));
    await user.click(screen.getByRole('menuitem', { name: 'Filtered relationships CSV' }));
    const [, columns, rows] = jest.mocked(downloadCsv).mock.calls[0];
    const column = columns.indexOf('Potential implicit relationship');
    expect(column).toBeGreaterThan(-1);
    expect(rows.some((row) => row[column] === true)).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Assess removal impact' }));
    expect(screen.getByText('Potential implicit path')).toBeVisible();
    expect(screen.getByText(/potential implicit matches; verify them before assuming consumption/)).toBeVisible();
    expect(screen.queryByText(/Only explicit relationships supported/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Export investigation' }));
    await user.click(screen.getByRole('menuitem', { name: 'Full removal impact JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-impact.json', expect.objectContaining({
        analysis: expect.objectContaining({ affectedObjects: expect.arrayContaining([expect.objectContaining({ objectId: caller.objectId, conditional: true })]) }),
    }));
    expect(actions.onSaveReview).not.toHaveBeenCalled();
    expect(JSON.stringify(saved)).toBe(bytes);
});

test.each(['light', 'dark'] as const)('required-content report retains potential status through the lookup file, its detail and exports in %s', async (scheme) => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', `/?object=${encodeURIComponent(caller.objectId)}`);
    render(frame(<InUseContentPage snapshot={data} isLoading={false} reviews={[saved]} reviewsVerified />, scheme));
    expect(screen.getByRole('heading', { name: '4 included identities' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: file.name }));
    expect(screen.getByText('Potential implicit dependency — not observed execution')).toBeVisible();
    expect(screen.getAllByText(/Potential requirement \(medium witness confidence\)/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Export required-content report' }));
    await user.click(screen.getByRole('menuitem', { name: 'All included objects CSV (partial scope)' }));
    const [, columns, rows] = jest.mocked(downloadCsv).mock.calls[0];
    const column = columns.indexOf('Witness contains potential implicit dependency');
    expect(column).toBeGreaterThan(-1);
    expect(rows.filter((row) => row[column] === true)).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Export required-content report' }));
    await user.click(screen.getByRole('menuitem', { name: 'Full footprint and coverage JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-required-content.json', expect.objectContaining({
        coverage: 'partial', rows: expect.arrayContaining([expect.objectContaining({ objectId: file.objectId, via: expect.objectContaining({ conditional: true }) })]),
    }));
});
