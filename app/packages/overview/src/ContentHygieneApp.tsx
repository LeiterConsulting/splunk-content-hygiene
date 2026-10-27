import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import { CustomizeTheme, SplunkThemeProvider } from '@splunk/themes';
import { InlineNotice, Page, StyledApp } from './AppStyles';
import { ScanStatusBanner } from './components/ScanStatusBanner';
import { ReviewWorkflowContext } from './components/ReviewWorkflowContext';
import { ReviewNavigationProvider } from './components/ReviewNavigationContext';
import { AppPolicyProvider } from './components/AppPolicyContext';
import { getHygieneAccess } from './services/access';
import { splunkInventoryClient } from './services/inventory';
import { splunkReviewClient } from './services/reviews';
import {
    AppPage,
    InventoryClient,
    InventorySnapshot,
    ReviewClient,
    ReviewInput,
    ReviewRecord,
} from './types';

const CandidatesPage = lazy(() =>
    import('./pages/CandidatesPage').then((module) => ({ default: module.CandidatesPage })),
);
const DependencyPage = lazy(() =>
    import('./pages/DependencyPage').then((module) => ({ default: module.DependencyPage })),
);
const OverviewPage = lazy(() =>
    import('./pages/OverviewPage').then((module) => ({ default: module.OverviewPage })),
);
const OwnershipPage = lazy(() =>
    import('./pages/OwnershipPage').then((module) => ({ default: module.OwnershipPage })),
);
const ReviewLibraryPage = lazy(() =>
    import('./pages/ReviewLibraryPage').then((module) => ({ default: module.ReviewLibraryPage })),
);
const SettingsPage = lazy(() =>
    import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
);
const InUseContentPage = lazy(() =>
    import('./pages/InUseContentPage').then((module) => ({ default: module.InUseContentPage })),
);

// Native controls use muted text for placeholders and default text for option
// descriptions. Both must remain readable on selected/active menu surfaces as
// well as the page, including portalled menus.
export const readableTheme: CustomizeTheme = (theme) => ({
    ...theme,
    contentColorDefault: theme.contentColorActive,
    contentColorMuted: theme.contentColorActive,
});

interface ContentHygieneAppProps {
    page: AppPage;
    inventoryClient?: InventoryClient;
    reviewClient?: ReviewClient;
}

