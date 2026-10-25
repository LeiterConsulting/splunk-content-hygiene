import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplunkThemeProvider } from '@splunk/themes';
import { DependencyPage } from '../pages/DependencyPage';
import { CandidatesPage } from '../pages/CandidatesPage';
import { ReviewNavigationProvider } from '../components/ReviewNavigationContext';
import { ContentObject, InventorySnapshot } from '../types';
import { navigateToView } from '../utils/navigation';

jest.mock('../utils/navigation', () => ({ ...jest.requireActual('../utils/navigation'), navigateToView: jest.fn() }));

const report: ContentObject = {
    objectId: 'saved_search::example::Weekly / SLA + 95% & café',
    canonicalName: 'Weekly / SLA + 95% & café', name: 'Weekly SLA', objectType: 'Report',
    app: 'example', owner: 'analyst', sharing: 'app', enabled: true, scheduled: true,
    updated: null, lastUsed: null, usageEvidence: null, healthStatus: 'dormant',
    abandonmentConfidence: 20, removalImpact: 30, inboundReferences: 0, outboundReferences: 0,
    protected: false, evidence: [], suggestedAction: 'Investigate',
};
const other: ContentObject = { ...report, objectId: 'macro::another::other', canonicalName: 'other',
    name: 'Unrelated macro', objectType: 'Macro', app: 'another', healthStatus: 'broken' };
const snapshot: InventorySnapshot = {
    objects: [report, other], findings: [], owners: [], usage: null,
    edges: [{ edgeId: 'edge-other', sourceId: other.objectId, targetId: other.objectId,
        relation: 'invokes', confidence: 'high', resolved: true, evidence: 'Self-reference', sourceLocation: null }],
    scan: { scanId: 'scan-new', scanType: 'full', status: 'succeeded', startedAt: '2026-10-25T12:00:00Z',
        completedAt: '2026-10-25T12:01:00Z', objectCount: 2, edgeCount: 1, findingCount: 0,
        candidateCount: 1, warningCount: 0, warnings: [], errors: [], collectorCounts: {},
        collectorTotals: {}, analysisStatus: 'complete', dataSource: 'live' },
};
const actions = { reviews: [], canWriteReviews: true, onSaveReview: jest.fn(), onDeleteReview: jest.fn() };
function view(data: InventorySnapshot | null, isLoading = false, scheme: 'light' | 'dark' = 'light') {
    return <SplunkThemeProvider family="enterprise" colorScheme={scheme}>
        <ReviewNavigationProvider><DependencyPage {...actions} snapshot={data} isLoading={isLoading} /></ReviewNavigationProvider>
    </SplunkThemeProvider>;
}
function open(object: string, params: Record<string, string> = {}) {
    window.history.replaceState(null, '', `/DependencyExplorer?${new URLSearchParams({ object, ...params })}#workspace`);
}
function center() { return screen.getByText('Dependency graph center').parentElement!; }
beforeEach(() => { window.history.replaceState(null, '', '/'); jest.clearAllMocks(); });

test.each(['light', 'dark'] as const)('an unavailable requested object never substitutes another center or export target in %s mode', (scheme) => {
    const requested = 'saved_search::example::not-in-this-scan'; open(requested);
    render(view(snapshot, false, scheme));
    expect(screen.getByText('Requested object is unavailable')).toBeVisible();
    expect(screen.queryByText('Dependency graph center')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export investigation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review center object' })).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('object')).toBe(requested);
    expect(window.location.hash).toBe('#workspace');
});

test('loading, empty inventory, and a later verified snapshot preserve the exact requested identity', () => {
    open(report.objectId, { scan: 'scan-old', context: 'keep' });
    const { rerender } = render(view(null, true));
    expect(new URLSearchParams(window.location.search).get('object')).toBe(report.objectId);
    expect(screen.queryByText('Requested object is unavailable')).not.toBeInTheDocument();
    rerender(view({ ...snapshot, objects: [], edges: [] }));
    expect(screen.getByText('Requested object is unavailable')).toBeVisible();
    rerender(view(snapshot));
    expect(within(center()).getByRole('heading', { name: report.name })).toBeVisible();
    expect(screen.getByText('Inventory changed since this link was opened')).toBeVisible();
    expect(new URLSearchParams(window.location.search).get('scan')).toBe('scan-old');
    expect(new URLSearchParams(window.location.search).get('context')).toBe('keep');
});

test('an excluded requested object remains selected in the URL until the user broadens the center scope', async () => {
    open(report.objectId, { group: 'broken' }); const user = userEvent.setup();
    render(view(snapshot));
    expect(screen.getByText('Requested object is outside the center group')).toBeVisible();
    expect(screen.queryByText('Dependency graph center')).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('object')).toBe(report.objectId);
    await user.click(screen.getByRole('button', { name: 'Show requested object' }));
    expect(within(center()).getByRole('heading', { name: report.name })).toBeVisible();
});

