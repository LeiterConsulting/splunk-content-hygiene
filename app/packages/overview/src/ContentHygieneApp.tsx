import React, { lazy, Suspense, useEffect, useState } from 'react';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import { CustomizeTheme, SplunkThemeProvider } from '@splunk/themes';
import { Page, StyledApp } from './AppStyles';
import { ScanStatusBanner } from './components/ScanStatusBanner';
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
            ? snapshot?.objects.find((object) => object.objectId === input.object.objectId)?.reviewEvidence
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

    const handleDeleteReview = async (objectId: string): Promise<void> => {
        await reviewClient.deleteReview(objectId);
        setReviews((current) => current.filter((review) => review.objectId !== objectId));
    };

    let content: React.ReactElement;

    switch (page) {
        case 'cleanup-candidates':
            content = (
                <CandidatesPage
                    snapshot={snapshot}
                    isLoading={isLoadingSnapshot}
                    reviews={reviews}
                    canWriteReviews={reviewClient.isAvailable() && access.canReview}
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
                    reviews={reviews}
                    canWriteReviews={reviewClient.isAvailable() && access.canReview}
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
                    canWriteReviews={reviewClient.isAvailable() && access.canReview}
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
                    reviews={reviews}
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
                    reviews={reviews}
                    onScanCompleted={handleScanCompleted}
                />
            );
            break;
        case 'overview':
        default:
            content = (
                <OverviewPage snapshot={snapshot} isLoading={isLoadingSnapshot} reviews={reviews} />
            );
    }

    return (
        <SplunkThemeProvider customizeTheme={readableTheme}>
            <StyledApp>
                <Page>
                    <ScanStatusBanner
                        scan={snapshot?.scan ?? null}
                        isLoading={isLoadingSnapshot}
                        loadError={snapshotLoadError}
                    />
                    <Suspense
                        fallback={
                            <WaitSpinner
                                screenReaderText="Loading Content Hygiene view"
                                size="large"
                            />
                        }
                    >
                        {content}
                    </Suspense>
                </Page>
            </StyledApp>
        </SplunkThemeProvider>
    );
}