export function ContentHygieneApp({
    page,
    inventoryClient = splunkInventoryClient,
    reviewClient = splunkReviewClient,
}: ContentHygieneAppProps): React.ReactElement {
    const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
    const snapshotObjects = useMemo(() => new Map(snapshot?.objects.map((object) => [object.objectId, object]) ?? []), [snapshot]);
    const [access, setAccess] = useState({
        canCollect: inventoryClient !== splunkInventoryClient,
        canReview: reviewClient !== splunkReviewClient,
    });
    useEffect(() => {
        if (inventoryClient !== splunkInventoryClient) {
            return undefined;
        }
        let active = true;
        getHygieneAccess()
            .then((result) => {
                if (active) {
                    setAccess(result);
                }
            })
            .catch(() => {
                if (active) {
                    setAccess({ canCollect: false, canReview: false });
                }
            });
        return () => {
            active = false;
        };
    }, [inventoryClient]);
    const [reviews, setReviews] = useState<ReviewRecord[]>([]);
    const [snapshotLoadError, setSnapshotLoadError] = useState<string | null>(null);
    const [reviewLoadError, setReviewLoadError] = useState<string | null>(null);
    const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(inventoryClient.isAvailable());
    const [isLoadingReviews, setIsLoadingReviews] = useState(reviewClient.isAvailable());

    const handleScanCompleted = (completed: InventorySnapshot): void => {
        setSnapshot(completed);
        setSnapshotLoadError(null);
    };

    useEffect(() => {
        if (!inventoryClient.isAvailable()) {
            setIsLoadingSnapshot(false);
            return undefined;
        }

        let isActive = true;
        setIsLoadingSnapshot(true);
        inventoryClient
            .getLatestSnapshot(page)
            .then((latestSnapshot) => {
                if (isActive) {
                    setSnapshot(latestSnapshot);
                    setSnapshotLoadError(null);
                }
            })
            .catch((error: unknown) => {
                if (isActive) {
                    setSnapshotLoadError(
                        error instanceof Error
                            ? error.message
                            : 'Unable to load the live inventory snapshot.',
                    );
                }
            })
            .then(() => {
                if (isActive) {
                    setIsLoadingSnapshot(false);
                }
            });

        return () => {
            isActive = false;
        };
    }, [inventoryClient, page]);

    useEffect(() => {
        if (!reviewClient.isAvailable()) {
            setIsLoadingReviews(false);
            return undefined;
        }

        let isActive = true;
        setIsLoadingReviews(true);
        reviewClient
            .listReviews()
            .then((storedReviews) => {
                if (isActive) {
                    setReviews(storedReviews);
                    setReviewLoadError(null);
                }
            })
            .catch((error: unknown) => {
                if (isActive) {
                    setReviewLoadError(
                        error instanceof Error
                            ? error.message
                            : 'Unable to load the app-local review library.',
                    );
                }
            })
            .then(() => {
                if (isActive) {
                    setIsLoadingReviews(false);
                }
            });

        return () => {
            isActive = false;
        };
    }, [reviewClient]);

    const handleSaveReview = async (input: ReviewInput): Promise<ReviewRecord> => {
        const evidence = input.captureEvidence
            ? snapshotObjects.get(input.object.objectId)?.reviewEvidence
            : undefined;
        const saved = await reviewClient.upsertReview({ ...input, evidence });
        setReviews((current) =>
            [...current.filter((review) => review.objectId !== saved.objectId), saved].sort(
                (left, right) => right.updatedAt.localeCompare(left.updatedAt),
            ),
        );
        setReviewLoadError(null);
        return saved;
    };

    const handleDeleteReview = async (objectId: string, expectedRevisionId?: string | null): Promise<void> => {
        await reviewClient.deleteReview(objectId, expectedRevisionId);
        setReviews(await reviewClient.listReviews());
    };
    const handleRefreshReviews = useCallback(async (): Promise<ReviewRecord[]> => {
        setIsLoadingReviews(true);
        try {
            const latest = await reviewClient.listReviews();
            setReviews(latest); setReviewLoadError(null); return latest;
        } catch (failure) {
            setReviewLoadError(failure instanceof Error ? failure.message : 'Unable to verify the saved review library.');
            throw failure;
        } finally { setIsLoadingReviews(false); }
    }, [reviewClient]);
    const handleReloadReview = useCallback(async (objectId: string): Promise<ReviewRecord | null> => {
        if (reviewLoadError) { return (await handleRefreshReviews()).find((record) => record.objectId === objectId) ?? null; }
        const latest = reviewClient.getReview ? await reviewClient.getReview(objectId)
            : (await reviewClient.listReviews()).find((record) => record.objectId === objectId) ?? null;
        setReviews((current) => [...current.filter((record) => record.objectId !== objectId), ...(latest ? [latest] : [])]);
        return latest;
    }, [reviewClient, reviewLoadError, handleRefreshReviews]);
    const activeReviews = useMemo(() => reviews.filter((review) => !review.removed), [reviews]);
    const usableReviews = useMemo(() => reviewLoadError ? activeReviews.map((review) => ({ ...review,
        persistenceIssue: 'The latest saved review library could not be verified. Refresh it before relying on this confirmation.',
    })) : activeReviews, [activeReviews, reviewLoadError]);
    const workflow = useMemo(() => ({ states: new Map(reviews.map((review) => [review.objectId, review])),
        reload: handleReloadReview, history: reviewClient.listHistory,
        refresh: reviewClient.isAvailable() ? async () => { await handleRefreshReviews(); } : undefined,
    }), [reviews, handleReloadReview, handleRefreshReviews, reviewClient]);
    const canWriteReviews = reviewClient.isAvailable() && access.canReview && !isLoadingReviews && !reviewLoadError;

    let content: React.ReactElement;

    switch (page) {
        case 'in-use-content':
            content = <InUseContentPage snapshot={snapshot} isLoading={isLoadingSnapshot}
                reviews={usableReviews} reviewsVerified={!isLoadingReviews && !reviewLoadError} />;
            break;
        case 'cleanup-candidates':
            content = (
                <CandidatesPage
                    snapshot={snapshot}
                    isLoading={isLoadingSnapshot}
                    reviews={usableReviews}
                    canWriteReviews={Boolean(canWriteReviews)}
                    onSaveReview={handleSaveReview}
                    onDeleteReview={handleDeleteReview}
                />
            );
            break;
        case 'dependency-explorer':
            content = (
                <DependencyPage
                    snapshot={snapshot}
                    isLoading={isLoadingSnapshot}
                    reviews={usableReviews}
                    canWriteReviews={Boolean(canWriteReviews)}
                    onSaveReview={handleSaveReview}
                    onDeleteReview={handleDeleteReview}
                />
            );
            break;
        case 'review-library':
            content = (
                <ReviewLibraryPage
                    snapshot={snapshot}
                    reviews={reviews}
                    isLoading={isLoadingReviews || isLoadingSnapshot}
                    loadError={reviewLoadError}
                    canWriteReviews={Boolean(canWriteReviews)}
                    onSaveReview={handleSaveReview}
                    onDeleteReview={handleDeleteReview}
                />
            );
            break;
        case 'ownership':
            content = (
                <OwnershipPage
                    snapshot={snapshot}
                    isLoading={isLoadingSnapshot}
                    reviews={activeReviews}
                />
            );
            break;
        case 'settings':
            content = (
                <SettingsPage
                    inventoryClient={inventoryClient}
                    canCollect={access.canCollect}
                    snapshot={snapshot}
                    snapshotLoadError={snapshotLoadError}
                    reviews={activeReviews}
                    onScanCompleted={handleScanCompleted}
                />
            );
            break;
        case 'overview':
        default:
            content = (
                <OverviewPage snapshot={snapshot} isLoading={isLoadingSnapshot} reviews={activeReviews} />
            );
    }

    return (
        <SplunkThemeProvider customizeTheme={readableTheme}>
            <ReviewNavigationProvider><StyledApp>
                <Page>
                    <ScanStatusBanner
                        scan={snapshot?.scan ?? null}
                        isLoading={isLoadingSnapshot}
                        loadError={snapshotLoadError}
                    />
                    {reviewLoadError && page !== 'review-library' ? (
                        <InlineNotice role="alert">Saved reviews could not be verified: {reviewLoadError} Review edits are disabled until the library reloads successfully.</InlineNotice>
                    ) : null}
                    <Suspense
                        fallback={
                            <WaitSpinner
                                screenReaderText="Loading Content Hygiene view"
                                size="large"
                            />
                        }
                    >
                        <ReviewWorkflowContext.Provider value={workflow}>
                            <AppPolicyProvider enabled={inventoryClient === splunkInventoryClient} canManage={access.canCollect} snapshot={snapshot} reviews={usableReviews} reviewsVerified={!isLoadingReviews && !reviewLoadError}>
                                {content}
                            </AppPolicyProvider>
                        </ReviewWorkflowContext.Provider>
                    </Suspense>
                </Page>
            </StyledApp></ReviewNavigationProvider>
        </SplunkThemeProvider>
    );
}
