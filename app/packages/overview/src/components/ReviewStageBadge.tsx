import React from 'react';
import { ReviewStagePill } from '../AppStyles';
import { reviewStageOptions } from '../services/reviews';
import { ReviewStage } from '../types';

interface ReviewStageBadgeProps {
    stage: ReviewStage;
}

export function reviewStageLabel(stage: ReviewStage): string {
    return (
        reviewStageOptions.find(({ value }) => value === stage)?.label ?? stage
    );
}

export function ReviewStageBadge({
    stage,
}: ReviewStageBadgeProps): React.ReactElement {
    return (
        <ReviewStagePill $stage={stage}>
            {reviewStageLabel(stage)}
        </ReviewStagePill>
    );
}
