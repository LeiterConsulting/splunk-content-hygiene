import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplunkThemeProvider } from '@splunk/themes';
import { ReviewLibraryPage } from '../pages/ReviewLibraryPage';
import { CandidatesPage } from '../pages/CandidatesPage';
import { DependencyPage } from '../pages/DependencyPage';
import { ReviewNavigationProvider } from '../components/ReviewNavigationContext';
import { ReviewWorkflowContext } from '../components/ReviewWorkflowContext';
import { ExportMenu } from '../components/ExportMenu';
import { StyledButton } from '../AppStyles';
import { ownerLabel } from '../utils/objectLabels';
import { ContentObject, InventorySnapshot, ReviewRecord } from '../types';
import { navigateToView } from '../utils/navigation';

jest.mock('../utils/navigation', () => ({ ...jest.requireActual('../utils/navigation'), navigateToView: jest.fn() }));

const objects: ContentObject[] = ['Alpha', 'Beta'].map((name) => ({
    objectId: `macro::example::${name.toLowerCase()}`, name, canonicalName: name.toLowerCase(),
    objectType: 'Macro', app: 'example', owner: 'analyst', sharing: 'app', enabled: true,
    scheduled: false, updated: null, lastUsed: null, usageEvidence: null, healthStatus: 'broken',
    abandonmentConfidence: 20, removalImpact: 50, inboundReferences: 1, outboundReferences: 1,
    protected: false, evidence: [`${name} observed evidence`], suggestedAction: 'Investigate the dependency.',
}));
const snapshot: InventorySnapshot = {
    objects, edges: [{ edgeId: 'edge-a-b', sourceId: objects[0].objectId, targetId: objects[1].objectId,
        relation: 'uses_macro', confidence: 'high', resolved: true, evidence: 'Static macro call', sourceLocation: 'definition' }],
    findings: [], owners: [], usage: null,
    scan: { scanId: 'scan', scanType: 'full', status: 'succeeded', startedAt: '2026-07-28T11:00:00Z',
        completedAt: '2026-07-28T11:01:00Z', objectCount: 2, edgeCount: 1, findingCount: 0, candidateCount: 2,
        warningCount: 0, warnings: [], errors: [], collectorCounts: {}, collectorTotals: {}, analysisStatus: 'complete', dataSource: 'live' },
};
const records: ReviewRecord[] = objects.map((object) => ({
    objectId: object.objectId, objectName: object.name, canonicalName: object.canonicalName, objectType: object.objectType,
    app: object.app, owner: object.owner, healthStatusAtReview: object.healthStatus, stage: 'investigating',
    note: `${object.name} saved rationale`, assignedTo: 'team', scanId: 'scan',
    createdAt: '2026-07-28T10:00:00Z', updatedAt: '2026-07-28T11:00:00Z', updatedBy: 'reviewer',
    usageCoverageAtReview: null, usageLastObservedAtReview: null, usageObservationCountAtReview: null, usageRunIdAtReview: null,
    revisionId: `revision-${object.name}`, revisionNumber: 1,
}));
const pageProps = { snapshot, reviews: records, isLoading: false, canWriteReviews: true,
    onSaveReview: jest.fn(), onDeleteReview: jest.fn().mockResolvedValue(undefined) };

function frame(scheme: 'light' | 'dark', children: React.ReactNode) {
    return <SplunkThemeProvider family="enterprise" colorScheme={scheme}>
        <ReviewNavigationProvider>{children}</ReviewNavigationProvider>
    </SplunkThemeProvider>;
}
beforeEach(() => { window.history.replaceState(null, '', '/'); jest.clearAllMocks(); });

test.each(['light', 'dark'] as const)('Library uses an explicit full-width selection with top investigation actions in %s mode', async (scheme) => {
    const user = userEvent.setup();
    render(frame(scheme, <ReviewLibraryPage {...pageProps} loadError={null} />));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alpha' })).not.toHaveAttribute('aria-pressed');
    await user.click(screen.getByRole('button', { name: 'Alpha' }));
    const panel = screen.getByRole('complementary', { name: 'Review details for Alpha' });
    const explore = within(panel).getByRole('button', { name: 'Explore dependencies' });
    expect(screen.getByRole('tab', { name: 'Evidence & changes' })).toHaveAttribute('aria-selected', 'true');
    expect(panel.querySelector('h2')).toHaveFocus();
    await user.click(screen.getByRole('tab', { name: 'Review decision' }));
    const note = within(panel).getByRole('textbox', { name: 'Investigation note' });
    expect(explore.compareDocumentPosition(note)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(getComputedStyle(panel).position).not.toBe('sticky');
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Previous review' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next review' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Update review record' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Back to review library' }));
    expect(screen.getByRole('heading', { name: '2 review records' })).toHaveFocus();
    expect(window.location.search).not.toContain('object=');
});

