// Synthetic UI/export contracts only. No native fixture installation.
import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplunkThemeProvider } from '@splunk/themes';
import { AnimationToggleProvider } from '@splunk/react-ui/AnimationToggle';
import { AlternativePathPanel } from '../components/AlternativePathPanel';
import { DependencyGraph } from '../components/DependencyGraph';
import { RemovalImpactPanel } from '../components/RemovalImpactPanel';
import { ReviewNavigationProvider } from '../components/ReviewNavigationContext';
import { InUseContentPage } from '../pages/InUseContentPage';
import { ReviewLibraryPage } from '../pages/ReviewLibraryPage';
import { buildDependencyIndex } from '../services/dependencyGraph';
import { investigateAlternativePaths, pathInvestigationCsv } from '../services/alternativePaths';
import { analyzeRemovalImpact } from '../services/removalImpact';
import { downloadJson } from '../utils/downloadJson';
import { downloadCsv } from '../utils/downloadCsv';
import { edge, now, object, review, snapshot } from './milestoneFixtures';

jest.mock('../utils/downloadJson', () => ({ downloadJson: jest.fn() }));
jest.mock('../utils/downloadCsv', () => ({ downloadCsv: jest.fn() }));
const actions = { canWriteReviews: true, onSaveReview: jest.fn(), onDeleteReview: jest.fn() };
const frame = (scheme: 'light' | 'dark', child: React.ReactElement) => <SplunkThemeProvider family="enterprise" colorScheme={scheme}><AnimationToggleProvider enabled={false}><ReviewNavigationProvider>{child}</ReviewNavigationProvider></AnimationToggleProvider></SplunkThemeProvider>;
async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string | RegExp): Promise<void> {
    await user.click(screen.getByRole('combobox', { name: label }));
    await user.click(screen.getByRole('option', { name: option }));
}
function fixture() {
    const objects = ['root', 'a', 'b', 'target'].map(id => object(id));
    const edges = [edge('root', 'a'), edge('a', 'target'), edge('root', 'b'), edge('b', 'target')];
    const baseline = edges.slice(0, 2).map(item => item.edgeId);
    return { objects, edges, baseline, index: buildDependencyIndex(objects, edges), data: snapshot(objects, edges) };
}
beforeEach(() => { window.history.replaceState(null, '', '/'); jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => jest.restoreAllMocks());

test.each(['light', 'dark'] as const)('on-demand comparison/selection/export retains facts and wraps in %s', async scheme => {
    const data = fixture(); const user = userEvent.setup(); const inspect = jest.fn(); const focus = jest.fn();
    render(frame(scheme, <AlternativePathPanel {...data} sourceId="root" targetId="target" baselineEdgeIds={data.baseline} onInspect={inspect} onFocusPath={focus} />));
    const trigger = screen.getByRole('button', { name: 'Compare alternative paths' }); trigger.focus(); await user.keyboard('{Enter}');
    expect(screen.queryByRole('group', { name: 'Path to inspect' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Find alternative paths' }));
    const expected = investigateAlternativePaths(data.index, 'root', 'target', data.baseline);
    const choices = screen.getByRole('group', { name: 'Path to inspect' });
    expect(within(choices).getAllByRole('button')).toHaveLength(2);
    expect(within(choices).getByRole('button', { name: /^Original witness ·/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(choices).getByRole('button', { name: /^Alternative 1 ·/ }));
    expect(within(choices).getByRole('button', { name: /^Alternative 1 ·/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(choices).getByRole('button', { name: /^Alternative 1 ·/ })).toHaveAttribute('data-investigation-path', expected.paths[1].id);
    expect(screen.queryByText(expected.paths[1].id)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Inspect exact path identity' }));
    expect(screen.getByText(expected.paths[1].id)).toBeVisible();
    const hops = screen.getByRole('list', { name: 'Selected path hops' });
    expect(getComputedStyle(screen.getByRole('region', { name: 'Alternative path investigation' })).overflowWrap).toBe('anywhere');
    await user.click(within(hops).getAllByRole('button', { name: 'b' })[0]); expect(inspect).toHaveBeenCalledWith('b');
    await user.click(screen.getByRole('button', { name: 'Focus selected path in map' }));
    expect(focus).toHaveBeenCalledWith(data.edges.slice(2));
    await user.click(screen.getByRole('button', { name: 'Export path investigation JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-path-investigation.json', expected);
    await user.click(screen.getByRole('button', { name: 'Export path investigation CSV' }));
    const csv = pathInvestigationCsv(expected); expect(downloadCsv).toHaveBeenCalledWith('content-hygiene-path-investigation.csv', csv.columns, csv.rows);
    expect(actions.onSaveReview).not.toHaveBeenCalled(); expect(actions.onDeleteReview).not.toHaveBeenCalled();
});

test.each(['light', 'dark'] as const)('Explorer isolates all exact selected-path connectors and restores its map in %s', async scheme => {
    const data = fixture(); const user = userEvent.setup();
    render(frame(scheme, <DependencyGraph center={data.objects[0]} index={data.index} edges={data.edges.filter(item => item.sourceId === 'root')} inspectedId="root" onInspect={jest.fn()} allows={() => true} />));
    await choose(user, 'Group high-degree relationships', 'Individual objects');
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    const originalNodes = [...document.querySelectorAll('[data-graph-node]')].map(element => element.getAttribute('data-graph-node'));
    await user.click(screen.getByRole('button', { name: 'Full context for target' }));
    const dialog = await screen.findByRole('dialog', { name: 'Object context' }); await waitFor(() => expect(dialog).toBeVisible());
    await user.click(within(dialog).getByRole('button', { name: 'Compare alternative paths' }));
    await user.click(within(dialog).getByRole('button', { name: 'Find alternative paths' }));
    await user.click(within(dialog).getByRole('button', { name: /^Alternative 1 ·/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Focus selected path in map' }));
    expect(document.querySelector('[data-graph-workspace]')).toHaveAttribute('data-graph-view', 'path');
    expect([...document.querySelectorAll('[data-graph-node]')].map(element => element.getAttribute('data-graph-node'))).toEqual(['root', 'b', 'target']);
    expect(document.querySelectorAll('path[data-graph-highlighted="true"]')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Return to map' }));
    expect(document.querySelector('[data-graph-workspace]')).toHaveAttribute('data-graph-view', 'map');
    expect([...document.querySelectorAll('[data-graph-node]')].map(element => element.getAttribute('data-graph-node'))).toEqual(originalNodes);
    expect(screen.getByRole('combobox', { name: 'Group high-degree relationships' })).toHaveTextContent('Individual objects');
});

test.each(['light', 'dark'] as const)('impact uses the identical source-to-target comparison in %s', async scheme => {
    const data = fixture(); const user = userEvent.setup(); const selected = data.objects[3];
    const analysis = analyzeRemovalImpact(selected, data.objects, data.edges, [], data.data.scan, 5, now);
    render(frame(scheme, <RemovalImpactPanel index={data.index} selected={selected} analysis={analysis} depth={5} onDepthChange={jest.fn()} onDrillTo={jest.fn()} />));
    await user.click(screen.getByRole('button', { name: 'Inspect witness context for root' }));
    await user.click(screen.getByRole('button', { name: 'Compare alternative paths' }));
    await user.click(screen.getByRole('button', { name: 'Find alternative paths' }));
    await user.click(screen.getByRole('button', { name: 'Export path investigation JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-path-investigation.json', investigateAlternativePaths(data.index, 'root', 'target', analysis.affectedObjects.find(item => item.objectId === 'root')!.pathEdgeIds));
});

test.each(['light', 'dark'] as const)('required-content comparison leaves the original witness/report intact in %s', async scheme => {
    const data = fixture(); const user = userEvent.setup(); window.history.replaceState(null, '', '/?object=root&activity=none');
    render(frame(scheme, <InUseContentPage snapshot={data.data} isLoading={false} reviews={[]} reviewsVerified />));
    await user.click(screen.getByRole('button', { name: 'target' }));
    await user.click(screen.getByRole('button', { name: 'Compare alternative paths' }));
    await user.click(screen.getByRole('button', { name: 'Find alternative paths' }));
    await user.click(screen.getByRole('button', { name: 'Export path investigation JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-path-investigation.json', investigateAlternativePaths(data.index, 'root', 'target', data.baseline));
});

test.each(['light', 'dark'] as const)('Library compares exact endpoints without saving/reaffirming the decision in %s', async scheme => {
    const data = fixture(); const user = userEvent.setup(); const saved = review('root'); const bytes = JSON.stringify(saved);
    window.history.replaceState(null, '', '/?object=root');
    render(frame(scheme, <ReviewLibraryPage snapshot={data.data} reviews={[saved]} isLoading={false} loadError={null} {...actions} />));
    await user.click(screen.getByRole('tab', { name: 'Dependency paths' }));
    await choose(user, 'Other endpoint', 'target · Macro · example · target');
    await user.click(screen.getByRole('button', { name: 'Compare alternative paths' }));
    await user.click(screen.getByRole('button', { name: 'Find alternative paths' }));
    await user.click(screen.getByRole('button', { name: 'Export path investigation JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-path-investigation.json', investigateAlternativePaths(data.index, 'root', 'target'));
    expect(JSON.stringify(saved)).toBe(bytes); expect(actions.onSaveReview).not.toHaveBeenCalled(); expect(actions.onDeleteReview).not.toHaveBeenCalled();
});
