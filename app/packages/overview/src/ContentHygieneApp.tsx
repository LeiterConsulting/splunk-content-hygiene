import React, { useEffect, useState } from 'react';
import { Page, StyledApp } from './AppStyles';
import { ScanStatusBanner } from './components/ScanStatusBanner';
import { CandidatesPage } from './pages/CandidatesPage';
import { DependencyPage } from './pages/DependencyPage';
import { OverviewPage } from './pages/OverviewPage';
import { OwnershipPage } from './pages/OwnershipPage';
import { ReviewLibraryPage } from './pages/ReviewLibraryPage';
import { SettingsPage } from './pages/SettingsPage';
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
    const [reviews, setReviews] = useState<ReviewRecord[]>([]);
    const [snapshotLoadError, setSnapshotLoadError] = useState<string | null>(null);
    const [reviewLoadError, setReviewLoadError] = useState<string | null>(null);
    const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(
        inventoryClient.isAvailable()
    );
    const [isLoadingReviews, setIsLoadingReviews] = useState(
        reviewClient.isAvailable()
    );

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
            .getLatestSnapshot()
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
                        : 'Unable to load the live inventory snapshot.'
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
    }, [inventoryClient]);

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
                            : 'Unable to load the app-local review library.'
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

    const handleSaveReview = async (
        input: ReviewInput
    ): Promise<ReviewRecord> => {
        const saved = await reviewClient.upsertReview(input);
        setReviews((current) =>
            [...current.filter((review) => review.objectId !== saved.objectId), saved].sort(
                (left, right) => right.updatedAt.localeCompare(left.updatedAt)
            )
        );
        setReviewLoadError(null);
        return saved;
    };

    const handleDeleteReview = async (objectId: string): Promise<void> => {
        await reviewClient.deleteReview(objectId);
        setReviews((current) =>
            current.filter((review) => review.objectId !== objectId)
        );
    };

    let content: React.ReactElement;

    switch (page) {
        case 'cleanup-candidates':
            content = (
                <CandidatesPage
                    snapshot={snapshot}
                    isLoading={isLoadingSnapshot}
                    reviews={reviews}
                    canWriteReviews={reviewClient.isAvailable()}
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
                    canWriteReviews={reviewClient.isAvailable()}
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
                    isLoading={isLoadingReviews}
                    loadError={reviewLoadError}
                    canWriteReviews={reviewClient.isAvailable()}
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
                <OverviewPage
                    snapshot={snapshot}
                    isLoading={isLoadingSnapshot}
                    reviews={reviews}
                />
            );
    }

    return (
        <StyledApp>
            <Page>
                <ScanStatusBanner
                    scan={snapshot?.scan ?? null}
                    isLoading={isLoadingSnapshot}
                    loadError={snapshotLoadError}
                />
                {content}
            </Page>
        </StyledApp>
    );
}
