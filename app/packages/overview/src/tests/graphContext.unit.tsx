// Synthetic presentation contracts only; fixtures never enter the app bundle.
import React from 'react';
import { act, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplunkThemeProvider } from '@splunk/themes';
import { AnimationToggleProvider } from '@splunk/react-ui/AnimationToggle';
import { DependencyGraph } from '../components/DependencyGraph';
import { buildDependencyIndex } from '../services/dependencyGraph';
import { ContentObject, DependencyEdge } from '../types';
import { object, edge } from './milestoneFixtures';
import { nativeMotionClock } from './nativeMotionClock';

const longName =
    'Events for account entitlement and ownership verification across business units — LOOKUP-'.repeat(
        3,
    );
const longApp = 'very_long_namespace_'.repeat(12);
const center = { ...object('automatic::rule', 'Automatic Lookup'), name: longName, app: longApp };
const caller = object('saved_search::caller', 'Report');
const explanation = `Potential match only. ${'Confirm precedence, renames, fields and app context. '.repeat(20)}`;
const location = `dashboard.searches[13].query:${'long_token_'.repeat(30)}`;
const edges = [
    {
        ...edge(caller.objectId, center.objectId, 'may_apply_automatic_lookup'),
        confidence: 'medium' as const,
        evidence: explanation,
        sourceLocation: location,
    },
    edge(caller.objectId, center.objectId, 'uses_lookup'),
];

function frame(
    scheme: 'light' | 'dark',
    onInspect: (id: string) => void,
    objects: ContentObject[] = [center, caller],
    references: DependencyEdge[] = edges,
    animate = false,
) {
    return (
        <SplunkThemeProvider family="enterprise" colorScheme={scheme}>
            {/* Keep presentation/focus tests deterministic with the documented
                SUI control, not a longer timeout or a mocked Modal. Native
                default-motion behavior is a separate runtime qualification. */}
            <AnimationToggleProvider enabled={animate}>
            <DependencyGraph
                center={center}
                index={buildDependencyIndex(objects, references)}
                edges={references}
                inspectedId={center.objectId}
                onInspect={onInspect}
                allows={() => true}
            />
            </AnimationToggleProvider>
        </SplunkThemeProvider>
    );
}

async function visibleContextDialog(name: string): Promise<HTMLElement> {
    const dialog = await screen.findByRole('dialog', { name });
    // The native Modal exposes its accessible dialog before its fade-in ends.
    // Wait for the actual visible state, not a machine-dependent event delay.
    await waitFor(() => expect(dialog).toBeVisible());
    return dialog;
}

test.each(['light', 'dark'] as const)(
    'long names/apps have persistent full context and return focus without changing the center in %s',
    async (scheme) => {
        const user = userEvent.setup();
        const inspect = jest.fn();
        render(frame(scheme, inspect));
        const trigger = screen.getByRole('button', { name: `Full context for ${longName}` });
        await user.click(trigger);
        const dialog = await visibleContextDialog('Object context');
        expect(within(dialog).getByText(longName)).toBeVisible();
        expect(within(dialog).getByText(longApp)).toBeVisible();
        expect(within(dialog).getByText(center.objectId)).toBeVisible();
        expect(inspect).not.toHaveBeenCalled();
        await user.click(within(dialog).getByRole('button', { name: 'Close context' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        await waitFor(() => expect(trigger).toHaveFocus());
    },
);

test.each(['light', 'dark'] as const)('default animated context settles, dismisses and restores focus in %s', async scheme => {
    // Exercise real SUI motion with a deterministic clock. Do not make spring
    // completion depend on a busy host delivering animation frames in 1s.
    const clock = nativeMotionClock();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const view = render(frame(scheme, jest.fn(), [center, caller], edges, true));
    try {
        const trigger = screen.getByRole('button', { name: `Full context for ${longName}` });
        await user.click(trigger);
        await clock.settle();
        const dialog = await visibleContextDialog('Object context');
        expect(dialog).toHaveStyle({ opacity: '1' });
        await user.keyboard('{Escape}');
        await clock.settle();
        expect(dialog).not.toBeVisible();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
    } finally { view.unmount(); clock.restore(); }
});

test.each(['light', 'dark'] as const)(
    'relationship hover, focus, keyboard dialog and evidence retain full context in %s',
    async (scheme) => {
        const user = userEvent.setup();
        const inspect = jest.fn();
        render(frame(scheme, inspect));
        const trigger = screen.getByRole('button', {
            name: /Relationship context: may apply automatic lookup · uses lookup/,
        });
        expect(window.getComputedStyle(trigger).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
        expect(within(trigger).getByText('+1 more · Details · medium')).toBeVisible();
        await user.hover(trigger);
        expect(await screen.findByRole('tooltip')).toHaveTextContent(longName);
        await user.unhover(trigger);
        act(() => trigger.focus());
        expect(await screen.findByRole('tooltip')).toHaveTextContent(
            'may apply automatic lookup · uses lookup',
        );
        // Pointer hover can stay on a different graph card while the keyboard
        // activates a relationship. No background preview may cover its dialog.
        await user.hover(screen.getByRole('button', { name: `Inspect ${longName}` }));
        await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Select to inspect'));
        await user.keyboard('{Enter}');
        const dialog = await visibleContextDialog('Relationship context');
        await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
        expect(within(dialog).getByText(explanation.trim())).toBeVisible();
        expect(within(dialog).getByText(location)).toBeVisible();
        expect(within(dialog).getByText('medium — weakest captured confidence')).toBeVisible();
        expect(
            within(dialog).getByText(/Potential implicit relationship — not observed execution/),
        ).toBeVisible();
        expect(within(dialog).getAllByText(longName)).toHaveLength(2);
        expect(inspect).not.toHaveBeenCalled();
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        await waitFor(() => expect(trigger).toHaveFocus());
    },
);

test('group context is paginated and retains individual member drill-through', async () => {
    const user = userEvent.setup();
    const inspect = jest.fn();
    const members = Array.from({ length: 40 }, (_unused, i) =>
        object(`Member ${String(i).padStart(2, '0')}`),
    );
    render(
        frame(
            'light',
            inspect,
            [center, ...members],
            members.map((item) => edge(item.objectId, center.objectId)),
        ),
    );
    await user.click(screen.getByRole('button', { name: 'Full context for example' }));
    const dialog = await visibleContextDialog('Grouped object context');
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(25);
    expect(within(dialog).queryByRole('button', { name: 'Member 39' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Go to next page' }));
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(15);
    await user.click(within(dialog).getByRole('button', { name: 'Member 39' }));
    expect(inspect).toHaveBeenCalledWith('Member 39');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('graph grouping changes cannot leave a stale context dialog attached to a different relationship', async () => {
    const user = userEvent.setup();
    const inspect = jest.fn();
    const members = Array.from({ length: 40 }, (_unused, i) => object(`Member ${i}`));
    const { rerender } = render(
        frame(
            'dark',
            inspect,
            [center, ...members],
            members.map((item) => edge(item.objectId, center.objectId)),
        ),
    );
    await user.click(screen.getByRole('button', { name: /Relationship context:/ }));
    expect(await visibleContextDialog('Relationship context')).toBeVisible();
    rerender(frame('dark', inspect, [center, caller], [edge(caller.objectId, center.objectId)]));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('region', { name: `Dependency graph centered on ${longName}` })).toHaveFocus();
    rerender(
        frame(
            'dark',
            inspect,
            [center, ...members],
            members.map((item) => edge(item.objectId, center.objectId)),
        ),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(inspect).not.toHaveBeenCalled();
});
