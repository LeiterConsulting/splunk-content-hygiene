// Synthetic UI/export contracts only; native customer catalogs remain untouched.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplunkThemeProvider } from '@splunk/themes';
import { FieldProvenanceDetails } from '../components/FieldLineagePanel';
import { DependencyPage } from '../pages/DependencyPage';
import { ReviewLibraryPage } from '../pages/ReviewLibraryPage';
import { ScanStatusBanner } from '../components/ScanStatusBanner';
import { ReviewNavigationProvider } from '../components/ReviewNavigationContext';
import { analyzeInventory, RawAnalysisSource } from '../services/analysis';
import { attachReviewEvidence, compareReviewEvidence, parseReviewBaseline } from '../services/reviewEvidence';
import { buildInUseReport } from '../services/inUseContent';
import { analyzeRemovalImpact } from '../services/removalImpact';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { field, fieldCompleteness } from './fieldFixtures';
import { now, object, review, snapshot } from './milestoneFixtures';

jest.mock('../utils/downloadCsv', () => ({ downloadCsv: jest.fn() }));
jest.mock('../utils/downloadJson', () => ({ downloadJson: jest.fn() }));
const actions = { canWriteReviews: true, onSaveReview: jest.fn(), onDeleteReview: jest.fn() };
const frame = (scheme: 'light' | 'dark', child: React.ReactElement) => <SplunkThemeProvider family="enterprise" colorScheme={scheme}><ReviewNavigationProvider>{child}</ReviewNavigationProvider></SplunkThemeProvider>;
beforeEach(() => { window.history.replaceState(null, '', '/'); jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => jest.restoreAllMocks());
async function fixture() {
    const producer = field('field_aliases', 'FIELDALIAS-user', 'actor AS principal', 'example', 'app', 'host::node*');
    const consumer = field('calculated_fields', 'EVAL-user', 'principal');
    const callers = Array.from({ length: 6 }, (_v, i) => object(`captured-caller-${i}`, 'Report'));
    const sources: RawAnalysisSource[] = callers.map(item => ({ objectId: item.objectId, kind: 'spl', sourceLocation: `query:${item.objectId}`,
        text: 'sourcetype=example:events host=node1' }));
    const analysis = analyzeInventory([producer.item, consumer.item, ...callers], [producer.source, consumer.source, ...sources], fieldCompleteness);
    const collectors = Object.fromEntries(Object.keys(fieldCompleteness).map(name => [name, true]));
    const objects = await attachReviewEvidence(analysis.objects, analysis.edges, { scanId: 'scan-fixture', observedAt: new Date(now).toISOString(), principal: 'operator', roles: ['operator'],
        mode: 'full', collectionComplete: true, analysisComplete: false, collectors, coverageContext: { gaps: analysis.coverageGaps, privateObjects: [], identityKnown: true, collectors } });
    const data = snapshot(objects, analysis.edges); const current = objects.find(item => item.objectId === consumer.item.objectId)!;
    const baseline = JSON.parse(JSON.stringify(current.reviewEvidence)); baseline.coverage.policy = 'shared-static-v9';
    const saved = review(current.objectId, { objectName: current.name, canonicalName: current.canonicalName, objectType: current.objectType,
        evidenceBaseline: { capturedAt: new Date(now).toISOString(), capturedBy: 'reviewer', evidence: baseline } });
    const proof = analysis.edges.find(edge => edge.fieldProvenance?.scopeCompatibility?.basis === 'captured_conjunction')!.fieldProvenance!;
    return { data, current, saved, proof, producer: objects.find(item => item.objectId === producer.item.objectId)! };
}

test.each(['light', 'dark'] as const)('supporting callers wrap, filter, paginate and link to the exact cached object in %s', async scheme => {
    const { proof } = await fixture(); const user = userEvent.setup(); render(frame(scheme, <FieldProvenanceDetails provenance={proof} />));
    expect(screen.getByText('Both scopes selected by one captured caller conjunction')).toBeVisible();
    expect(screen.getByText(/Consumer: sourcetype=example:events/)).toBeVisible(); expect(screen.getByText(/Producer: host=node\*/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Inspect supporting callers (6)' }));
    const panel = within(screen.getByRole('region', { name: 'Captured caller conjunctions' }));
    expect(panel.getByText('1–4 of 6 matching supporting callers')).toBeVisible();
    expect(panel.getAllByRole('link')).toHaveLength(4);
    expect(panel.getByRole('link', { name: 'captured-caller-0' }).getAttribute('href')).toContain('object=captured-caller-0');
    expect(panel.getAllByText('Declared conjunction: sourcetype=example:events AND host=node1')).toHaveLength(4);
    expect(panel.getByText(/not observed events or execution/)).toBeVisible();
    await user.click(panel.getByRole('button', { name: 'Next supporting callers' })); expect(panel.getByText('5–6 of 6 matching supporting callers')).toBeVisible();
    await user.type(panel.getByRole('textbox', { name: 'Find supporting caller' }), 'captured-caller-4');
    expect(panel.getByText('1–1 of 1 matching supporting callers')).toBeVisible(); expect(panel.getByRole('link', { name: 'captured-caller-4' })).toBeVisible();
    await user.clear(panel.getByRole('textbox', { name: 'Find supporting caller' }));
    await user.type(panel.getByRole('textbox', { name: 'Find supporting caller' }), 'absent'); expect(panel.getByText('No supporting callers match this filter.')).toBeVisible();
});

test.each(['light', 'dark'] as const)('Explorer exports carry independent receipts and Library preserves v9 decisions in %s', async scheme => {
    const { data, current, saved, proof } = await fixture(); const user = userEvent.setup(); const bytes = JSON.stringify(saved);
    window.history.replaceState(null, '', `/?object=${encodeURIComponent(current.objectId)}`);
    const { unmount } = render(frame(scheme, <DependencyPage {...actions} snapshot={data} isLoading={false} reviews={[saved]} />));
    await user.click(screen.getByRole('button', { name: 'Export investigation' })); await user.click(screen.getByRole('menuitem', { name: 'Filtered relationships JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-dependencies.json', expect.objectContaining({ relationships: expect.arrayContaining([
        expect.objectContaining({ edge: expect.objectContaining({ fieldProvenance: proof }) })]) }));
    await user.click(screen.getByRole('button', { name: 'Export investigation' })); await user.click(screen.getByRole('menuitem', { name: 'Filtered relationships CSV' }));
    const [, columns, rows] = jest.mocked(downloadCsv).mock.calls[0];
    expect(rows.map(row => JSON.parse(String(row[columns.indexOf('Field relationship provenance')]) || 'null'))).toContainEqual(proof);
    unmount(); jest.clearAllMocks(); window.history.replaceState(null, '', '/');
    render(frame(scheme, <ReviewLibraryPage {...actions} snapshot={data} isLoading={false} loadError={null} reviews={[saved]} />));
    await user.click(screen.getByRole('button', { name: current.name })); await user.click(screen.getByRole('button', { name: 'Export this review' }));
    await user.click(screen.getByRole('menuitem', { name: 'Selected review JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-review.json', expect.objectContaining({ review: saved, currentObject: current }));
    expect(parseReviewBaseline(saved.evidenceBaseline)).not.toBeNull(); expect(compareReviewEvidence(saved, current, data.scan, now).status).toBe('needs_review');
    expect(JSON.stringify(saved)).toBe(bytes); expect(actions.onSaveReview).not.toHaveBeenCalled();
});

test('required-content witnesses retain caller receipts, removal remains blocked and old caches request explicit rescanning', async () => {
    const { data, current, proof, producer } = await fixture();
    const report = buildInUseReport(data, [], { selectedIds: [current.objectId], activity: 'none', includeRetained: false, successfulOnly: false }, now);
    expect(JSON.stringify(report)).toContain(JSON.stringify(proof.scopeCompatibility));
    expect(analyzeRemovalImpact(producer, data.objects, data.edges, [], data.scan, 5, now).readiness).toBe('blocked');
    const { rerender } = render(frame('dark', <ScanStatusBanner scan={data.scan} isLoading={false} loadError={null} />));
    expect(screen.getByText(/predates caller-scoped cross-dimension producer evidence/)).toBeVisible();
    rerender(frame('dark', <ScanStatusBanner scan={{ ...data.scan, collectorVersions: { ...data.scan.collectorVersions, props_callers: '1.0.0' } }} isLoading={false} loadError={null} />));
    expect(screen.queryByText(/predates caller-scoped cross-dimension producer evidence/)).not.toBeInTheDocument();
});

test.each(['light', 'dark'] as const)('newer supported field-lineage snapshots do not get a false attribution warning in %s', async scheme => {
    const { data } = await fixture();
    const { rerender } = render(frame(scheme, <ScanStatusBanner scan={data.scan} isLoading={false} loadError={null} />));
    ['1.2.0', '1.3.0', '1.4.0'].forEach(version => {
        rerender(frame(scheme, <ScanStatusBanner scan={{ ...data.scan, collectorCounts: { ...data.scan.collectorCounts, field_extractions: 1, field_aliases: 1,
            calculated_fields: 1, field_transforms: 1 }, collectorVersions: { ...data.scan.collectorVersions, field_lineage: version } }} isLoading={false} loadError={null} />));
        expect(screen.queryByText(/lacks current extraction-output attribution/)).not.toBeInTheDocument();
        expect(screen.queryByText(/lacks current lookup-output/)).not.toBeInTheDocument();
    });
});
