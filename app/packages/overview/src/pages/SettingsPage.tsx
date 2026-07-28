import React, { useState } from 'react';
import {
    ButtonRow,
    Card,
    CardBody,
    CardHeader,
    CardTitle,
    DefinitionList,
    EvidenceList,
    FilterField,
    InlineNotice,
    ProgressBar,
    ProgressTrack,
    Select,
    SpacedBlock,
    StyledButton,
    Table,
    TableScroller,
    TwoColumnGrid,
} from '../AppStyles';
import { PageHeader } from '../components/PageHeader';
import {
    InventoryClient,
    InventorySnapshot,
    ReviewRecord,
    ScanProgress,
    UsageSummary,
    UsageWindowDays,
} from '../types';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';

const collections = [
    ['ch_objects', 'Normalized content inventory', 'Defined'],
    ['ch_edges', 'Directional dependency evidence', 'Defined'],
    ['ch_findings', 'Scan-specific review findings', 'Defined'],
    ['ch_owners', 'Ownership summaries', 'Defined'],
    ['ch_usage_evidence', 'Bounded usage observations and source coverage', 'Defined'],
    ['ch_exemptions', 'Protected-content and review exemptions', 'Defined'],
    ['ch_scan_runs', 'Scan lifecycle and warnings', 'Defined'],
    ['ch_settings', 'Application settings', 'Defined'],
    ['ch_reviews', 'Persistent app-local review workflow records', 'Defined'],
];

interface SettingsPageProps {
    inventoryClient: InventoryClient;
    snapshot: InventorySnapshot | null;
    snapshotLoadError: string | null;
    reviews: ReviewRecord[];
    onScanCompleted: (snapshot: InventorySnapshot) => void;
}

function startingStage(
    mode: 'bounded' | 'full' | 'usage',
    usageWindowDays: UsageWindowDays
): string {
    if (mode === 'bounded') {
        return 'Starting bounded live inventory';
    }
    if (mode === 'full') {
        return 'Starting complete live inventory';
    }
    return `Starting ${usageWindowDays}-day usage evidence scan`;
}

function inventoryMatchLabel(usage: UsageSummary | null | undefined): string {
    if (!usage) {
        return '—';
    }
    return usage.matchesCurrentInventory
        ? 'Current inventory'
        : 'Earlier inventory snapshot';
}

