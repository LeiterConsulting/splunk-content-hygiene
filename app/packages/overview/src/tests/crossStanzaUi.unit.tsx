// Synthetic UI/export contracts. Native runtime qualification is separate.
import React from 'react';
import { createPortal } from 'react-dom';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getTheme, SplunkThemeProvider } from '@splunk/themes';
import { CrossStanzaPropsPanel } from '../components/CrossStanzaPropsPanel';
import { FieldLineagePanel, FieldProvenanceDetails } from '../components/FieldLineagePanel';
import { ReviewNavigationProvider } from '../components/ReviewNavigationContext';
import { DependencyPage } from '../pages/DependencyPage';
import { ReviewLibraryPage } from '../pages/ReviewLibraryPage';
import { InUseContentPage } from '../pages/InUseContentPage';
import { CrossStanzaPropsEvidence } from '../types';
import { fieldInvestigationFixture } from './fieldFixtures';
import { now } from './milestoneFixtures';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';

jest.mock('../utils/downloadCsv', () => ({ downloadCsv: jest.fn() }));
jest.mock('../utils/downloadJson', () => ({ downloadJson: jest.fn() }));
const actions = { canWriteReviews: true, onSaveReview: jest.fn(), onDeleteReview: jest.fn() };
const frame = (scheme: 'light' | 'dark', child: React.ReactElement) => <SplunkThemeProvider family="enterprise" colorScheme={scheme}><ReviewNavigationProvider>{child}</ReviewNavigationProvider></SplunkThemeProvider>;
beforeEach(() => { window.history.replaceState(null, '', '/'); jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => jest.restoreAllMocks());
const row: CrossStanzaPropsEvidence = { version: 1, objectId: 'props-source', callerObjectId: 'declared-caller', app: 'example', attribute: 'FIELDALIAS-owner',
    sourceLocation: 'search', selectors: [{ field: 'host', value: 'server', sourceLocation: 'search:0' }, { field: 'sourcetype', value: 'events', sourceLocation: 'search:12' }],
    status: 'lower', reason: 'category', selectedObjectId: 'higher-binding', competingObjectIds: ['props-source', 'higher-binding'], stanzaPriority: 100, selectedPriority: 100 };
test.each(['light', 'dark'] as const)('all props drill-through links use themed underlined anchors even in a portal in %s', async scheme => {
    const user = userEvent.setup(); render(frame(scheme, createPortal(<CrossStanzaPropsPanel rows={[row]} />, document.body)));
    await user.click(screen.getByRole('button', { name: 'Inspect cross-stanza order (1)' }));
    await user.click(screen.getByRole('button', { name: 'Captured comparison members (2)' }));
    const expected = document.createElement('span'); expected.style.color = getTheme({ family: 'enterprise', colorScheme: scheme }).contentColorLink;
    const links = screen.getAllByRole('link'); expect(links).toHaveLength(4);
    links.forEach(link => {
        expect(link.tagName).toBe('A'); expect(link).toHaveAttribute('data-test', 'link');
        expect(getComputedStyle(link).color).toBe(expected.style.color);
        expect(getComputedStyle(link).textDecoration).toContain('underline');
    });
});
test.each(['light', 'dark'] as const)('conditional order is keyboard accessible, searchable, filtered and paginated in %s', async scheme => {
    const rows = Array.from({ length: 9 }, (_, index) => ({ ...row, callerObjectId: `caller-${index}`, sourceLocation: `query-${index}` }));
    rows[2] = { ...rows[2], status: 'unverified', reason: 'binding_unverified', selectedObjectId: null, selectedPriority: null };
    const user = userEvent.setup(); render(frame(scheme, <CrossStanzaPropsPanel rows={rows} truncated />));
    const toggle = screen.getByRole('button', { name: 'Inspect cross-stanza order (9)' }); toggle.focus(); await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true'); expect(screen.getByText(/not full effective props or proof an event matches/)).toBeVisible();
    const list = screen.getByRole('list', { name: 'Cross-stanza order observations' }); expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'caller-0' })).toHaveAttribute('href', expect.stringContaining('object=caller-0'));
    expect(screen.getAllByRole('link', { name: 'higher-binding' })[0]).toHaveAttribute('href', expect.stringContaining('object=higher-binding'));
    await user.click(screen.getByRole('button', { name: 'Next cross-stanza contexts' })); expect(screen.getByText('5–8 of 9 matching cross-stanza contexts')).toBeVisible();
    await user.type(screen.getByRole('textbox', { name: 'Find cross-stanza context' }), 'caller-8'); expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Previous cross-stanza contexts' })).toBeDisabled();
    await user.clear(screen.getByRole('textbox', { name: 'Find cross-stanza context' }));
    await user.click(screen.getByRole('combobox', { name: 'Cross-stanza status' })); await user.click(screen.getByRole('option', { name: 'Unverified' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(1); expect(screen.getByText(/No highest binding is inferred/)).toBeVisible();
});
test.each(['light', 'dark'] as const)('legacy snapshots and empty recorded comparisons keep uncertainty explicit in %s', async scheme => {
    const user = userEvent.setup(); const { rerender } = render(frame(scheme, <CrossStanzaPropsPanel />));
    expect(screen.getByText(/Not recorded by this snapshot/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Inspect cross-stanza order (0)' }));
    expect(screen.getByText(/No recorded comparison does not establish absence/)).toBeVisible();
    rerender(frame(scheme, <CrossStanzaPropsPanel rows={[]} />)); expect(screen.getByText('0 conditional order observation(s) · 0 unverified')).toBeVisible();
});
async function evidenceFixture() {
    const fixture = await fieldInvestigationFixture();
    const facts = { ...fixture.calculated.fieldLineage!, crossStanzaProps: [{ ...row, objectId: fixture.calculated.objectId,
        competingObjectIds: [fixture.calculated.objectId, 'higher-binding'] }] };
    fixture.calculated.fieldLineage = facts;
    const edge = fixture.data.edges.find(item => item.sourceId === fixture.calculated.objectId)!;
    edge.fieldProvenance = { ...edge.fieldProvenance!, crossStanzaProps: facts.crossStanzaProps };
    const baseline = JSON.parse(JSON.stringify(fixture.saved.evidenceBaseline)); baseline.evidence.coverage.policy = 'shared-static-v6'; fixture.saved.evidenceBaseline = baseline;
    return { ...fixture, edge };
}
test.each(['light', 'dark'] as const)('object and relationship use identical compact cross-stanza evidence in %s', async scheme => {
    const { calculated, edge } = await evidenceFixture(); const user = userEvent.setup();
    const { rerender } = render(frame(scheme, <FieldLineagePanel object={calculated} />));
    const region = screen.getByRole('region', { name: 'Cross-stanza props order' });
    await user.click(within(region).getByRole('button', { name: 'Inspect cross-stanza order (1)' }));
    expect(within(region).getByText('Lower captured precedence (possible fallback)')).toBeVisible();
    rerender(frame(scheme, <FieldProvenanceDetails provenance={{ ...edge.fieldProvenance!, kind: 'event_scope' }} />));
    expect(screen.getByRole('region', { name: 'Cross-stanza props order' })).toBeVisible();
});
test.each(['light', 'dark'] as const)('Explorer and required-content export exactly the captured cross-stanza facts in %s', async scheme => {
    const { calculated, data, edge } = await evidenceFixture(); const user = userEvent.setup();
    window.history.replaceState(null, '', `/?object=${encodeURIComponent(calculated.objectId)}&tab=object`);
    const { unmount } = render(frame(scheme, <DependencyPage {...actions} reviews={[]} snapshot={data} isLoading={false} />));
    await user.click(screen.getByRole('button', { name: 'Export investigation' })); await user.click(screen.getByRole('menuitem', { name: 'Filtered relationships CSV' }));
    const [, columns, values] = jest.mocked(downloadCsv).mock.calls[0];
    expect(values.some(cells => JSON.parse(String(cells[columns.indexOf('Field relationship provenance')]) || '{}').crossStanzaProps?.length === 1)).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Export investigation' })); await user.click(screen.getByRole('menuitem', { name: 'Filtered relationships JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-dependencies.json', expect.objectContaining({ centerObject: expect.objectContaining({ fieldLineage: calculated.fieldLineage }) }));
    unmount(); jest.clearAllMocks(); window.history.replaceState(null, '', `/?object=${encodeURIComponent(calculated.objectId)}`);
    render(frame(scheme, <InUseContentPage snapshot={data} isLoading={false} reviews={[]} reviewsVerified />));
    await user.click(screen.getByRole('button', { name: 'Export required-content report' })); await user.click(screen.getByRole('menuitem', { name: 'Full footprint and coverage JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-required-content.json', expect.objectContaining({ relationships: expect.arrayContaining([
        expect.objectContaining({ edgeId: edge.edgeId, fieldProvenance: edge.fieldProvenance }),
    ]) })); expect(actions.onSaveReview).not.toHaveBeenCalled();
});
test.each(['light', 'dark'] as const)('Library preserves a v6 decision and exports current conditional context in %s', async scheme => {
    const { calculated, data, saved } = await evidenceFixture(); const user = userEvent.setup(); const original = JSON.stringify(saved);
    render(frame(scheme, <ReviewLibraryPage {...actions} snapshot={data} isLoading={false} loadError={null} reviews={[saved]} />));
    await user.click(screen.getByRole('button', { name: calculated.name })); await user.click(screen.getByRole('tab', { name: 'Object & usage details' }));
    const region = screen.getByRole('region', { name: 'Cross-stanza props order' }); await user.click(within(region).getByRole('button', { name: 'Inspect cross-stanza order (1)' }));
    expect(within(region).getByRole('link', { name: 'higher-binding' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Export this review' })); await user.click(screen.getByRole('menuitem', { name: 'Selected review JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-review.json', expect.objectContaining({ currentObject: expect.objectContaining({ fieldLineage: calculated.fieldLineage }),
        review: expect.objectContaining({ evidenceBaseline: expect.objectContaining({ evidence: expect.objectContaining({ coverage: expect.objectContaining({ policy: 'shared-static-v6' }) }) }) }) }));
    expect(actions.onSaveReview).not.toHaveBeenCalled(); expect(JSON.stringify(saved)).toBe(original);
});
