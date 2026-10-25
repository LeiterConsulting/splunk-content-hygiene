import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplunkThemeProvider } from '@splunk/themes';
import { InUseContentPage } from '../pages/InUseContentPage';
import { ButtonRow, StyledButton } from '../AppStyles';
import { PageHeader } from '../components/PageHeader';
import { ReviewNavigationProvider } from '../components/ReviewNavigationContext';
import { InventorySnapshot } from '../types';
import { edge, now, object, review, snapshot, usage } from './milestoneFixtures';

beforeEach(() => {
    window.history.replaceState(null, '', '/');
    jest.spyOn(Date, 'now').mockReturnValue(now);
});
afterEach(() => jest.restoreAllMocks());

function frame(data: InventorySnapshot | null, scheme: 'light' | 'dark', isLoading = false) {
    return <SplunkThemeProvider family="enterprise" colorScheme={scheme}>
        <ReviewNavigationProvider>
            <InUseContentPage snapshot={data} isLoading={isLoading} reviews={[review('Retained')]} reviewsVerified />
        </ReviewNavigationProvider>
    </SplunkThemeProvider>;
}
async function choose(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
    await user.click(screen.getByRole('combobox', { name: label }));
    await user.click(screen.getByRole('option', { name: value }));
}
const observed = { ...object('Observed', 'Dashboard'), app: 'dashboard_app', usageEvidence: usage({ activityKind: 'dashboard_view' }) };
const data = snapshot(
    [object('Retained'), { ...object('File', 'Lookup file'), app: 'lookup_app' }, observed],
    [edge('Retained', 'File', 'uses_file')],
);