export function SettingsPage({
    inventoryClient,
    snapshot,
    snapshotLoadError,
    reviews,
    onScanCompleted,
}: SettingsPageProps): React.ReactElement {
    const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
    const [scanError, setScanError] = useState<string | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [runningMode, setRunningMode] = useState<
        'bounded' | 'full' | 'usage' | null
    >(null);
    const [usageWindowDays, setUsageWindowDays] =
        useState<UsageWindowDays>(90);
    const displayedScan = snapshot?.scan ?? null;
    const canRunScan = inventoryClient.isAvailable();
    const progressPercent = scanProgress
        ? Math.round(
              (scanProgress.completedCollectors / scanProgress.totalCollectors) * 100
          )
        : 0;

    const handleRunScan = async (
        mode: 'bounded' | 'full' | 'usage'
    ): Promise<void> => {
        setIsRunning(true);
        setRunningMode(mode);
        setScanError(null);
        setScanProgress({
            completedCollectors: 0,
            totalCollectors: 1,
            stage: startingStage(mode, usageWindowDays),
        });
        try {
            let completed: InventorySnapshot;
            if (mode === 'bounded') {
                completed = await inventoryClient.runBoundedScan(
                    setScanProgress
                );
            } else if (mode === 'full') {
                completed = await inventoryClient.runFullScan(setScanProgress);
            } else {
                completed = await inventoryClient.runUsageScan(
                    usageWindowDays,
                    setScanProgress
                );
            }
            onScanCompleted(completed);
        } catch (error) {
            setScanError(
                error instanceof Error
                    ? error.message
                    : 'The live inventory scan failed.'
            );
        } finally {
            setIsRunning(false);
            setRunningMode(null);
            setScanProgress(null);
        }
    };

    return (
        <>
            <PageHeader
                title="Settings & Scan Status"
                subtitle="Verify cached-data freshness and collector readiness without launching work during navigation."
                actions={
                    <ButtonRow>
                        <StyledButton
                            type="button"
                            disabled={!displayedScan}
                            onClick={() =>
                                downloadCsv(
                                    'content-hygiene-scan-report.csv',
                                    [
                                        'Scan ID',
                                        'Status',
                                        'Type',
                                        'Started',
                                        'Completed',
                                        'Analysis',
                                        'Objects',
                                        'Relationships',
                                        'Findings',
                                        'Warnings',
                                        'Review records',
                                        'Usage run',
                                        'Usage coverage',
                                        'Usage window days',
                                        'Usage observed objects',
                                    ],
                                    displayedScan
                                        ? [
                                              [
                                                  displayedScan.scanId,
                                                  displayedScan.status,
                                                  displayedScan.scanType,
                                                  displayedScan.startedAt,
                                                  displayedScan.completedAt,
                                                  displayedScan.analysisStatus,
                                                  displayedScan.objectCount,
                                                  displayedScan.edgeCount,
                                                  displayedScan.findingCount,
                                                  displayedScan.warningCount,
                                                  reviews.length,
                                                  snapshot?.usage?.runId ?? '',
                                                  snapshot?.usage?.coverage ?? '',
                                                  snapshot?.usage?.windowDays ?? '',
                                                  snapshot?.usage
                                                      ?.observedObjectCount ?? '',
                                              ],
                                          ]
                                        : []
                                )
                            }
                        >
                            Export scan CSV
                        </StyledButton>
                        <StyledButton
                            type="button"
                            disabled={!displayedScan}
                            onClick={() =>
                                downloadJson(
                                    'content-hygiene-scan-report.json',
                                    {
                                        exportedAt: new Date().toISOString(),
                                        scan: displayedScan,
                                        usage: snapshot?.usage ?? null,
                                        reviewRecordCount: reviews.length,
                                    }
                                )
                            }
                        >
                            Export scan JSON
                        </StyledButton>
                    </ButtonRow>
                }
            />

            <InlineNotice>
                {snapshot
                    ? 'Every page is reading this live KV Store snapshot. Inventory scans collect configuration and dependencies; an on-demand usage scan runs bounded read-only searches against native Splunk telemetry and stores only derived evidence in app-local KV Store.'
                    : 'No fallback dataset is used. Run a bounded scan for a quick check or a complete scan for paginated inventory and dependency analysis. Neither scan changes customer content.'}
            </InlineNotice>

            {(snapshotLoadError || scanError) && (
                <SpacedBlock>
                    <InlineNotice role="alert">
                        {scanError ??
                            `Live snapshot is unavailable: ${snapshotLoadError}`}
                    </InlineNotice>
                </SpacedBlock>
            )}

            {scanProgress && (
                <SpacedBlock aria-live="polite">
                    <strong>{scanProgress.stage}</strong>
                    <ProgressTrack
                        role="progressbar"
                        aria-label="Live inventory scan progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={progressPercent}
                    >
                        <ProgressBar $percent={progressPercent} />
                    </ProgressTrack>
                </SpacedBlock>
            )}

            <SpacedBlock>
                <TwoColumnGrid>
                    <Card>
                        <CardHeader>
                            <CardTitle>Latest scan</CardTitle>
                            <ButtonRow>
                                <StyledButton
                                    type="button"
                                    $primary
                                    disabled={!canRunScan || isRunning}
                                    onClick={() => handleRunScan('bounded')}
                                >
                                    {runningMode === 'bounded'
                                        ? 'Running bounded scan…'
                                        : 'Run bounded live scan'}
                                </StyledButton>
                                <StyledButton
                                    type="button"
                                    disabled={!canRunScan || isRunning}
                                    onClick={() => handleRunScan('full')}
                                >
                                    {runningMode === 'full'
                                        ? 'Running full scan…'
                                        : 'Run complete live scan'}
                                </StyledButton>
                            </ButtonRow>
                        </CardHeader>
                        <CardBody>
                            <DefinitionList>
                                <dt>Scan ID</dt>
                                <dd>{displayedScan?.scanId ?? '—'}</dd>
                                <dt>Status</dt>
                                <dd>{displayedScan?.status ?? 'Not run'}</dd>
                                <dt>Scan type</dt>
                                <dd>{displayedScan?.scanType ?? 'Not run'}</dd>
                                <dt>Objects</dt>
                                <dd>
                                    {displayedScan?.objectCount.toLocaleString() ??
                                        '—'}
                                </dd>
                                <dt>Relationships</dt>
                                <dd>
                                    {displayedScan?.edgeCount.toLocaleString() ??
                                        '—'}
                                </dd>
                                <dt>Findings</dt>
                                <dd>
                                    {displayedScan?.findingCount.toLocaleString() ??
                                        '—'}
                                </dd>
                                <dt>Analysis</dt>
                                <dd>
                                    {displayedScan?.analysisStatus ?? 'Not run'}
                                </dd>
                                <dt>Warnings</dt>
                                <dd>{displayedScan?.warningCount ?? '—'}</dd>
                                <dt>Data source</dt>
                                <dd>{snapshot ? 'Live Splunk data' : 'None'}</dd>
                                <dt>Review library</dt>
                                <dd>{reviews.length.toLocaleString()}</dd>
                            </DefinitionList>
                            {displayedScan &&
                            displayedScan.warnings.length > 0 ? (
                                <SpacedBlock>
                                    <strong>Collector warnings</strong>
                                    <EvidenceList>
                                        {displayedScan.warnings.map((warning) => (
                                            <li key={warning}>{warning}</li>
                                        ))}
                                    </EvidenceList>
                                </SpacedBlock>
                            ) : null}
                        </CardBody>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Usage evidence</CardTitle>
                            <ButtonRow>
                                <FilterField>
                                    Observation window
                                    <Select
                                        aria-label="Usage observation window"
                                        value={usageWindowDays}
                                        disabled={isRunning}
                                        onChange={(event) =>
                                            setUsageWindowDays(
                                                Number(
                                                    event.currentTarget.value
                                                ) as UsageWindowDays
                                            )
                                        }
                                    >
                                        <option value={30}>30 days</option>
                                        <option value={90}>90 days</option>
                                        <option value={180}>180 days</option>
                                    </Select>
                                </FilterField>
                                <StyledButton
                                    type="button"
                                    $primary
                                    disabled={
                                        !canRunScan || isRunning || !snapshot
                                    }
                                    onClick={() => handleRunScan('usage')}
                                >
                                    {runningMode === 'usage'
                                        ? 'Collecting usage…'
                                        : 'Collect usage evidence'}
                                </StyledButton>
                            </ButtonRow>
                        </CardHeader>
                        <CardBody>
                            <InlineNotice>
                                This operation creates bounded, on-demand Splunk
                                search jobs. It does not edit, disable, or delete
                                customer content. Raw user SPL and actor lists are
                                not persisted.
                            </InlineNotice>
                            <DefinitionList>
                                <dt>Latest usage run</dt>
                                <dd>{snapshot?.usage?.runId ?? 'Not run'}</dd>
                                <dt>Status</dt>
                                <dd>{snapshot?.usage?.status ?? 'Not run'}</dd>
                                <dt>Coverage</dt>
                                <dd>
                                    {snapshot?.usage?.coverage ?? 'Not measured'}
                                </dd>
                                <dt>Window</dt>
                                <dd>
                                    {snapshot?.usage
                                        ? `${snapshot.usage.windowDays} days`
                                        : 'Not measured'}
                                </dd>
                                <dt>Eligible objects</dt>
                                <dd>
                                    {snapshot?.usage?.eligibleObjectCount.toLocaleString() ??
                                        '—'}
                                </dd>
                                <dt>Complete-window objects</dt>
                                <dd>
                                    {snapshot?.usage?.fullyCoveredObjectCount.toLocaleString() ??
                                        '—'}
                                </dd>
                                <dt>Objects with activity</dt>
                                <dd>
                                    {snapshot?.usage?.observedObjectCount.toLocaleString() ??
                                        '—'}
                                </dd>
                                <dt>Inventory match</dt>
                                <dd>
                                    {inventoryMatchLabel(snapshot?.usage)}
                                </dd>
                            </DefinitionList>
                            {snapshot?.usage?.sources.length ? (
                                <SpacedBlock>
                                    <strong>Telemetry sources</strong>
                                    <EvidenceList>
                                        {snapshot.usage.sources.map((source) => (
                                            <li key={source.sourceId}>
                                                {source.label}: {source.coverage};{' '}
                                                {source.sourceEventCount.toLocaleString()}{' '}
                                                source events and{' '}
                                                {source.matchedObjectCount.toLocaleString()}{' '}
                                                matched objects
                                                {source.warning
                                                    ? ` — ${source.warning}`
                                                    : ''}
                                            </li>
                                        ))}
                                    </EvidenceList>
                                </SpacedBlock>
                            ) : null}
                            {snapshot?.usage?.warnings.length ? (
                                <SpacedBlock>
                                    <strong>Usage warnings</strong>
                                    <EvidenceList>
                                        {snapshot.usage.warnings.map((warning) => (
                                            <li key={warning}>{warning}</li>
                                        ))}
                                    </EvidenceList>
                                </SpacedBlock>
                            ) : null}
                        </CardBody>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Compatibility</CardTitle>
                        </CardHeader>
                        <CardBody>
                            <DefinitionList>
                                <dt>Verified target</dt>
                                <dd>Splunk Enterprise 10.0.1</dd>
                                <dt>Frontend</dt>
                                <dd>Splunk UI Toolkit / React</dd>
                                <dt>App ID</dt>
                                <dd>content_hygiene</dd>
                                <dt>Beta mode</dt>
                                <dd>Read-only customer content</dd>
                                <dt>Bounded scan limit</dt>
                                <dd>100 records per collector</dd>
                                <dt>Complete scan cap</dt>
                                <dd>10,000 records per collector</dd>
                                <dt>Execution model</dt>
                                <dd>Explicit, browser-session scan</dd>
                            </DefinitionList>
                        </CardBody>
                    </Card>
                </TwoColumnGrid>
            </SpacedBlock>

            {displayedScan &&
            Object.keys(displayedScan.collectorCounts).length > 0 ? (
                <SpacedBlock>
                    <Card>
                        <CardHeader>
                            <CardTitle>Latest collector results</CardTitle>
                        </CardHeader>
                        <TableScroller>
                            <Table>
                                <thead>
                                    <tr>
                                        <th scope="col">Collector</th>
                                        <th scope="col">Cached records</th>
                                        <th scope="col">Visible records</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Object.entries(
                                        displayedScan.collectorCounts
                                    ).map(
                                        ([collector, count]) => (
                                            <tr key={collector}>
                                                <td>{collector.replace(/_/g, ' ')}</td>
                                                <td>{count.toLocaleString()}</td>
                                                <td>
                                                    {(
                                                        displayedScan
                                                            .collectorTotals[
                                                            collector
                                                        ] ?? count
                                                    ).toLocaleString()}
                                                </td>
                                            </tr>
                                        )
                                    )}
                                </tbody>
                            </Table>
                        </TableScroller>
                    </Card>
                </SpacedBlock>
            ) : null}

            <SpacedBlock>
                <Card>
                    <CardHeader>
                        <CardTitle>Application-owned collections</CardTitle>
                    </CardHeader>
                    <TableScroller>
                        <Table>
                            <thead>
                                <tr>
                                    <th scope="col">Collection</th>
                                    <th scope="col">Purpose</th>
                                    <th scope="col">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {collections.map(([name, purpose, status]) => (
                                    <tr key={name}>
                                        <td>
                                            <code>{name}</code>
                                        </td>
                                        <td>{purpose}</td>
                                        <td>{status}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    </TableScroller>
                </Card>
            </SpacedBlock>
        </>
    );
}