test('changing the center group does not silently retarget the requested object', async () => {
    open(report.objectId); const user = userEvent.setup(); render(view(snapshot));
    await user.click(screen.getByRole('combobox', { name: 'Center group' }));
    await user.click(screen.getByRole('option', { name: 'Candidate group: broken' }));
    expect(screen.getByText('Requested object is outside the center group')).toBeVisible();
    expect(new URLSearchParams(window.location.search).get('object')).toBe(report.objectId);
});

test.each(['Report', 'Alert', 'Saved Search'])('%s deep links keep their saved-search identity, including beyond the picker limit and without edges', (type) => {
    const requested = { ...report, objectType: type };
    const many = Array.from({ length: 225 }, (_, i) => ({ ...other,
        objectId: `macro::example::a${i}`, name: `A ${i}` }));
    open(requested.objectId);
    render(view({ ...snapshot, objects: [...many, requested], edges: [] }));
    expect(within(center()).getByRole('heading', { name: requested.name })).toBeVisible();
    expect(new URLSearchParams(window.location.search).get('object')).toBe(requested.objectId);
    expect(window.location.search).not.toContain('+');
});

test('a new scan cannot silently replace a requested object that disappeared', () => {
    open(report.objectId, { scan: snapshot.scan.scanId });
    const { rerender } = render(view(snapshot));
    rerender(view({ ...snapshot, objects: [other], scan: { ...snapshot.scan, scanId: 'scan-replacement' } }));
    expect(screen.getByText('Requested object is unavailable')).toBeVisible();
    expect(screen.queryByText('Dependency graph center')).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('object')).toBe(report.objectId);
});

test('history navigation updates the requested center instead of restoring a stale center into the URL', () => {
    open(report.objectId); render(view(snapshot));
    open(other.objectId); fireEvent.popState(window);
    expect(within(center()).getByRole('heading', { name: other.name })).toBeVisible();
    open(report.objectId); fireEvent.popState(window);
    expect(within(center()).getByRole('heading', { name: report.name })).toBeVisible();
});

test('default centering is allowed only without an explicit requested object', () => {
    render(view(snapshot));
    expect(within(center()).getByRole('heading', { name: other.name })).toBeVisible();
    expect(new URLSearchParams(window.location.search).has('object')).toBe(false);
});

test.each(['Report', 'Alert', 'Saved Search'])('candidate-to-Explorer %s handoff retains the exact object and originating scan', async (type) => {
    const target = { ...report, objectType: type };
    const data: InventorySnapshot = { ...snapshot, objects: [target, { ...target, app: 'another',
        objectId: target.objectId.replace('::example::', '::another::') }], edges: [], findings: [{
        findingId: 'finding', objectId: target.objectId, findingType: 'cleanup_candidate',
        abandonmentConfidence: 20, removalImpact: 30, reasons: ['Investigate'], suggestedAction: 'Inspect', createdAt: null,
    }] };
    const user = userEvent.setup();
    const candidate = render(<SplunkThemeProvider family="enterprise" colorScheme="light">
        <ReviewNavigationProvider><CandidatesPage {...actions} snapshot={data} isLoading={false} /></ReviewNavigationProvider>
    </SplunkThemeProvider>);
    const rowButton = screen.getAllByRole('button', { name: target.name }).find((button) =>
        within(button.closest('tr')!).queryByText('example', { exact: true }));
    expect(rowButton).toBeDefined();
    await user.click(rowButton!);
    await user.click(screen.getByRole('button', { name: 'Explore dependencies' }));
    expect(window.location.search).not.toContain('+');
    expect(navigateToView).toHaveBeenCalledWith('dependencies', { object: target.objectId, scan: data.scan.scanId });
    candidate.unmount();
    const [, params] = jest.mocked(navigateToView).mock.calls[0];
    open(String(params!.object), { scan: String(params!.scan) }); render(view(data));
    expect(within(center()).getByRole('heading', { name: target.name })).toBeVisible();
    expect(within(center()).getByText(`${type} · example · 0 inbound · 0 outbound`)).toBeVisible();
});

test('Back keeps a dirty decision and URL together until discard is confirmed', async () => {
    const user = userEvent.setup(); open(report.objectId); render(view(snapshot));
    await user.click(screen.getByRole('button', { name: 'Review center object' }));
    await user.type(screen.getByRole('textbox', { name: 'Investigation note' }), 'Unsaved evidence');
    open(other.objectId); fireEvent.popState(window);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
    expect(new URLSearchParams(window.location.search).get('object')).toBe(report.objectId);
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('textbox', { name: 'Investigation note' })).toHaveValue('Unsaved evidence');
    open(other.objectId); fireEvent.popState(window);
    await user.click(screen.getByRole('button', { name: 'Discard draft and continue' }));
    expect(within(center()).getByRole('heading', { name: other.name })).toBeVisible();
    expect(actions.onSaveReview).not.toHaveBeenCalled();
});
