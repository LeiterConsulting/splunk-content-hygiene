// Synthetic presentation/export contracts; never inserted into native KV.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplunkThemeProvider } from '@splunk/themes';
import { FieldProvenanceDetails } from '../components/FieldLineagePanel';
import { DependencyPage } from '../pages/DependencyPage';
import { ReviewLibraryPage } from '../pages/ReviewLibraryPage';
import { ScanStatusBanner } from '../components/ScanStatusBanner';
import { ReviewNavigationProvider } from '../components/ReviewNavigationContext';
import { analyzeInventory } from '../services/analysis';
import { attachReviewEvidence, compareReviewEvidence, parseReviewBaseline } from '../services/reviewEvidence';
import { buildInUseReport } from '../services/inUseContent';
import { analyzeRemovalImpact } from '../services/removalImpact';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { field, fieldCompleteness } from './fieldFixtures';
import { now, review, snapshot } from './milestoneFixtures';

jest.mock('../utils/downloadCsv', () => ({ downloadCsv: jest.fn() }));
jest.mock('../utils/downloadJson', () => ({ downloadJson: jest.fn() }));
const actions = { canWriteReviews: true, onSaveReview: jest.fn(), onDeleteReview: jest.fn() };
const frame = (scheme: 'light' | 'dark', child: React.ReactElement) => <SplunkThemeProvider family="enterprise" colorScheme={scheme}><ReviewNavigationProvider>{child}</ReviewNavigationProvider></SplunkThemeProvider>;
beforeEach(() => { window.history.replaceState(null, '', '/'); jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => jest.restoreAllMocks());
async function fixture() {
    const producer = field('field_aliases', 'FIELDALIAS-user', 'actor AS principal', 'example', 'app', 'example:*');
    const consumer = field('calculated_fields', 'EVAL-user', 'principal');
    const analysis = analyzeInventory([producer.item, consumer.item], [producer.source, consumer.source], fieldCompleteness);
    const collectors = Object.fromEntries(Object.keys(fieldCompleteness).map(name => [name, true]));
    const objects = await attachReviewEvidence(analysis.objects, analysis.edges, { scanId: 'scan-fixture', observedAt: new Date(now).toISOString(), principal: 'operator', roles: ['operator'],
        mode: 'full', collectionComplete: true, analysisComplete: false, collectors, coverageContext: { gaps: analysis.coverageGaps, privateObjects: [], identityKnown: true, collectors } });
    const data = snapshot(objects, analysis.edges); const current = objects.find(item => item.objectId === consumer.item.objectId)!;
    const baseline = JSON.parse(JSON.stringify(current.reviewEvidence)); baseline.coverage.policy = 'shared-static-v8';
    const saved = review(current.objectId, { objectName: current.name, canonicalName: current.canonicalName, objectType: current.objectType,
        evidenceBaseline: { capturedAt: new Date(now).toISOString(), capturedBy: 'reviewer', evidence: baseline } });
    return { data, current, saved, proof: analysis.edges[0].fieldProvenance! };
}
test.each(['light', 'dark'] as const)('both scopes and no-observed-event qualification are readable in %s', async scheme => {
    const { proof } = await fixture(); render(frame(scheme, <FieldProvenanceDetails provenance={proof} />));
    const panel = within(screen.getByRole('region', { name: 'Field relationship provenance' }));
    expect(panel.getByText('Overlapping bounded declaration patterns')).toBeVisible();
    expect(panel.getByText(/Consumer: sourcetype=example:events/)).toBeVisible();
    expect(panel.getByText(/Producer: sourcetype=example:\*/)).toBeVisible();
    expect(panel.getByText(/not an observed event/)).toBeVisible();
});
test.each(['light', 'dark'] as const)('Explorer CSV/JSON retain expanded-domain provenance and v8 decisions in %s', async scheme => {
    const { data, current, saved, proof } = await fixture(); const user = userEvent.setup(); const bytes = JSON.stringify(saved);
    window.history.replaceState(null, '', `/?object=${encodeURIComponent(current.objectId)}`);
    render(frame(scheme, <DependencyPage {...actions} snapshot={data} isLoading={false} reviews={[saved]} />));
    await user.click(screen.getByRole('button', { name: 'Export investigation' })); await user.click(screen.getByRole('menuitem', { name: 'Filtered relationships JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-dependencies.json', expect.objectContaining({ relationships: [expect.objectContaining({ edge: expect.objectContaining({ fieldProvenance: proof }) })] }));
    await user.click(screen.getByRole('button', { name: 'Export investigation' })); await user.click(screen.getByRole('menuitem', { name: 'Filtered relationships CSV' }));
    const [, columns, rows] = jest.mocked(downloadCsv).mock.calls[0]; expect(JSON.parse(String(rows[0][columns.indexOf('Field relationship provenance')]))).toEqual(proof);
    expect(parseReviewBaseline(saved.evidenceBaseline)).not.toBeNull(); expect(compareReviewEvidence(saved, current, data.scan, now).status).toBe('needs_review');
    expect(JSON.stringify(saved)).toBe(bytes); expect(actions.onSaveReview).not.toHaveBeenCalled(); expect(actions.onDeleteReview).not.toHaveBeenCalled();
});
test.each(['light', 'dark'] as const)('Library exports preserve v8 decisions alongside current expanded-domain evidence in %s', async scheme => {
    const { data, current, saved } = await fixture(); const user = userEvent.setup(); const bytes = JSON.stringify(saved);
    render(frame(scheme, <ReviewLibraryPage {...actions} snapshot={data} isLoading={false} loadError={null} reviews={[saved]} />));
    await user.click(screen.getByRole('button', { name: current.name })); await user.click(screen.getByRole('button', { name: 'Export this review' }));
    await user.click(screen.getByRole('menuitem', { name: 'Selected review JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-review.json', expect.objectContaining({ review: saved, currentObject: current }));
    expect(parseReviewBaseline(saved.evidenceBaseline)).not.toBeNull(); expect(compareReviewEvidence(saved, current, data.scan, now).status).toBe('needs_review');
    expect(JSON.stringify(saved)).toBe(bytes); expect(actions.onSaveReview).not.toHaveBeenCalled(); expect(actions.onDeleteReview).not.toHaveBeenCalled();
});
test('scope compatibility reaches required-content witnesses and keeps removal blocked', async () => {
    const { data, current, proof } = await fixture();
    const report = buildInUseReport(data, [], { selectedIds: [current.objectId], activity: 'none', includeRetained: false, successfulOnly: false }, now);
    expect(JSON.stringify(report)).toContain(JSON.stringify(proof.scopeCompatibility));
    expect(analyzeRemovalImpact(current, data.objects, data.edges, [], data.scan, 5, now).readiness).toBe('blocked');
});
test.each(['light', 'dark'] as const)('old caches request an explicit domain scan in %s', async scheme => {
    const { data } = await fixture(); const { rerender } = render(frame(scheme, <ScanStatusBanner scan={data.scan} isLoading={false} loadError={null} />));
    expect(screen.getByText(/predates bounded props producer-domain compatibility/)).toBeVisible();
    rerender(frame(scheme, <ScanStatusBanner scan={{ ...data.scan, collectorVersions: { ...data.scan.collectorVersions, props_domains: '1.0.0' } }} isLoading={false} loadError={null} />));
    expect(screen.queryByText(/predates bounded props producer-domain compatibility/)).not.toBeInTheDocument();
});
