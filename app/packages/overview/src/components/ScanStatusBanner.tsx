import React from 'react';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import { ScanBanner, ScanMeta, SourceBadge, StyledButton } from '../AppStyles';
import { ScanSummary } from '../types';
import { navigateToView } from '../utils/navigation';
import { useReviewNavigation } from './ReviewNavigationContext';

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
        return 'Live inventory has coverage limitations';
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
    return loadError ? 'Live inventory unavailable' : 'No live inventory cached';
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
    const { navigate } = useReviewNavigation();
    if (scan) {
        const timestamp = scan.completedAt ?? scan.startedAt;
        let fieldNotice: string | null = null;
        if (!['field_extractions', 'field_aliases', 'calculated_fields', 'field_transforms'].every(collector => Object.prototype.hasOwnProperty.call(scan.collectorCounts, collector))) {
            fieldNotice = 'This snapshot predates field-lineage coverage. Run a new complete scan from Settings; existing decisions and baselines are unchanged.';
        } else if (scan.collectorVersions?.field_lineage !== '1.2.0') {
            if (scan.collectorVersions?.field_lineage === '1.1.0') {
                fieldNotice = 'This snapshot lacks current lookup-output and configuration-context evidence. Run a new complete scan; existing decisions and captured baselines are preserved.';
            } else {
                fieldNotice = 'This snapshot lacks current extraction-output attribution. Run a new complete scan from Settings; existing decisions and captured evidence are preserved.';
            }
        }
        let bannerState: 'ready' | 'warning' | 'error' = 'ready';
        if (scan.status === 'failed') { bannerState = 'error'; }
        else if (scan.status === 'partial' || scan.warningCount > 0 || scan.analysisStatus !== 'complete') { bannerState = 'warning'; }
        return (
            <ScanBanner aria-label="Scan status" $state={bannerState}>
                <div>
                    <strong>{scanTitle(scan.status)}</strong>
                    {scan.retainedBaseline ? (
                        <div>
                            A verified full-scan baseline is retained; a newer bounded or partial
                            check did not replace it.
                        </div>
                    ) : null}
                    {!['event_types', 'tag_bindings'].every(collector => Object.prototype.hasOwnProperty.call(scan.collectorCounts, collector)) ? (
                        <div>
                            This snapshot predates event-type/tag coverage. Run a new complete scan from Settings; existing review decisions are preserved.
                        </div>
                    ) : null}
                    {fieldNotice ? <div>{fieldNotice}</div> : null}
                    {scan.collectorVersions?.props_precedence !== '1.0.0' ? <div>This snapshot predates shared props precedence checks. Run a new complete scan; existing decisions and baselines are preserved.</div> : null}
                    {scan.collectorVersions?.props_cross_stanza !== '1.0.0' ? <div>This snapshot lacks current conditional cross-stanza props comparisons. Run a new complete scan; existing decisions and baselines are unchanged.</div> : null}
                    {scan.collectorVersions?.props_patterns !== '1.0.0' ? <div>This snapshot predates bounded props pattern/default caller coverage. Run a new complete scan; existing decisions and baselines are unchanged.</div> : null}
                    {!['workflow_actions', 'navigation'].every(collector => Object.prototype.hasOwnProperty.call(scan.collectorCounts, collector)) || scan.collectorVersions?.interaction_dependencies !== '1.0.1' ? (
                        <div>
                            This snapshot predates current workflow/navigation coverage. Run a new complete scan from Settings; individual decisions, policy history and captured baselines are unchanged.
                        </div>
                    ) : null}
                    <ScanMeta>
                        <span>
                            {numberFormatter.format(scan.objectCount)} cached inventory objects
                        </span>
                        <span aria-hidden="true">•</span>
                        <span>{scan.warningCount} collector warnings</span>
                        <span aria-hidden="true">•</span>
                        <span>Analysis {scan.analysisStatus.replace(/_/g, ' ')}</span>
                    </ScanMeta>
                </div>
                <ScanMeta>
                    <SourceBadge>Live Splunk data</SourceBadge>
                    <span>Updated {dateFormatter.format(new Date(timestamp))}</span>
                    <StyledButton appearance="standalone" onClick={() => navigate(() => navigateToView('settings'))}>View scan details</StyledButton>
                </ScanMeta>
            </ScanBanner>
        );
    }

    return (
        <ScanBanner aria-label="Scan status" $state={loadError ? 'error' : 'unknown'}>
            <div>
                {isLoading ? <WaitSpinner screenReaderText="Loading verified inventory" /> : null}
                <strong>{emptyScanTitle(isLoading, loadError)}</strong>
                <ScanMeta>
                    <span>{emptyScanMessage(isLoading, loadError)}</span>
                </ScanMeta>
            </div>
            <SourceBadge>Live data only</SourceBadge>
        </ScanBanner>
    );
}
