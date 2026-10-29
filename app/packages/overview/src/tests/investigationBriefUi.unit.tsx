// Synthetic component/navigation contracts; native runtime/theme checks are separate.
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplunkThemeProvider } from '@splunk/themes';
import { InvestigationBrief } from '../components/InvestigationBrief';
import { ReviewNavigationProvider } from '../components/ReviewNavigationContext';
import { CandidatesPage } from '../pages/CandidatesPage';
import { ReviewLibraryPage } from '../pages/ReviewLibraryPage';
import { DependencyPage } from '../pages/DependencyPage';
import { investigationBrief, investigationBriefCsv } from '../services/investigationBrief';
import { focusInvestigation } from '../utils/focusInvestigation';
import { navigateToView } from '../utils/navigation';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { briefFixture } from './investigationBriefFixtures';
import { edge, now, review, snapshot } from './milestoneFixtures';

jest.mock('../utils/navigation', () => ({ ...jest.requireActual('../utils/navigation'), navigateToView: jest.fn() }));
jest.mock('../utils/downloadCsv', () => ({ downloadCsv: jest.fn() }));
jest.mock('../utils/downloadJson', () => ({ downloadJson: jest.fn() }));
const frame = (scheme: 'light' | 'dark', child: React.ReactElement) => <SplunkThemeProvider family="enterprise" colorScheme={scheme}><ReviewNavigationProvider>{child}</ReviewNavigationProvider></SplunkThemeProvider>;
const writes = { canWriteReviews: true, onSaveReview: jest.fn(), onDeleteReview: jest.fn() };
beforeEach(() => { window.history.replaceState(null, '', '/'); jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => jest.restoreAllMocks());
const brief = () => within(screen.getByRole('region', { name: 'Investigation brief' }));

test.each(['light', 'dark'] as const)('brief discloses provenance with native keyboard controls and exports identical facts in %s', async scheme => {
    const user = userEvent.setup(); const { item, identity, data, saved } = briefFixture(); const action = jest.fn();
    const input = { identity, object: item, scan: data.scan, review: saved, now };
    render(frame(scheme, <InvestigationBrief {...input} onAction={action} />));
    expect(brief().getByText('Confirmed eligible')).toBeVisible();
    expect(brief().getByText(/Current — unchanged within captured coverage/)).toBeVisible();
    expect(brief().getByText(/This page reads a cache, not the live object/)).toBeVisible();
    expect(screen.queryByText('scan-fixture')).not.toBeInTheDocument();
    const expand = brief().getByRole('button', { name: 'Inspect brief evidence and provenance' }); expand.focus(); await user.keyboard('{Enter}');
    expect(brief().getByText('scan-fixture')).toBeVisible();
    await user.click(brief().getByRole('button', { name: 'Inspect captured relationships' }));
    expect(action).toHaveBeenCalledWith('relationships');
    const report = investigationBrief(input);
    await user.click(brief().getByRole('button', { name: 'Export brief' })); await user.click(screen.getByRole('menuitem', { name: 'Investigation brief JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-investigation-brief.json', report);
    await user.click(brief().getByRole('button', { name: 'Export brief' })); await user.click(screen.getByRole('menuitem', { name: 'Investigation brief CSV' }));
    const csv = investigationBriefCsv(report); expect(downloadCsv).toHaveBeenCalledWith('content-hygiene-investigation-brief.csv', csv.columns, csv.rows);
    expect(writes.onSaveReview).not.toHaveBeenCalled();
});

test.each(['light', 'dark'] as const)('Candidates opens selected usage, then exact scoped evidence without saving in %s', async scheme => {
    const user = userEvent.setup(); const { item, data } = briefFixture('Report'); item.usageEvidence = null;
    window.history.replaceState(null, '', '/?object=subject'); const bytes = JSON.stringify(data);
    render(frame(scheme, <CandidatesPage {...writes} snapshot={data} isLoading={false} reviews={[]} />));
    await user.click(brief().getByRole('button', { name: 'Inspect usage evidence' }));
    await waitFor(() => expect(screen.getByLabelText('Usage evidence details')).toHaveFocus());
    expect(screen.getByRole('tab', { name: 'Candidate evidence' })).toHaveAttribute('aria-selected', 'true');
    expect(JSON.stringify(data)).toBe(bytes); expect(writes.onSaveReview).not.toHaveBeenCalled();
});

test.each(['light', 'dark'] as const)('an unverified review store is never labeled as no decision or unreviewed in %s', scheme => {
    const { item, identity, data } = briefFixture();
    render(frame(scheme, <InvestigationBrief identity={identity} object={item} scan={data.scan} reviewsVerified={false} now={now} onAction={jest.fn()} />));
    expect(brief().getByText('Unknown — library not verified')).toBeVisible();
    expect(brief().getByText('Cannot verify')).toBeVisible();
    expect(brief().queryByText('No saved decision')).not.toBeInTheDocument();
    expect(brief().getByRole('button', { name: 'Inspect saved review status' })).toBeEnabled();
});

test('Candidates’ changed-review suggestion honors the existing unsaved-draft guard', async () => {
    const user = userEvent.setup(); const { item, data } = briefFixture();
    window.history.replaceState(null, '', '/?object=subject');
    render(frame('dark', <CandidatesPage {...writes} snapshot={data} isLoading={false} reviews={[review(item.objectId)]} />));
    await user.click(screen.getByRole('tab', { name: 'Review decision' }));
    await user.type(screen.getByRole('textbox', { name: 'Investigation note' }), ' unsaved');
    await user.click(brief().getByRole('button', { name: 'Inspect evidence & changes' }));
    expect(screen.getByRole('dialog')).toBeVisible(); expect(navigateToView).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('textbox', { name: 'Investigation note' })).toHaveValue('Original rationale unsaved');
    expect(writes.onSaveReview).not.toHaveBeenCalled();
});

test.each(['light', 'dark'] as const)('Library starts on changed evidence but preserves explicit tabs and drafts through refresh in %s', async scheme => {
    const user = userEvent.setup(); const { item, data, saved } = briefFixture(); item.reviewEvidence!.enabled = false;
    window.history.replaceState(null, '', '/?object=subject');
    const page = (record = saved) => frame(scheme, <ReviewLibraryPage {...writes} snapshot={data} isLoading={false} loadError={null} reviews={[record]} />);
    const { rerender } = render(page());
    expect(screen.getByRole('tab', { name: 'Evidence & changes' })).toHaveAttribute('aria-selected', 'true');
    await user.click(brief().getByRole('button', { name: 'Inspect evidence & changes' }));
    await waitFor(() => expect(screen.getByLabelText('Review evidence details')).toHaveFocus());
    await user.click(screen.getByRole('tab', { name: 'Review decision' }));
    const note = screen.getByRole('textbox', { name: 'Investigation note' }); await user.type(note, ' draft');
    const refreshed = { ...saved, evidenceBaseline: { ...saved.evidenceBaseline!, evidence: { ...item.reviewEvidence! } } };
    rerender(page(refreshed));
    expect(screen.getByRole('tab', { name: 'Review decision' })).toHaveAttribute('aria-selected', 'true');
    expect(note).toHaveValue('Original rationale draft'); expect(writes.onSaveReview).not.toHaveBeenCalled();
});

test.each(['light', 'dark'] as const)('Library never uses historical fallback counts or health as current in %s', async scheme => {
    const user = userEvent.setup(); const { saved } = briefFixture(); window.history.replaceState(null, '', '/?object=subject');
    render(frame(scheme, <ReviewLibraryPage {...writes} snapshot={snapshot([])} isLoading={false} loadError={null} reviews={[saved]} />));
    expect(brief().getByText('Current relationship counts are unknown.')).toBeVisible();
    expect(brief().getByText(/current state cannot be established/)).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Object & usage details' }));
    expect(screen.getAllByText('Unknown — current object not observed')).toHaveLength(2);
    expect(screen.getByText(/Current field and usage evidence is unavailable/)).toBeVisible();
    expect(writes.onSaveReview).not.toHaveBeenCalled();
});

test.each(['light', 'dark'] as const)('Explorer brief and Changes follow inspected neighbor, not graph center, in %s', async scheme => {
    const user = userEvent.setup(); const root = briefFixture('Macro', 'root').item; const neighbor = briefFixture('Macro', 'neighbor').item;
    const data = snapshot([root, neighbor], [edge(root.objectId, neighbor.objectId)]); const saved = review(neighbor.objectId); const bytes = JSON.stringify([data, saved]);
    window.history.replaceState(null, '', '/?object=root&tab=relationships');
    render(frame(scheme, <DependencyPage {...writes} snapshot={data} isLoading={false} reviews={[saved]} />));
    await user.click(screen.getByRole('button', { name: 'Inspect neighbor' }));
    expect(brief().getByRole('heading', { name: 'Investigation brief: neighbor' })).toBeVisible();
    await user.click(brief().getByRole('button', { name: 'Inspect evidence & changes' }));
    await waitFor(() => expect(screen.getByLabelText('Review evidence details')).toHaveFocus());
    expect(screen.getByText('Investigated object: neighbor')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Selected object' })).toHaveTextContent('root');
    expect(JSON.stringify([data, saved])).toBe(bytes); expect(writes.onSaveReview).not.toHaveBeenCalled();
});

test.each(['light', 'dark'] as const)('Explorer relationship suggestion explicitly centers the inspected identity with unfiltered scope in %s', async scheme => {
    const user = userEvent.setup(); const root = briefFixture('Macro', 'root').item; const neighbor = briefFixture('Macro', 'neighbor').item;
    const data = snapshot([root, neighbor], [edge(root.objectId, neighbor.objectId)]);
    window.history.replaceState(null, '', '/?object=root&direction=outbound');
    render(frame(scheme, <DependencyPage {...writes} snapshot={data} isLoading={false} reviews={[]} />));
    await user.click(screen.getByRole('button', { name: 'Inspect neighbor' }));
    await user.click(brief().getByRole('button', { name: 'Inspect captured relationships' }));
    expect(screen.getByRole('combobox', { name: 'Selected object' })).toHaveTextContent('neighbor');
    expect(new URLSearchParams(window.location.search).get('direction')).toBe('all');
    expect(writes.onSaveReview).not.toHaveBeenCalled();
});

test('Explorer browser history restores Caller context instead of falling back to the graph', async () => {
    const { data } = briefFixture('Report'); window.history.replaceState(null, '', '/?object=subject');
    render(frame('dark', <DependencyPage {...writes} snapshot={data} isLoading={false} reviews={[]} />));
    act(() => { window.history.replaceState(null, '', '/?object=subject&tab=context'); fireEvent(window, new PopStateEvent('popstate')); });
    expect(screen.getByRole('tab', { name: 'Caller context' })).toHaveAttribute('aria-selected', 'true');
});

test('deferred focus rejects stale identity, hidden panels and detached targets', () => {
    let queued: FrameRequestCallback = () => undefined;
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { queued = callback; return 1; });
    const { unmount } = render(<div data-investigation-object-id="different"><div tabIndex={-1} aria-label="Target" /></div>);
    const target = screen.getByLabelText('Target'); const spy = jest.spyOn(target, 'focus');
    focusInvestigation(() => target, 'subject'); queued(0); expect(spy).not.toHaveBeenCalled();
    target.parentElement!.setAttribute('data-investigation-object-id', 'subject'); target.hidden = true;
    focusInvestigation(() => target, 'subject'); queued(0); expect(spy).not.toHaveBeenCalled();
    target.hidden = false; unmount(); focusInvestigation(() => target, 'subject'); queued(0); expect(spy).not.toHaveBeenCalled();
});