test.each(['light', 'dark'] as const)('invalid type/app filters recover when Retain roots disappear in %s', async (scheme) => {
    const user = userEvent.setup();
    render(frame(data, scheme));
    await choose(user, 'Included type', 'Lookup file');
    await choose(user, 'Included app', 'lookup_app');
    expect(screen.getByRole('heading', { name: '1 included identities' })).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: 'Include active Retain decisions' }));
    expect(screen.getByRole('combobox', { name: 'Included type' })).toHaveTextContent('All types');
    expect(screen.getByRole('combobox', { name: 'Included app' })).toHaveTextContent('All apps');
    expect(screen.getByRole('heading', { name: '1 included identities' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Observed' })).toBeVisible();
    expect(screen.getByText(/Included type and app filters were reset/).closest('[role="status"]')).toHaveAttribute('aria-live', 'polite');
    // Restoring the old roots must not reactivate the obsolete stored filters.
    await user.click(screen.getByRole('checkbox', { name: 'Include active Retain decisions' }));
    expect(screen.getByRole('heading', { name: '3 included identities' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Included app' })).toHaveTextContent('All apps');
    await user.click(screen.getByRole('button', { name: 'Lookup file: 1' }));
    expect(screen.queryByText(/Included type and app filters were reset/)).not.toBeInTheDocument();
    expect(screen.getByText('Partial coverage — not a migration manifest')).toBeVisible();
});

test.each(['light', 'dark'] as const)('valid filters and text search survive snapshot changes in %s', async (scheme) => {
    const user = userEvent.setup();
    const { rerender } = render(frame(data, scheme));
    await choose(user, 'Included type', 'Lookup file');
    await choose(user, 'Included app', 'lookup_app');
    await user.type(screen.getByRole('textbox', { name: 'Find included object' }), 'File');
    const changed = snapshot([...data.objects, object('Unrelated')], data.edges);
    changed.scan.scanId = 'new-inventory';
    rerender(frame(changed, scheme));
    expect(screen.getByRole('combobox', { name: 'Included type' })).toHaveTextContent('Lookup file');
    expect(screen.getByRole('combobox', { name: 'Included app' })).toHaveTextContent('lookup_app');
    expect(screen.getByRole('textbox', { name: 'Find included object' })).toHaveValue('File');
    expect(screen.queryByText(/filter.*reset to All/)).not.toBeInTheDocument();
});

test.each(['light', 'dark'] as const)('loading is not treated as option loss; an empty settled footprint is in %s', async (scheme) => {
    const user = userEvent.setup();
    const { rerender } = render(frame(data, scheme));
    await choose(user, 'Included app', 'lookup_app');
    rerender(frame(null, scheme, true));
    rerender(frame(data, scheme));
    expect(screen.getByRole('combobox', { name: 'Included app' })).toHaveTextContent('lookup_app');
    rerender(frame(snapshot([]), scheme));
    expect(screen.getByRole('combobox', { name: 'Included app' })).toHaveTextContent('All apps');
    expect(screen.getByText(/Included app filter was reset/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Clear display filters' }));
    expect(screen.queryByText(/Included app filter was reset/)).not.toBeInTheDocument();
});

test.each(['light', 'dark'] as const)('activity changes reset only the vanished type, not a still-valid app in %s', async (scheme) => {
    const user = userEvent.setup();
    const sameApp = snapshot([
        { ...object('Search', 'Report'), usageEvidence: usage() },
        { ...observed, app: 'example' },
    ]);
    render(frame(sameApp, scheme));
    await choose(user, 'Included type', 'Report');
    await choose(user, 'Included app', 'example');
    await choose(user, 'Activity kinds', 'Dashboard views only');
    expect(screen.getByRole('combobox', { name: 'Included type' })).toHaveTextContent('All types');
    expect(screen.getByRole('combobox', { name: 'Included app' })).toHaveTextContent('example');
    expect(screen.getByText(/Included type filter was reset/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Observed' })).toBeVisible();
});

test.each(['light', 'dark'] as const)('switching to explicit roots cannot strand an invisible app filter in %s', async (scheme) => {
    const user = userEvent.setup();
    render(frame(data, scheme));
    await choose(user, 'Included app', 'lookup_app');
    await choose(user, 'Starting set', 'Explicitly selected objects');
    expect(screen.getByRole('combobox', { name: 'Included app' })).toHaveTextContent('All apps');
    await choose(user, 'Starting object', 'Observed · Dashboard · dashboard_app');
    await user.click(screen.getByRole('button', { name: 'Add starting object' }));
    expect(screen.getByRole('heading', { name: '1 included identities' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Observed' })).toBeVisible();
});

test.each(['light', 'dark'] as const)('primary and secondary actions do not interpolate token colors in %s', (scheme) => {
    render(<SplunkThemeProvider family="enterprise" colorScheme={scheme}>
        <StyledButton $primary>Collect usage evidence</StyledButton>
        <StyledButton>Inspect</StyledButton>
    </SplunkThemeProvider>);
    screen.getAllByRole('button').forEach((button) => {
        expect(getComputedStyle(button).transition).toBe('none');
    });
    expect(within(document.body).getByRole('button', { name: 'Collect usage evidence' })).toBeEnabled();
});

test.each(['light', 'dark'] as const)('page action groups wrap before squeezing the title in %s', (scheme) => {
    render(<SplunkThemeProvider family="enterprise" colorScheme={scheme}>
        <PageHeader title="Environment Overview" subtitle="Understand what was collected and where evidence is missing."
            actions={<ButtonRow>
                <StyledButton>In-use content report</StyledButton>
                <StyledButton>Export environment summary</StyledButton>
                <StyledButton $primary>Review candidates</StyledButton>
            </ButtonRow>} />
    </SplunkThemeProvider>);
    const heading = screen.getByRole('heading', { name: 'Environment Overview' });
    expect(getComputedStyle(heading.closest('header') as HTMLElement).flexWrap).toBe('wrap');
    expect(getComputedStyle(heading.parentElement as HTMLElement).flexBasis).toBe('28rem');
    expect(getComputedStyle(screen.getByRole('button', { name: 'Review candidates' }).parentElement as HTMLElement).flexWrap).toBe('wrap');
});
