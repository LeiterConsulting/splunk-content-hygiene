// Synthetic presentation contracts only. No fixtures ship with the application.
import React from 'react';
import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplunkThemeProvider } from '@splunk/themes';
import { AnimationToggleProvider } from '@splunk/react-ui/AnimationToggle';
import { DependencyGraph } from '../components/DependencyGraph';
import { buildDependencyIndex } from '../services/dependencyGraph';
import { object, edge } from './milestoneFixtures';
import { nativeMotionClock } from './nativeMotionClock';

const center = object('root');
const objects = ['root', 'a', 'b', 'c', 'd', 'other'].map(id => object(id));
const edges = [edge('root', 'a'), edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('root', 'other')];
function frame(scheme: 'light' | 'dark', inspect = jest.fn(), animate = false) {
    return <SplunkThemeProvider family="enterprise" colorScheme={scheme}>
        <AnimationToggleProvider enabled={animate}>
            <DependencyGraph center={center} index={buildDependencyIndex(objects, edges)} edges={[edges[0], edges[4]]}
                inspectedId={center.objectId} onInspect={inspect} allows={() => true} />
        </AnimationToggleProvider>
    </SplunkThemeProvider>;
}
async function dialog(name: string): Promise<HTMLElement> {
    const element = await screen.findByRole('dialog', { name });
    await waitFor(() => expect(element).toBeVisible()); return element;
}
const highlightedPaths = () => screen.getByRole('region', { name: 'Dependency graph centered on root' }).querySelectorAll('path[data-graph-highlighted="true"]');
const highlightedNodes = () => [...screen.getByRole('region', { name: 'Dependency graph centered on root' }).querySelectorAll('[data-graph-node][data-graph-highlighted="true"]')].map(node => node.getAttribute('data-graph-node'));

test.each(['light', 'dark'] as const)('hover/focus identifies exactly the relationship and both endpoint cards in %s', async scheme => {
    const user = userEvent.setup(); const inspect = jest.fn(); render(frame(scheme, inspect));
    const trigger = screen.getByRole('button', { name: /Relationship context: .* from root to a$/ });
    expect(within(trigger).getByText('root → a')).toBeVisible();
    await user.hover(trigger);
    expect(highlightedPaths()).toHaveLength(1);
    expect(highlightedNodes()).toEqual(['root', 'a']);
    expect(screen.getByLabelText('Highlighted graph context')).toHaveTextContent(/Connection: root.*a/);
    await user.unhover(trigger);
    expect(highlightedPaths()).toHaveLength(0);
    act(() => trigger.focus());
    await waitFor(() => expect(highlightedPaths()).toHaveLength(1));
    expect(highlightedNodes()).toEqual(['root', 'a']);
    await user.keyboard('{Enter}');
    const context = await dialog('Relationship context');
    expect(highlightedPaths()).toHaveLength(1);
    const endpointLabels = within(context).getAllByText('root', { exact: true });
    expect(endpointLabels).toHaveLength(2);
    endpointLabels.forEach(label => expect(label).toBeVisible());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(highlightedPaths()).toHaveLength(1);
    expect(inspect).not.toHaveBeenCalled();
});

test('keyboard focus supersedes a stationary pointer on a different relationship, and later pointer movement can take over', async () => {
    const user = userEvent.setup(); render(frame('dark'));
    const pointer = screen.getByRole('button', { name: /Relationship context: .* from root to other$/ });
    const keyboard = screen.getByRole('button', { name: /Relationship context: .* from root to a$/ });
    await user.hover(pointer);
    expect(highlightedNodes()).toEqual(['root', 'other']);
    act(() => keyboard.focus());
    await waitFor(() => expect(highlightedNodes()).toEqual(['root', 'a']));
    await user.unhover(pointer); await user.hover(pointer);
    expect(highlightedNodes()).toEqual(['root', 'other']);
    await user.unhover(pointer);
    expect(highlightedNodes()).toEqual(['root', 'a']);
});

test.each(['light', 'dark'] as const)('relationship anchors do not enlarge hidden screen-reader content in %s', scheme => {
    render(frame(scheme));
    const trigger = screen.getByRole('button', { name: /Relationship context: .* from root to a$/ });
    const description = trigger.closest('[data-graph-link]')!.querySelector('[data-test="screen-reader-content"]')!;
    expect(description).toBeInTheDocument();
    expect(getComputedStyle(description).width).toBe('1px');
    expect(getComputedStyle(description).height).toBe('1px');
    expect(trigger).toHaveAttribute('aria-describedby');
});

