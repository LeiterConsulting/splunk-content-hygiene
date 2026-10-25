import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplunkThemeProvider } from '@splunk/themes';
import { CandidatesPage } from '../pages/CandidatesPage';
import { InUseContentPage } from '../pages/InUseContentPage';
import { BulkReviewPanel } from '../components/BulkReviewPanel';
import { ReviewNavigationProvider } from '../components/ReviewNavigationContext';
import { ReviewWorkflowContext } from '../components/ReviewWorkflowContext';
import { ReviewInput, ReviewRecord } from '../types';
import { downloadJson } from '../utils/downloadJson';
import { downloadCsv } from '../utils/downloadCsv';
import { navigateToView } from '../utils/navigation';
import { edge, now, object, review, snapshot } from './milestoneFixtures';

jest.mock('../utils/downloadJson', () => ({ downloadJson: jest.fn() }));
jest.mock('../utils/downloadCsv', () => ({ downloadCsv: jest.fn() }));
jest.mock('../utils/navigation', () => ({
    ...jest.requireActual('../utils/navigation'),
    navigateToView: jest.fn(),
}));
beforeEach(() => {
    window.history.replaceState(null, '', '/');
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(now);
});
afterEach(() => jest.restoreAllMocks());
function frame(
    children: React.ReactNode,
    scheme: 'light' | 'dark' = 'light',
    states = new Map<string, ReviewRecord>(),
) {
    return (
        <SplunkThemeProvider family="enterprise" colorScheme={scheme}>
            <ReviewNavigationProvider>
                <ReviewWorkflowContext.Provider
                    value={{ states, reload: async (id) => states.get(id) ?? null }}
                >
                    {children}
                </ReviewWorkflowContext.Provider>
            </ReviewNavigationProvider>
        </SplunkThemeProvider>
    );
}
const input = snapshot(['Alpha', 'Beta'].map((name) => object(name)));
const save = jest.fn(async (value: ReviewInput) =>
    review(value.object.objectId, { stage: value.stage, note: value.note }),
);
const props = {
    snapshot: input,
    isLoading: false,
    reviews: [],
    canWriteReviews: true,
    onSaveReview: save,
    onDeleteReview: jest.fn(),
};