test.each(['light', 'dark'] as const)('drafts survive evidence/history tabs and require explicit discard before next record in %s mode', async (scheme) => {
    const user = userEvent.setup(); const history = jest.fn().mockResolvedValue({ entries: [], nextBefore: null });
    render(frame(scheme, <ReviewWorkflowContext.Provider value={{ states: new Map(), history }}>
        <ReviewLibraryPage {...pageProps} loadError={null} />
    </ReviewWorkflowContext.Provider>));
    await user.click(screen.getByRole('button', { name: 'Alpha' }));
    await user.click(screen.getByRole('tab', { name: 'Review decision' }));
    const note = screen.getByRole('textbox', { name: 'Investigation note' });
    await user.type(note, ' - unsaved findings');
    await user.click(screen.getByRole('tab', { name: 'Evidence & changes' }));
    expect(screen.getByRole('region', { name: 'Changes since review' })).toBeVisible();
    expect(note).not.toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Revision history' }));
    expect(history).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Show saved revisions' }));
    await waitFor(() => expect(history).toHaveBeenCalledWith(objects[0].objectId, undefined));
    await user.click(screen.getByRole('tab', { name: 'Review decision' }));
    expect(screen.getByRole('textbox', { name: 'Investigation note' })).toBe(note);
    expect(note).toHaveValue('Alpha saved rationale - unsaved findings');
    await user.click(screen.getByRole('button', { name: 'Next review' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Leave unsaved review changes?');
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(note).toHaveValue('Alpha saved rationale - unsaved findings');
    await user.click(screen.getByRole('button', { name: 'Next review' }));
    await user.click(screen.getByRole('button', { name: 'Discard draft and continue' }));
    expect(screen.getByRole('heading', { name: 'Beta' })).toHaveFocus();
    await user.click(screen.getByRole('tab', { name: 'Review decision' }));
    expect(screen.getByRole('textbox', { name: 'Investigation note' })).toHaveValue('Beta saved rationale');
    expect(pageProps.onSaveReview).not.toHaveBeenCalled();
});

test('cross-view actions and browser navigation protect an unsaved review without silently saving', async () => {
    const user = userEvent.setup();
    render(frame('light', <ReviewLibraryPage {...pageProps} loadError={null} />));
    await user.click(screen.getByRole('button', { name: 'Alpha' }));
    await user.click(screen.getByRole('tab', { name: 'Review decision' }));
    await user.type(screen.getByRole('textbox', { name: 'Investigation note' }), ' draft');
    const unload = new Event('beforeunload', { cancelable: true });
    fireEvent(window, unload);
    expect(unload.defaultPrevented).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Explore dependencies' }));
    expect(navigateToView).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await user.click(screen.getByRole('button', { name: 'Explore dependencies' }));
    await user.click(screen.getByRole('button', { name: 'Discard draft and continue' }));
    expect(navigateToView).toHaveBeenCalledWith('dependencies', { object: objects[0].objectId, scan: snapshot.scan.scanId });
    expect(pageProps.onSaveReview).not.toHaveBeenCalled();
});

test('Library back navigation retains search and selected results instead of opening an unrelated fallback record', async () => {
    const user = userEvent.setup();
    render(frame('light', <ReviewLibraryPage {...pageProps} loadError={null} />));
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'Beta');
    await user.click(screen.getByRole('button', { name: 'Beta' }));
    await user.click(screen.getByRole('button', { name: 'Back to review library' }));
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveValue('Beta');
    expect(screen.queryByRole('button', { name: 'Alpha' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
});

test('archiving is an explicit recoverable app-local action, never a customer-object deletion', async () => {
    const user = userEvent.setup();
    render(frame('dark', <ReviewLibraryPage {...pageProps} loadError={null} />));
    await user.click(screen.getByRole('button', { name: 'Alpha' }));
    await user.click(screen.getByRole('tab', { name: 'Review decision' }));
    await user.click(screen.getByRole('button', { name: 'Archive library record' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('No Splunk knowledge object will be changed');
    expect(pageProps.onDeleteReview).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Keep active' }));
    await user.click(screen.getByRole('button', { name: 'Archive library record' }));
    await user.click(screen.getByRole('button', { name: 'Archive record' }));
    await waitFor(() => expect(pageProps.onDeleteReview).toHaveBeenCalledWith(objects[0].objectId, records[0].revisionId));
});

test('candidate deep links show the exact inventory object even when it is not a cleanup candidate', () => {
    window.history.replaceState(null, '', `/?object=${encodeURIComponent(objects[0].objectId)}`);
    render(frame('light', <CandidatesPage {...pageProps} snapshot={{ ...snapshot, objects: [{ ...objects[0], healthStatus: 'protected' }] }} />));
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByText('Inventory object · outside current candidate filters')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Explore dependencies' })).toBeEnabled();
});

test('Explorer separates inspection from graph centering and protects review drafts during drill-through', async () => {
    window.history.replaceState(null, '', `/?object=${encodeURIComponent(objects[0].objectId)}`);
    const user = userEvent.setup();
    render(frame('dark', <DependencyPage {...pageProps} />));
    await user.click(screen.getByRole('button', { name: 'Inspect Beta' }));
    expect(screen.getByRole('complementary', { name: 'Details for Beta' }).querySelector('h2')).toHaveFocus();
    expect(screen.getByText('Selected for inspection · graph center remains Alpha')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Review selected object' }));
    await user.type(screen.getByRole('textbox', { name: 'Investigation note' }), ' draft');
    await user.click(screen.getByRole('tab', { name: /^Relationships/ }));
    await user.click(screen.getByRole('button', { name: 'Drill in' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('combobox', { name: 'Selected object' })).toHaveTextContent('Alpha');
    await user.click(screen.getByRole('tab', { name: 'Review decision' }));
    expect(screen.getByRole('textbox', { name: 'Investigation note' })).toHaveValue('Beta saved rationale draft');
});

test('scoped export menus expose explicit formats and invoke only the chosen export', async () => {
    const user = userEvent.setup(); const csv = jest.fn(); const json = jest.fn();
    render(frame('light', <ExportMenu label="Export selected review" items={[{ label: 'Selected CSV', onClick: csv }, { label: 'Selected JSON', onClick: json }]} />));
    await user.click(screen.getByRole('button', { name: 'Export selected review' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Selected CSV' }));
    expect(csv).toHaveBeenCalledTimes(1); expect(json).not.toHaveBeenCalled();
});

test.each(['light', 'dark'] as const)('primary actions retain native visual hierarchy through styling adapters in %s mode', (scheme) => {
    render(frame(scheme, <><StyledButton $primary>Primary action</StyledButton><StyledButton>Secondary action</StyledButton></>));
    const primary = getComputedStyle(screen.getByRole('button', { name: 'Primary action' }));
    const secondary = getComputedStyle(screen.getByRole('button', { name: 'Secondary action' }));
    expect(primary.backgroundColor).not.toBe(secondary.backgroundColor);
});

test('ownership labels distinguish a shared scope from a missing user owner', () => {
    expect(ownerLabel({ owner: null, sharing: 'app' })).toBe('app scope');
    expect(ownerLabel({ owner: null, sharing: 'global' })).toBe('global scope');
    expect(ownerLabel({ owner: null, sharing: 'user' })).toBe('Ownership gap');
    expect(ownerLabel({ owner: null, sharing: null })).toBe('Owner metadata unavailable');
});

test.each(['light', 'dark'] as const)('a retained review outside inventory never presents its historical health or owner as current in %s mode', async (scheme) => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', `/?object=${encodeURIComponent(objects[0].objectId)}`);
    render(frame(scheme, <ReviewLibraryPage {...pageProps} snapshot={{ ...snapshot, objects: [] }} loadError={null} />));
    expect(screen.getByText(/Its saved decision and historical health are retained/)).toBeVisible();
    expect(screen.getByText('Health at review:')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Review decision' }));
    expect(screen.getByRole('textbox', { name: 'Investigation note' })).toHaveValue(records[0].note);
    expect(screen.getByRole('button', { name: 'Explore dependencies' })).toBeDisabled();
    await user.click(screen.getByRole('tab', { name: 'Object & usage details' }));
    expect(screen.getByText('Unavailable in current inventory')).toBeVisible();
});

test('explicit discard resets the form even when a view action leaves the same object mounted', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', `/?object=${encodeURIComponent(objects[0].objectId)}`);
    render(frame('light', <DependencyPage {...pageProps} />));
    await user.click(screen.getByRole('tab', { name: 'Review decision' }));
    const note = screen.getByRole('textbox', { name: 'Investigation note' });
    await user.type(note, ' - unsaved');
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await user.click(screen.getByRole('button', { name: 'Discard draft and continue' }));
    expect(screen.getByRole('textbox', { name: 'Investigation note' })).toBe(note);
    expect(note).toHaveValue(records[0].note);
    expect(screen.getByRole('button', { name: 'Update review record' })).toBeDisabled();
    expect(pageProps.onSaveReview).not.toHaveBeenCalled();
});
