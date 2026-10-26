// Synthetic React contracts. Native browser/theme qualification is a separate gate.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplunkThemeProvider } from '@splunk/themes';
import { FieldLineagePanel } from '../components/FieldLineagePanel';
import { ReviewNavigationProvider } from '../components/ReviewNavigationContext';
import { DependencyPage } from '../pages/DependencyPage';
import { InUseContentPage } from '../pages/InUseContentPage';
import { ReviewLibraryPage } from '../pages/ReviewLibraryPage';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { fieldInvestigationFixture } from './fieldFixtures';
import { now } from './milestoneFixtures';

jest.mock('../utils/downloadCsv', () => ({ downloadCsv: jest.fn() }));
jest.mock('../utils/downloadJson', () => ({ downloadJson: jest.fn() }));
const actions = { canWriteReviews: true, onSaveReview: jest.fn(), onDeleteReview: jest.fn() };
const frame = (children: React.ReactNode, scheme: 'light' | 'dark') => <SplunkThemeProvider family="enterprise" colorScheme={scheme}>
    <ReviewNavigationProvider>{children}</ReviewNavigationProvider>
</SplunkThemeProvider>;
beforeEach(() => { window.history.replaceState(null, '', '/'); jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => jest.restoreAllMocks());

test.each(['light', 'dark'] as const)('Explorer details and CSV/JSON retain declared field facts and phase-qualified provenance in %s', async scheme => {
    const { data, saved, alias, extraction } = await fieldInvestigationFixture(); const bytes = JSON.stringify(saved); const user = userEvent.setup();
    window.history.replaceState(null, '', `/?object=${encodeURIComponent(alias.objectId)}&tab=object`);
    render(frame(<DependencyPage {...actions} reviews={[saved]} snapshot={data} isLoading={false} />, scheme));
    const facts = screen.getByRole('region', { name: 'Declared field lineage' });
    expect(within(facts).getByText('Alias (after extraction)')).toBeVisible();
    expect(within(facts).getByText(/actor ASNEW principal/)).toBeVisible();
    expect(within(facts).getByText('Not exposed by native metadata')).toBeVisible();
    expect(within(facts).getByText(/No alias-to-alias or calculated-to-calculated chain/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Export investigation' }));
    await user.click(screen.getByRole('menuitem', { name: 'Filtered relationships CSV' }));
    const [, columns, rows] = jest.mocked(downloadCsv).mock.calls[0];
    const row = rows.find(value => value[columns.indexOf('Related object ID')] === extraction.objectId)!;
    expect(row[columns.indexOf('Potential implicit relationship')]).toBe(true);
    expect(JSON.parse(String(row[columns.indexOf('Field relationship provenance')]))).toMatchObject({ fields: ['actor'], consumerPhase: 'alias', producerPhase: 'extraction' });
    expect(JSON.parse(String(row[columns.indexOf('Center declared field facts')]))).toMatchObject({ operation: 'alias', inputs: ['actor'] });
    await user.click(screen.getByRole('button', { name: 'Export investigation' }));
    await user.click(screen.getByRole('menuitem', { name: 'Filtered relationships JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-dependencies.json', expect.objectContaining({ centerObject: expect.objectContaining({ fieldLineage: alias.fieldLineage }),
        relationships: expect.arrayContaining([expect.objectContaining({ edge: expect.objectContaining({ fieldProvenance: expect.objectContaining({ fields: ['actor'] }) }) })]) }));
    expect(actions.onSaveReview).not.toHaveBeenCalled(); expect(JSON.stringify(saved)).toBe(bytes);
});

test.each(['light', 'dark'] as const)('required-content CSV/JSON carry field facts and ordered REPORT witness in %s', async scheme => {
    const { data, calculated, transform } = await fieldInvestigationFixture(); const user = userEvent.setup();
    window.history.replaceState(null, '', `/?object=${encodeURIComponent(calculated.objectId)}`);
    render(frame(<InUseContentPage snapshot={data} isLoading={false} reviews={[]} reviewsVerified />, scheme));
    await user.click(screen.getByRole('button', { name: 'Export required-content report' }));
    await user.click(screen.getByRole('menuitem', { name: 'All included objects CSV (partial scope)' }));
    const [, columns, rows] = jest.mocked(downloadCsv).mock.calls[0];
    const row = rows.find(value => value[columns.indexOf('Object ID')] === transform.objectId)!;
    expect(row[columns.indexOf('Witness contains potential implicit dependency')]).toBe(true);
    expect(row[columns.indexOf('Witness path confidence')]).toBe('medium');
    expect(JSON.parse(String(row[columns.indexOf('Field witness provenance')]))).toMatchObject({ transformPositions: [1, 2] });
    expect(JSON.parse(String(row[columns.indexOf('Declared field facts')]))).toMatchObject({ outputs: ['actor'] });
    await user.click(screen.getByRole('button', { name: 'Export required-content report' }));
    await user.click(screen.getByRole('menuitem', { name: 'Full footprint and coverage JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-required-content.json', expect.objectContaining({ relationships: expect.arrayContaining([
        expect.objectContaining({ relation: 'may_use_field_transform', fieldProvenance: expect.objectContaining({ transformPositions: [1, 2] }) }),
    ]) }));
});

test.each(['light', 'dark'] as const)('Library exposes current field facts and retains the v2 baseline decision in %s', async scheme => {
    const { data, calculated, saved } = await fieldInvestigationFixture(); const user = userEvent.setup(); const bytes = JSON.stringify(saved);
    render(frame(<ReviewLibraryPage {...actions} snapshot={data} isLoading={false} loadError={null} reviews={[saved]} />, scheme));
    await user.click(screen.getByRole('button', { name: 'Export filtered reviews' }));
    await user.click(screen.getByRole('menuitem', { name: 'Review library CSV' }));
    const [, columns, rows] = jest.mocked(downloadCsv).mock.calls[0];
    expect(rows[0][columns.indexOf('Coverage policy')]).toBe('shared-static-v3');
    expect(rows[0][columns.indexOf('Stage')]).toBe('retain');
    expect(rows[0][columns.indexOf('Review evidence status')]).toBe('needs_review');
    expect(JSON.parse(String(rows[0][columns.indexOf('Current declared field facts')]))).toEqual(calculated.fieldLineage);
    await user.click(screen.getByRole('button', { name: calculated.name }));
    await user.click(screen.getByRole('tab', { name: 'Object & usage details' }));
    expect(screen.getByRole('region', { name: 'Declared field lineage' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Export this review' }));
    await user.click(screen.getByRole('menuitem', { name: 'Selected review JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-review.json', expect.objectContaining({ currentObject: expect.objectContaining({ fieldLineage: calculated.fieldLineage }),
        review: expect.objectContaining({ stage: 'retain', evidenceBaseline: expect.objectContaining({ evidence: expect.objectContaining({ coverage: expect.objectContaining({ policy: 'shared-static-v2' }) }) }) }) }));
    expect(actions.onSaveReview).not.toHaveBeenCalled(); expect(JSON.stringify(saved)).toBe(bytes);
});

test.each(['light', 'dark'] as const)('long declared field lists use accessible Splunk disclosure in %s', async scheme => {
    const { calculated } = await fieldInvestigationFixture(); const user = userEvent.setup();
    const fields = Array.from({ length: 13 }, (_value, index) => `declared.field.${index}`);
    render(frame(<FieldLineagePanel object={{ ...calculated, fieldLineage: { ...calculated.fieldLineage!, inputs: fields } }} />, scheme));
    await user.click(screen.getByRole('button', { name: 'All input names (13)' }));
    expect(screen.getByText('declared.field.12')).toBeVisible();
    expect(screen.getByRole('button', { name: 'All input names (13)' })).toHaveAttribute('aria-expanded', 'true');
});