test.each(['light', 'dark'] as const)(
    'bulk decisions require preview and confirmation and preserve existing reviews in %s mode',
    async (scheme) => {
        const user = userEvent.setup();
        const existing = review('Alpha');
        render(
            frame(
                <CandidatesPage {...props} reviews={[existing]} />,
                scheme,
                new Map([['Alpha', existing]]),
            ),
        );
        await user.click(screen.getByRole('button', { name: 'Select all 2 filtered results' }));
        await user.click(screen.getByRole('button', { name: 'Review 2 selected' }));
        expect(
            screen.getByRole('dialog').querySelector('[data-content-hygiene-portal="true"]'),
        ).toContainElement(screen.getByRole('textbox', { name: 'Shared assignee (optional)' }));
        await user.type(
            screen.getByRole('textbox', { name: 'Shared note (optional)' }),
            'Required for quarterly work',
        );
        expect(save).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Preview affected objects' }));
        expect(screen.getByRole('dialog')).toHaveTextContent(
            '2 selected · 1 proposed saves · 1 skipped · 1 already reviewed',
        );
        expect(save).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Confirm and save reviews' }));
        await waitFor(() =>
            expect(screen.getByRole('dialog')).toHaveTextContent('1 skipped · 1 saved'),
        );
        expect(save).toHaveBeenCalledTimes(1);
        expect(save.mock.calls[0][0]).toMatchObject({
            object: { objectId: 'Beta' },
            stage: 'retain',
            note: 'Required for quarterly work',
            expectedRevisionId: null,
        });
        await user.click(screen.getByRole('button', { name: 'Export batch results JSON' }));
        expect(downloadJson).toHaveBeenCalledWith(
            'content-hygiene-bulk-review.json',
            expect.objectContaining({
                results: expect.arrayContaining([
                    expect.objectContaining({ objectId: 'Alpha', status: 'skipped' }),
                ]),
            }),
        );
    },
);
test('page selection stays page scoped, all-filtered selection covers later pages, and filter changes invalidate it', async () => {
    const user = userEvent.setup();
    const many = snapshot(Array.from({ length: 61 }, (_, index) => object(`Item ${index}`)));
    render(frame(<CandidatesPage {...props} snapshot={many} />));
    await user.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));
    expect(screen.getByRole('button', { name: 'Review 50 selected' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Select all 61 filtered results' }));
    expect(screen.getByRole('button', { name: 'Review 61 selected' })).toBeEnabled();
    await user.click(screen.getByRole('textbox', { name: 'Search' }));
    await user.paste('Item 0');
    expect(screen.getByRole('button', { name: 'Review 0 selected' })).toBeDisabled();
    await user.clear(screen.getByRole('textbox', { name: 'Search' }));
    expect(screen.getByRole('button', { name: 'Review 0 selected' })).toBeDisabled();
}, 10000);
test('viewers cannot select or initiate bulk writes', () => {
    render(frame(<CandidatesPage {...props} canWriteReviews={false} />));
    expect(screen.getByRole('button', { name: 'Select all 2 filtered results' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Select Alpha in example' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Review 0 selected' })).toBeDisabled();
});
test('cancellation waits for the in-flight save and does not roll it back or write later items', async () => {
    const user = userEvent.setup();
    let complete: (record: ReviewRecord) => void = () => undefined;
    const savePending = jest.fn(
        () =>
            new Promise<ReviewRecord>((resolve) => {
                complete = resolve;
            }),
    );
    render(
        frame(
            <BulkReviewPanel
                objects={input.objects}
                scanId={input.scan.scanId}
                reviews={[]}
                canWrite
                onSave={savePending}
            />,
        ),
    );
    await user.click(screen.getByRole('button', { name: 'Review 2 selected' }));
    await user.click(screen.getByRole('button', { name: 'Preview affected objects' }));
    await user.click(screen.getByRole('button', { name: 'Confirm and save reviews' }));
    await waitFor(() => expect(savePending).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Stop after current item' }));
    await act(async () => complete(review('Alpha')));
    await waitFor(() =>
        expect(screen.getByRole('dialog')).toHaveTextContent('1 saved · 1 cancelled'),
    );
    expect(savePending).toHaveBeenCalledTimes(1);
});
test.each(['light', 'dark'] as const)(
    'required-content report shows Retain provenance and full exports independently of display filters in %s',
    async (scheme) => {
        const user = userEvent.setup();
        const data = snapshot(
            [object('Alpha'), object('File', 'Lookup file')],
            [edge('Alpha', 'File', 'uses_file')],
        );
        render(
            frame(
                <InUseContentPage
                    snapshot={data}
                    isLoading={false}
                    reviews={[review('Alpha')]}
                    reviewsVerified
                />,
                scheme,
            ),
        );
        expect(
            screen.getByRole('heading', { name: 'In-use & required content' }),
        ).toBeInTheDocument();
        expect(screen.getByText('Partial coverage — not a migration manifest')).toBeVisible();
        await user.click(screen.getByRole('button', { name: 'Lookup file: 1' }));
        expect(screen.getByRole('heading', { name: '1 included identities' })).toBeVisible();
        await user.click(screen.getByRole('button', { name: 'Export required-content report' }));
        await user.click(
            screen.getByRole('menuitem', { name: 'Full footprint and coverage JSON' }),
        );
        expect(downloadJson).toHaveBeenCalledWith(
            'content-hygiene-required-content.json',
            expect.objectContaining({
                rows: expect.arrayContaining([
                    expect.objectContaining({ objectId: 'Alpha' }),
                    expect.objectContaining({ objectId: 'File' }),
                ]),
                coverage: 'partial',
            }),
        );
        await user.click(screen.getByRole('button', { name: 'Export required-content report' }));
        await user.click(
            screen.getByRole('menuitem', { name: 'Displayed results CSV (filtered scope)' }),
        );
        expect(jest.mocked(downloadCsv).mock.calls[0][2]).toHaveLength(1);
        await user.click(screen.getByRole('button', { name: 'Clear display filters' }));
        await user.click(
            within(screen.getByRole('row', { name: /^Alpha Macro/ })).getByRole('button', {
                name: 'Alpha',
            }),
        );
        expect(screen.getByRole('heading', { name: 'Alpha' })).toHaveFocus();
        expect(screen.getByText(/Reviewer: reviewer; date:/)).toBeVisible();
        await user.click(screen.getByRole('button', { name: 'Explore dependencies' }));
        expect(navigateToView).toHaveBeenCalledWith('dependencies', {
            object: 'Alpha',
            scan: 'scan-fixture',
        });
    },
);
test('unverified Retain records are excluded with an explicit gap, not silently accepted', () => {
    render(
        frame(
            <InUseContentPage
                snapshot={input}
                isLoading={false}
                reviews={[review('Alpha')]}
                reviewsVerified={false}
            />,
        ),
    );
    expect(screen.getByRole('heading', { name: '0 included identities' })).toBeInTheDocument();
    expect(screen.getByText(/saved Review Library could not be verified/)).toBeVisible();
});
test('an unavailable explicit starting identity is preserved without substituting another root', async () => {
    window.history.replaceState(null, '', '/?object=missing%20Report&scan=earlier');
    const user = userEvent.setup();
    render(
        frame(<InUseContentPage snapshot={input} isLoading={false} reviews={[]} reviewsVerified />),
    );
    expect(screen.getByText('Inventory changed since the originating investigation')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'missing Report' }));
    expect(screen.getByRole('button', { name: 'Explore dependencies' })).toBeDisabled();
    expect(screen.queryByRole('heading', { name: 'Alpha' })).not.toBeInTheDocument();
    const facts = screen.getByText('No — historical or unresolved identity');
    expect(facts).toBeVisible();
});
test('report table bounds rendering and explicit starts beyond picker budget remain included', () => {
    window.history.replaceState(null, '', '/?object=Root');
    const many = Array.from({ length: 211 }, (_, index) => object(`Required ${index}`));
    const data = snapshot(
        [...many, object('Root')],
        many.map((item) => edge('Root', item.objectId)),
    );
    render(
        frame(<InUseContentPage snapshot={data} isLoading={false} reviews={[]} reviewsVerified />),
    );
    expect(screen.getByRole('heading', { name: '212 included identities' })).toBeVisible();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(51);
});
