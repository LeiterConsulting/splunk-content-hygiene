import React from 'react';
import { StatusPill } from '../AppStyles';
import { HealthStatus } from '../types';

const labels: Record<HealthStatus, string> = {
    active: 'Active',
    dormant: 'Dormant',
    orphaned: 'Orphaned',
    broken: 'Broken reference',
    unowned: 'Unowned',
    protected: 'Protected',
    unknown: 'Unknown',
};

interface StatusBadgeProps {
    status: HealthStatus;
}

export function StatusBadge({ status }: StatusBadgeProps): React.ReactElement {
    return <StatusPill $status={status}>{labels[status]}</StatusPill>;
}
