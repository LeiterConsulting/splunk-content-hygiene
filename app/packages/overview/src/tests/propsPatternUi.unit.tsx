// Synthetic UI/export contracts only. Native theme/runtime checks are separate.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplunkThemeProvider } from '@splunk/themes';
import { FieldLineagePanel, FieldProvenanceDetails } from '../components/FieldLineagePanel';
import { ScanStatusBanner } from '../components/ScanStatusBanner';
import { DependencyPage } from '../pages/DependencyPage';
import { ReviewLibraryPage } from '../pages/ReviewLibraryPage';
import { ReviewNavigationProvider } from '../components/ReviewNavigationContext';
import { fieldInvestigationFixture } from './fieldFixtures';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { now } from './milestoneFixtures';

jest.mock('../utils/downloadCsv', () => ({ downloadCsv: jest.fn() }));
jest.mock('../utils/downloadJson', () => ({ downloadJson: jest.fn() }));
const actions = { canWriteReviews: true, onSaveReview: jest.fn(), onDeleteReview: jest.fn() };
const frame = (scheme: 'light' | 'dark', child: React.ReactElement) => <SplunkThemeProvider family="enterprise" colorScheme={scheme}><ReviewNavigationProvider>{child}</ReviewNavigationProvider></SplunkThemeProvider>;
beforeEach(() => { window.history.replaceState(null, '', '/'); jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => jest.restoreAllMocks());

test.each(['light', 'dark'] as const)('scope labels and keyboard disclosure distinguish bounded patterns, defaults and unsupported scopes in %s', async scheme => {
    const { alias } = await fieldInvestigationFixture(); const user = userEvent.setup();
    const { rerender } = render(frame(scheme, <FieldLineagePanel object={{ ...alias, fieldLineage: { ...alias.fieldLineage!, scope: { field: 'source', value: '/var/log/*.log', exact: false } } }} />));
    expect(screen.getByText(/source=\/var\/log\/\*\.log · bounded/)).toBeVisible();
    const toggle = screen.getByRole('button', { name: 'Inspect shared props contexts (0)' }); toggle.focus(); await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Sequential reads are not an atomic configuration transaction/)).toBeVisible();
    rerender(frame(scheme, <FieldLineagePanel object={{ ...alias, fieldLineage: { ...alias.fieldLineage!, scope: { field: 'sourcetype', value: 'default', exact: false } } }} />));
    expect(screen.getByText(/\[default\] · potential shared fallback/)).toBeVisible();
    rerender(frame(scheme, <FieldLineagePanel object={{ ...alias, fieldLineage: { ...alias.fieldLineage!, scope: { field: 'host', value: '(?-i)server*', exact: false } } }} />));
    expect(screen.getByText(/unsupported pattern\/encoded scope · unverified/)).toBeVisible();
});
test.each(['light', 'dark'] as const)('old scan requests explicit pattern/default refresh without changing decisions in %s', async scheme => {
    const { data } = await fieldInvestigationFixture(); const { rerender } = render(frame(scheme, <ScanStatusBanner scan={data.scan} isLoading={false} loadError={null} />));
    expect(screen.getByText(/predates bounded props pattern\/default caller coverage/)).toBeVisible();
    rerender(frame(scheme, <ScanStatusBanner scan={{ ...data.scan, collectorVersions: { ...data.scan.collectorVersions, props_patterns: '1.0.0' } }} isLoading={false} loadError={null} />));
    expect(screen.queryByText(/predates bounded props pattern\/default caller coverage/)).not.toBeInTheDocument();
});
async function defaultEvidenceFixture() {
    const { data, calculated, saved } = await fieldInvestigationFixture();
    // Presentation/export contract; no native inventory or source definition is created.
    calculated.fieldLineage = { ...calculated.fieldLineage!, scope: { field: 'sourcetype', value: 'default', exact: false } };
    const baseline = JSON.parse(JSON.stringify(saved.evidenceBaseline)); baseline.evidence.coverage.policy = 'shared-static-v7'; saved.evidenceBaseline = baseline;
    return { data, calculated, saved, baseline };
}
test.each(['light', 'dark'] as const)('Explorer CSV/JSON preserve compact default evidence and the v7 review in %s', async scheme => {
    const { data, calculated, saved } = await defaultEvidenceFixture(); const user = userEvent.setup();
    const bytes = JSON.stringify(saved); window.history.replaceState(null, '', `/?object=${encodeURIComponent(calculated.objectId)}&tab=object`);
    render(frame(scheme, <DependencyPage {...actions} snapshot={data} isLoading={false} reviews={[saved]} />));
    expect(screen.getByText(/\[default\] · potential shared fallback/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Export investigation' })); await user.click(screen.getByRole('menuitem', { name: 'Filtered relationships JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-dependencies.json', expect.objectContaining({ centerObject: expect.objectContaining({ fieldLineage: calculated.fieldLineage }) }));
    await user.click(screen.getByRole('button', { name: 'Export investigation' })); await user.click(screen.getByRole('menuitem', { name: 'Filtered relationships CSV' }));
    const [, columns, rows] = jest.mocked(downloadCsv).mock.calls[0]; expect(JSON.parse(String(rows[0][columns.indexOf('Center declared field facts')]))).toEqual(calculated.fieldLineage);
    expect(JSON.stringify(saved)).toBe(bytes); expect(actions.onSaveReview).not.toHaveBeenCalled(); expect(actions.onDeleteReview).not.toHaveBeenCalled();
});
test.each(['light', 'dark'] as const)('Library details and JSON preserve compact default evidence and the v7 review in %s', async scheme => {
    const { data, calculated, saved, baseline } = await defaultEvidenceFixture(); const user = userEvent.setup(); const bytes = JSON.stringify(saved);
    render(frame(scheme, <ReviewLibraryPage {...actions} snapshot={data} isLoading={false} loadError={null} reviews={[saved]} />));
    await user.click(screen.getByRole('button', { name: calculated.name })); await user.click(screen.getByRole('tab', { name: 'Object & usage details' }));
    expect(screen.getByText(/\[default\] · potential shared fallback/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Export this review' })); await user.click(screen.getByRole('menuitem', { name: 'Selected review JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-review.json', expect.objectContaining({ currentObject: expect.objectContaining({ fieldLineage: calculated.fieldLineage }),
        review: expect.objectContaining({ evidenceBaseline: baseline }) }));
    expect(JSON.stringify(saved)).toBe(bytes); expect(actions.onSaveReview).not.toHaveBeenCalled(); expect(actions.onDeleteReview).not.toHaveBeenCalled();
});
test.each(['light', 'dark'] as const)('relationship scope uses the same bounded-pattern explanation in %s', async scheme => {
    const { data, alias } = await fieldInvestigationFixture(); const proof = { ...data.edges.find(row => row.sourceId === alias.objectId)!.fieldProvenance!,
        scope: { field: 'source' as const, value: '/var/log/...', exact: false } };
    render(frame(scheme, <FieldProvenanceDetails provenance={proof} />));
    expect(within(screen.getByRole('region', { name: 'Field relationship provenance' })).getByText(/source=\/var\/log\/\.\.\. · bounded/)).toBeVisible();
});
