import React from 'react';
import { ScanBanner, ScanMeta, SourceBadge } from '../AppStyles';
import { ScanSummary } from '../types';

const numberFormatter = new Intl.NumberFormat('en-US');
const dateFormatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
});

interface ScanStatusBannerProps {
    scan: ScanSummary | null;
    isLoading: boolean;
    loadError: string | null;
}

function scanTitle(status: ScanSummary['status']): string {
    if (status === 'partial') {
        return 'Live inventory cache partially updated';
    }
    if (status === 'failed') {
        return 'Latest live inventory scan failed';
    }
    if (status === 'running') {
        return 'Live inventory scan in progress';
    }
    return 'Live inventory cache ready';
}

function emptyScanTitle(isLoading: boolean, loadError: string | null): string {
    if (isLoading) {
        return 'Loading live inventory';
    }
    return loadError
        ? 'Live inventory unavailable'
        : 'No live inventory cached';
}

function emptyScanMessage(isLoading: boolean, loadError: string | null): string {
    if (loadError) {
        return loadError;
    }
    return isLoading
        ? 'Reading application-owned KV Store collections.'
        : 'Run a bounded live scan from Settings to populate the interface.';
}

export function ScanStatusBanner({
    scan,
    isLoading,
    loadError,
}: ScanStatusBannerProps): React.ReactElement {
    if (scan) {
        const timestamp = scan.completedAt ?? scan.startedAt;
        return (
            <ScanBanner aria-label="Scan status">
                <div>
                    <strong>{scanTitle(scan.status)}</strong>
                    <ScanMeta>
                        <span>
                            {numberFormatter.format(scan.objectCount)} cached
                            inventory objects
                        </span>
                        <span aria-hidden="true">•</span>
                        <span>{scan.warningCount} collector warnings</span>
                        <span aria-hidden="true">•</span>
                        <span>
                            Analysis {scan.analysisStatus.replace(/_/g, ' ')}
                        </span>
                    </ScanMeta>
                </div>
                <ScanMeta>
                    <SourceBadge>Live Splunk data</SourceBadge>
                    <span>Updated {dateFormatter.format(new Date(timestamp))}</span>
                </ScanMeta>
            </ScanBanner>
        );
    }

    return (
        <ScanBanner aria-label="Scan status">
            <div>
                <strong>{emptyScanTitle(isLoading, loadError)}</strong>
                <ScanMeta>
                    <span>{emptyScanMessage(isLoading, loadError)}</span>
                </ScanMeta>
            </div>
            <SourceBadge>Live data only</SourceBadge>
        </ScanBanner>
    );
}
