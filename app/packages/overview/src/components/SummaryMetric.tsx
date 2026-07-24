import React from 'react';
import {
    MetricCard,
    MetricHint,
    MetricLabel,
    MetricValue,
} from '../AppStyles';

interface SummaryMetricProps {
    label: string;
    value: string;
    hint: string;
    accent?: 'positive' | 'warning' | 'negative' | 'info' | 'neutral';
}

export function SummaryMetric({
    label,
    value,
    hint,
    accent = 'neutral',
}: SummaryMetricProps): React.ReactElement {
    return (
        <MetricCard $accent={accent}>
            <MetricLabel>{label}</MetricLabel>
            <MetricValue>{value}</MetricValue>
            <MetricHint>{hint}</MetricHint>
        </MetricCard>
    );
}
