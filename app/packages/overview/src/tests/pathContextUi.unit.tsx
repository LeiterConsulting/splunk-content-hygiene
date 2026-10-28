// Synthetic presentation/export contracts only. Never installed into native KV.
import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplunkThemeProvider } from '@splunk/themes';
import { AnimationToggleProvider } from '@splunk/react-ui/AnimationToggle';
import { PathContextDetails } from '../components/PathContextDetails';
import { ReviewNavigationProvider } from '../components/ReviewNavigationContext';
import { DependencyPage } from '../pages/DependencyPage';
import { InUseContentPage } from '../pages/InUseContentPage';
import { createPathContextTracker, PATH_CONTEXT_LIMITATION } from '../services/pathContext';
import { buildDependencyIndex, buildGraphModel } from '../services/dependencyGraph';
import { GraphContextDialog } from '../components/GraphContextDialog';
import { RemovalImpactPanel } from '../components/RemovalImpactPanel';
import { analyzeRemovalImpact } from '../services/removalImpact';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { callerReceipt, pathFixture, scopedEdge } from './pathContextFixtures';
import { now, object, review } from './milestoneFixtures';

jest.mock('../utils/downloadCsv', () => ({ downloadCsv: jest.fn() }));
jest.mock('../utils/downloadJson', () => ({ downloadJson: jest.fn() }));
const actions = { canWriteReviews: true, onSaveReview: jest.fn(), onDeleteReview: jest.fn() };
const frame = (scheme: 'light' | 'dark', child: React.ReactElement) => <SplunkThemeProvider family="enterprise" colorScheme={scheme}><ReviewNavigationProvider>{child}</ReviewNavigationProvider></SplunkThemeProvider>;
beforeEach(() => { window.history.replaceState(null, '', '/'); jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => jest.restoreAllMocks());

test.each(['light', 'dark'] as const)('mixed path context is keyboard-expandable, wrapping and actionable in %s', async scheme => {
    const { byId } = pathFixture(); const user = userEvent.setup();
    const context = createPathContextTracker(byId).path('a', [scopedEdge('a', 'b'), scopedEdge('b', 'c', [callerReceipt({ callerObjectId: 'other-caller' })])]);
    render(frame(scheme, <PathContextDetails context={context} />));
    const section = screen.getByRole('region', { name: 'Witness path context' });
    expect(getComputedStyle(section).overflowWrap).toBe('anywhere');
    expect(within(section).getByText('No shared captured context')).toBeVisible();
    const trigger = within(section).getByRole('button', { name: 'Inspect path context' }); trigger.focus(); await user.keyboard('{Enter}');
    expect(within(section).getByText(PATH_CONTEXT_LIMITATION)).toBeVisible();
    const issues = within(section).getByRole('list', { name: 'Hops needing context verification' });
    expect(within(issues).getByRole('link', { name: 'b' })).toHaveAttribute('href', expect.stringContaining('object=b'));
    expect(within(issues).getByRole('link', { name: 'c' })).toHaveAttribute('href', expect.stringContaining('object=c'));
    expect(actions.onSaveReview).not.toHaveBeenCalled();
});

test.each(['light', 'dark'] as const)('common callers stay independent, filterable and paginated in %s', async scheme => {
    const { byId } = pathFixture(); const user = userEvent.setup();
    const receipts = Array.from({ length: 6 }, (_, i) => callerReceipt({ callerObjectId: `caller-${i}`, sourceLocation: `query-${i}` }));
    receipts.forEach(row => byId.set(row.callerObjectId, object(row.callerObjectId, 'Report')));
    const context = createPathContextTracker(byId).path('a', [scopedEdge('a', 'b', receipts), scopedEdge('b', 'c', receipts)]);
    render(frame(scheme, <PathContextDetails context={context} />));
    await user.click(screen.getByRole('button', { name: 'Inspect path context' }));
    expect(screen.getByText('Shared captured caller across scoped hops')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Inspect supporting callers (6)' }));
    expect(screen.getByText('1–4 of 6 matching supporting callers')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Next supporting callers' }));
    expect(screen.getByText('5–6 of 6 matching supporting callers')).toBeVisible();
    await user.type(screen.getByRole('textbox', { name: 'Find supporting caller' }), 'caller-1');
    expect(screen.getByText('1–1 of 1 matching supporting callers')).toBeVisible();
    expect(screen.getByRole('link', { name: 'caller-1' })).toHaveAttribute('href', expect.stringContaining('object=caller-1'));
});

test.each(['light', 'dark'] as const)('expanded graph context names the ordered witness and its shared receipt in %s', async scheme => {
    const { objects, edges } = pathFixture(); const user = userEvent.setup(); const index = buildDependencyIndex(objects, edges);
    const graph = buildGraphModel('caller', index, [edges[0]], { grouping: 'none', expandedGroups: new Map(), expandedNodes: new Set(['a', 'b']) });
    const node = graph.nodes.find(item => item.id === 'c')!;
    render(frame(scheme, <AnimationToggleProvider enabled={false}><GraphContextDialog context={{ node }} open index={index}
        onClose={jest.fn()} onInspect={jest.fn()} returnFocus={jest.fn()} /></AnimationToggleProvider>));
    const element = await screen.findByRole('dialog', { name: 'Object context' });
    await waitFor(() => expect(element).toBeVisible());
    const dialog = within(element);
    expect(dialog.getByText('caller → a → b → c')).toBeVisible();
    expect(dialog.getByText('Shared captured caller across scoped hops')).toBeVisible();
    await user.click(dialog.getByRole('button', { name: 'Inspect path context' }));
    expect(dialog.getByText(PATH_CONTEXT_LIMITATION)).toBeVisible();
    await user.click(dialog.getByRole('button', { name: 'Inspect supporting callers (1)' }));
    expect(dialog.getByRole('link', { name: 'caller' })).toHaveAttribute('href', expect.stringContaining('object=caller'));
});

test.each(['light', 'dark'] as const)('impact witness details open at full width with selection focus in %s', async scheme => {
    const { data, objects, edges } = pathFixture(); const user = userEvent.setup(); const selected = objects.find(item => item.objectId === 'c')!;
    const analysis = analyzeRemovalImpact(selected, objects, edges, [], data.scan, 5, now);
    render(frame(scheme, <RemovalImpactPanel selected={selected} analysis={analysis} depth={5} onDepthChange={jest.fn()} onDrillTo={jest.fn()} />));
    await user.click(screen.getByRole('button', { name: 'Inspect witness context for caller' }));
    const heading = screen.getByRole('heading', { name: 'Witness context for caller' });
    expect(heading).toHaveFocus();
    expect(heading.closest('[data-investigation-workspace]')).toHaveAttribute('aria-label', 'Selected impact witness context');
    const section = within(screen.getByRole('region', { name: 'Selected impact witness context' }));
    expect(section.getByText('caller → a → b → c')).toBeVisible();
    expect(section.getByText(PATH_CONTEXT_LIMITATION)).toBeVisible();
    expect(section.getByText('Shared captured caller across scoped hops')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close witness context' }));
    expect(screen.queryByRole('region', { name: 'Selected impact witness context' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '3 known affected objects' })).toHaveFocus();
    expect(screen.getByRole('heading', { name: '3 known affected objects' }).closest('[data-investigation-workspace]')).not.toBeNull();
});

test.each(['light', 'dark'] as const)('Explorer relationship CSV and JSON agree on cached path context in %s', async scheme => {
    const { data } = pathFixture(); const user = userEvent.setup(); const saved = review('c'); const bytes = JSON.stringify(saved);
    window.history.replaceState(null, '', '/?object=c');
    render(frame(scheme, <DependencyPage {...actions} snapshot={data} isLoading={false} reviews={[saved]} />));
    await user.click(screen.getByRole('button', { name: 'Export investigation' }));
    await user.click(screen.getByRole('menuitem', { name: 'Filtered relationships JSON' }));
    const exported = jest.mocked(downloadJson).mock.calls[0][1] as { relationships: Array<{ pathContext: unknown }> };
    await user.click(screen.getByRole('button', { name: 'Export investigation' }));
    await user.click(screen.getByRole('menuitem', { name: 'Filtered relationships CSV' }));
    const [, columns, rows] = jest.mocked(downloadCsv).mock.calls[0];
    expect(JSON.parse(String(rows[0][columns.indexOf('Directed relationship context (one hop)')]))).toEqual(exported.relationships[0].pathContext);
    expect(JSON.stringify(saved)).toBe(bytes); expect(actions.onSaveReview).not.toHaveBeenCalled(); expect(actions.onDeleteReview).not.toHaveBeenCalled();
});

test.each(['light', 'dark'] as const)('Explorer impact CSV and JSON agree on cached path context in %s', async scheme => {
    const { data, byId } = pathFixture(); const user = userEvent.setup(); const saved = review('c'); const bytes = JSON.stringify(saved);
    window.history.replaceState(null, '', '/?object=c');
    render(frame(scheme, <DependencyPage {...actions} snapshot={data} isLoading={false} reviews={[saved]} />));
    await user.click(screen.getByRole('button', { name: 'Export investigation' }));
    await user.click(screen.getByRole('menuitem', { name: 'Full removal impact CSV' }));
    const [, impactColumns, impactRows] = jest.mocked(downloadCsv).mock.calls[0];
    const expected = createPathContextTracker(byId).path('caller', data.edges);
    const callerRow = impactRows.find(row => row[impactColumns.indexOf('Affected object ID')] === 'caller')!;
    expect(JSON.parse(String(callerRow[impactColumns.indexOf('Chosen witness path context')]))).toEqual(expected);
    expect(JSON.parse(String(callerRow[impactColumns.indexOf('Chosen witness edge IDs')]))).toEqual(data.edges.map(edge => edge.edgeId));
    await user.click(screen.getByRole('button', { name: 'Export investigation' }));
    await user.click(screen.getByRole('menuitem', { name: 'Full removal impact JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-impact.json', expect.objectContaining({
        analysis: expect.objectContaining({ affectedObjects: expect.arrayContaining([
            expect.objectContaining({ objectId: 'caller', pathContext: expected, pathEdgeIds: data.edges.map(edge => edge.edgeId) }),
        ]) }),
    }));
    expect(JSON.stringify(saved)).toBe(bytes); expect(actions.onSaveReview).not.toHaveBeenCalled(); expect(actions.onDeleteReview).not.toHaveBeenCalled();
});

test.each(['light', 'dark'] as const)('required-content detail and full/CSV exports preserve one chosen context in %s', async scheme => {
    const { data, byId } = pathFixture(); const user = userEvent.setup();
    window.history.replaceState(null, '', '/?object=caller&activity=none');
    render(frame(scheme, <InUseContentPage snapshot={data} isLoading={false} reviews={[]} reviewsVerified />));
    await user.click(screen.getByRole('button', { name: 'c' }));
    expect(screen.getByText('Shared captured caller across scoped hops')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Inspect path context' }));
    expect(within(screen.getByRole('region', { name: 'Witness path context' })).getByText(PATH_CONTEXT_LIMITATION)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Export required-content report' }));
    await user.click(screen.getByRole('menuitem', { name: 'All included objects CSV (partial scope)' }));
    const [, columns, rows] = jest.mocked(downloadCsv).mock.calls[0]; const row = rows.find(item => item[0] === 'c')!;
    expect(JSON.parse(String(row[columns.indexOf('Chosen witness path context')]))).toEqual(createPathContextTracker(byId).path('caller', data.edges));
    await user.click(screen.getByRole('button', { name: 'Export required-content report' }));
    await user.click(screen.getByRole('menuitem', { name: 'Full footprint and coverage JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-required-content.json', expect.objectContaining({ rows: expect.arrayContaining([
        expect.objectContaining({ objectId: 'c', via: expect.objectContaining({ pathContext: expect.objectContaining({ status: 'shared_caller' }) }) }),
    ]) }));
});