test.each(['light', 'dark'] as const)('all/branch controls disclose depth limits and preserve shared/filter-independent evidence in %s', async scheme => {
    const user = userEvent.setup(); const inspect = jest.fn(); render(frame(scheme, inspect));
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getByRole('button', { name: 'Inspect c' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Inspect d' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Expansion stops at 3 hops');
    expect(screen.queryByRole('button', { name: 'Expand branch for c' })).not.toBeInTheDocument();
    expect(screen.getByText('3-hop display limit · inspect to re-center')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Collapse branch for a' }));
    expect(screen.queryByRole('button', { name: 'Inspect b' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inspect other' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Expand branch for a' }));
    expect(screen.getByRole('button', { name: 'Inspect c' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryByRole('button', { name: 'Inspect b' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inspect a' })).toBeVisible();
    expect(inspect).not.toHaveBeenCalled();
});

test.each(['light', 'dark'] as const)('zoom reflows detail without dropping connections or endpoints in %s', async scheme => {
    const user = userEvent.setup(); render(frame(scheme));
    const graph = screen.getByRole('region', { name: 'Dependency graph centered on root' });
    const before = graph.querySelectorAll('[data-graph-link]').length;
    await user.click(screen.getByRole('button', { name: 'Zoom out graph' }));
    expect(graph.closest('[data-graph-density]')).toHaveAttribute('data-graph-density', 'overview');
    expect(screen.getByRole('button', { name: 'Reset graph zoom to 100 percent' })).toHaveTextContent('90%');
    expect(graph.querySelectorAll('[data-graph-link]')).toHaveLength(before);
    expect(screen.getByRole('button', { name: /Relationship context: .* from root to a$/ })).toHaveTextContent('root → a');
    await user.click(screen.getByRole('button', { name: 'Reset graph zoom to 100 percent' }));
    expect(graph.closest('[data-graph-density]')).toHaveAttribute('data-graph-density', 'detail');
    expect(graph.querySelectorAll('[data-graph-link]')).toHaveLength(before);
});

test.each(['light', 'dark'] as const)('full-window graph retains state/pan and nested Escape restores the right focus in %s', async scheme => {
    const user = userEvent.setup(); const inspect = jest.fn(); render(frame(scheme, inspect));
    await user.click(screen.getByRole('button', { name: 'Expand branch for a' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out graph' }));
    const viewport = screen.getByRole('region', { name: 'Dependency graph centered on root' });
    viewport.scrollLeft = 120; viewport.scrollTop = 70;
    await user.click(screen.getByRole('button', { name: 'Full screen graph' }));
    const full = await dialog('Dependency tree');
    expect(screen.getAllByRole('region', { name: 'Dependency graph centered on root' })).toHaveLength(1);
    expect(within(full).getByRole('button', { name: 'Reset graph zoom to 100 percent' })).toHaveTextContent('90%');
    expect(within(full).getByRole('button', { name: 'Collapse branch for a' })).toBeVisible();
    const fullViewport = within(full).getByRole('region', { name: 'Dependency graph centered on root' });
    expect(fullViewport.scrollLeft).toBe(120); expect(fullViewport.scrollTop).toBe(70);
    const detail = within(full).getByRole('button', { name: 'Full context for a' });
    await user.click(detail); await dialog('Object context');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Object context' })).not.toBeInTheDocument());
    expect(full).toBeVisible(); await waitFor(() => expect(detail).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Full screen graph' })).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Collapse branch for a' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reset graph zoom to 100 percent' })).toHaveTextContent('90%');
    expect(screen.getByRole('region', { name: 'Dependency graph centered on root' }).scrollLeft).toBe(120);
    expect(inspect).not.toHaveBeenCalled();
});

test.each(['light', 'dark'] as const)('default animated full-window entry retains global expansion through settled paint and exit in %s', async scheme => {
    const clock = nativeMotionClock();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime }); const view = render(frame(scheme, jest.fn(), true));
    try {
        await user.click(screen.getByRole('button', { name: 'Expand all' }));
        expect(screen.getByRole('button', { name: 'Inspect c' })).toBeVisible();
        await user.click(screen.getByRole('button', { name: 'Full screen graph' }));
        await clock.settle();
        const full = await dialog('Dependency tree');
        expect(full).toHaveStyle({ opacity: '1' });
        expect(within(full).getByRole('button', { name: 'Inspect c' })).toBeVisible();
        expect(within(full).getByRole('button', { name: 'Collapse branch for a' })).toBeVisible();
        await user.keyboard('{Escape}');
        await clock.settle();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Full screen graph' })).toHaveFocus();
        expect(screen.getByRole('button', { name: 'Inspect c' })).toBeVisible();
    } finally { view.unmount(); clock.restore(); }
});

function hubFrame(scheme: 'light' | 'dark', inspect = jest.fn()) {
    const hubObjects = [center, ...Array.from({ length: 80 }, (_, i) => object(`neighbor-${String(i).padStart(2, '0')}`))];
    const hubEdges = hubObjects.slice(1).map(item => edge('root', item.objectId));
    return <SplunkThemeProvider family="enterprise" colorScheme={scheme}><AnimationToggleProvider enabled={false}>
        <DependencyGraph center={center} index={buildDependencyIndex(hubObjects, hubEdges)} edges={hubEdges}
            inspectedId="root" onInspect={inspect} allows={() => true} />
    </AnimationToggleProvider></SplunkThemeProvider>;
}

test.each(['light', 'dark'] as const)('expanded hubs page cards and find/focus off-page endpoints without changing the map or decisions in %s', async scheme => {
    const user = userEvent.setup(); const inspect = jest.fn(); render(hubFrame(scheme, inspect));
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    const viewport = screen.getByRole('region', { name: 'Dependency graph centered on root' });
    expect(viewport.querySelectorAll('[data-graph-node]')).toHaveLength(3);
    expect(screen.getByRole('status')).toHaveTextContent('continuation groups retain all off-page references');
    await user.click(screen.getByRole('button', { name: 'Next object cards at hop 1' }));
    expect(screen.getByRole('button', { name: 'Inspect neighbor-01' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Inspect neighbor-00' })).not.toBeInTheDocument();
    const before = [...viewport.querySelectorAll('[data-graph-node]')].map(node => node.getAttribute('data-graph-node'));
    await user.click(screen.getByRole('button', { name: 'Browse connections (80)' }));
    const browse = await dialog('Browse captured connections');
    expect(within(browse).getByText('80 captured references')).toBeVisible();
    await user.type(within(browse).getByRole('textbox', { name: 'Find a captured connection' }), 'neighbor-79');
    expect(within(browse).getByRole('status')).toHaveTextContent('1–1 of 1');
    await user.click(within(browse).getByRole('button', { name: 'Focus endpoints: root to neighbor-79' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(viewport.closest('[data-graph-view]')).toHaveAttribute('data-graph-view', 'connection');
    expect(screen.getByRole('button', { name: 'Inspect neighbor-79' })).toBeVisible();
    expect(viewport.querySelectorAll('[data-graph-node]')).toHaveLength(2);
    expect(highlightedPaths()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Expand all' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Map center remains root');
    await user.click(screen.getByRole('button', { name: 'Return to map' }));
    expect(viewport.closest('[data-graph-view]')).toHaveAttribute('data-graph-view', 'map');
    expect([...viewport.querySelectorAll('[data-graph-node]')].map(node => node.getAttribute('data-graph-node'))).toEqual(before);
    expect(screen.getByRole('button', { name: 'Reset graph zoom to 100 percent' })).toHaveTextContent('100%');
    expect(inspect).not.toHaveBeenCalled();
});

test('resizing and zooming a hub change the map window, not the captured connection count', async () => {
    const user = userEvent.setup(); render(hubFrame('dark'));
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    const viewport = screen.getByRole('region', { name: 'Dependency graph centered on root' });
    expect(viewport.querySelectorAll('[data-graph-node]')).toHaveLength(3);
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 1200 });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 900 });
    fireEvent(window, new Event('resize'));
    expect(viewport.querySelectorAll('[data-graph-node]')).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: 'Zoom out graph' }));
    expect(screen.getByRole('button', { name: 'Browse connections (80)' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryByRole('button', { name: 'Next object cards at hop 1' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse connections (80)' })).toBeVisible();
});
