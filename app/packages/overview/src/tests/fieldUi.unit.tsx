// Synthetic React contracts. Native browser/theme qualification is a separate gate.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplunkThemeProvider } from '@splunk/themes';
import { FieldLineagePanel, FieldProvenanceDetails } from '../components/FieldLineagePanel';
import { ScanStatusBanner } from '../components/ScanStatusBanner';
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
    expect(JSON.parse(String(row[columns.indexOf('Field relationship provenance')]))).toMatchObject({ fields: ['actor'], consumerPhase: 'alias', producerPhase: 'extraction',
        outputDeclarations: [{ field: 'actor', capture: 1, attribute: 'FORMAT', method: 'transform_format' }] });
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
    expect(JSON.parse(String(row[columns.indexOf('Declared field facts')]))).toHaveProperty('outputProvenance.method', 'transform_format');
    await user.click(screen.getByRole('button', { name: 'Export required-content report' }));
    await user.click(screen.getByRole('menuitem', { name: 'Full footprint and coverage JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-required-content.json', expect.objectContaining({ relationships: expect.arrayContaining([
        expect.objectContaining({ relation: 'may_use_field_transform', fieldProvenance: expect.objectContaining({ transformPositions: [1, 2] }) }),
    ]) }));
});

test.each(['light', 'dark'] as const)('older snapshots explicitly request new extraction attribution in %s', async scheme => {
    const { data } = await fieldInvestigationFixture();
    const { rerender } = render(frame(<ScanStatusBanner scan={{ ...data.scan, collectorVersions: { field_lineage: '1.0.0' } }} isLoading={false} loadError={null} />, scheme));
    expect(screen.getByText(/This snapshot lacks current extraction-output attribution/)).toBeVisible();
    rerender(frame(<ScanStatusBanner scan={{ ...data.scan, collectorVersions: { field_lineage: '1.1.0' } }} isLoading={false} loadError={null} />, scheme));
    expect(screen.queryByText(/This snapshot lacks current extraction-output attribution/)).not.toBeInTheDocument();
});

test.each(['light', 'dark'] as const)('matched capture attribution has persistent accessible detail in %s', async scheme => {
    const { data, alias } = await fieldInvestigationFixture('named_transform');
    const proof = data.edges.find(row => row.sourceId === alias.objectId)!.fieldProvenance!;
    render(frame(<FieldProvenanceDetails provenance={proof} />, scheme));
    const user = userEvent.setup();
    const toggle = screen.getByRole('button', { name: 'Matched output declarations (1)' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Transform named captures · capture 1 · REGEX offset 0/)).toBeVisible();
    expect(within(screen.getByRole('list', { name: 'Matched output declaration locations' })).getByText(proof.outputDeclarations![0].objectId)).toBeVisible();
    expect(screen.queryByText(/synthetic-pattern/)).not.toBeInTheDocument();
});

describe.each(['inline', 'named_transform'] as const)('%s output attribution', mode => {
    test.each(['light', 'dark'] as const)('Library shows declaration locations without changing the v3 review in %s', async scheme => {
        const { data, extraction, transform, saved } = await fieldInvestigationFixture(mode);
        const selected = mode === 'inline' ? extraction : transform;
        const baseline = JSON.parse(JSON.stringify(selected.reviewEvidence)); baseline.coverage.policy = 'shared-static-v3';
        const retained = { ...saved, objectId: selected.objectId, objectName: selected.name, objectType: selected.objectType, canonicalName: selected.canonicalName,
            evidenceBaseline: { ...saved.evidenceBaseline!, evidence: baseline } };
        const bytes = JSON.stringify(retained); const user = userEvent.setup();
        render(frame(<ReviewLibraryPage {...actions} snapshot={data} isLoading={false} loadError={null} reviews={[retained]} />, scheme));
        await user.click(screen.getByRole('button', { name: selected.name }));
        await user.click(screen.getByRole('tab', { name: 'Object & usage details' }));
        const facts = screen.getByRole('region', { name: 'Declared field lineage' });
        const toggle = within(facts).getByRole('button', { name: 'Output declaration locations (1)' });
        await user.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(within(facts).getByText(new RegExp(`capture 1 · ${mode === 'inline' ? 'value' : 'REGEX'} offset 0`))).toBeVisible();
        await user.click(screen.getByRole('button', { name: 'Export this review' }));
        await user.click(screen.getByRole('menuitem', { name: 'Selected review JSON' }));
        expect(downloadJson).toHaveBeenCalledWith('content-hygiene-review.json', expect.objectContaining({
            currentObject: expect.objectContaining({ fieldLineage: expect.objectContaining({ outputProvenance: selected.fieldLineage!.outputProvenance }) }),
            review: expect.objectContaining({ stage: 'retain', evidenceBaseline: expect.objectContaining({ evidence: expect.objectContaining({ coverage: expect.objectContaining({ policy: 'shared-static-v3' }) }) }) }) }));
        expect(actions.onSaveReview).not.toHaveBeenCalled(); expect(JSON.stringify(retained)).toBe(bytes);
        expect(screen.queryByText(/synthetic-pattern/)).not.toBeInTheDocument();
    });
});

test.each(['light', 'dark'] as const)('Library exposes current field facts and retains the v2 baseline decision in %s', async scheme => {
    const { data, calculated, saved } = await fieldInvestigationFixture(); const user = userEvent.setup(); const bytes = JSON.stringify(saved);
    render(frame(<ReviewLibraryPage {...actions} snapshot={data} isLoading={false} loadError={null} reviews={[saved]} />, scheme));
    await user.click(screen.getByRole('button', { name: 'Export filtered reviews' }));
    await user.click(screen.getByRole('menuitem', { name: 'Review library CSV' }));
    const [, columns, rows] = jest.mocked(downloadCsv).mock.calls[0];
    expect(rows[0][columns.indexOf('Coverage policy')]).toBe('shared-static-v5');
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
