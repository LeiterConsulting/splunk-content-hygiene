import React, { useState } from 'react';
import {
    ButtonRow,
    Card,
    CardBody,
    CardHeader,
    CardTitle,
    DefinitionList,
    EvidenceList,
    InlineNotice,
    ProgressBar,
    ProgressTrack,
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
} from '../types';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';

const collections = [
    ['ch_objects', 'Normalized content inventory', 'Defined'],
    ['ch_edges', 'Directional dependency evidence', 'Defined'],
    ['ch_findings', 'Scan-specific review findings', 'Defined'],
    ['ch_owners', 'Ownership summaries', 'Defined'],
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
    const [runningMode, setRunningMode] = useState<'bounded' | 'full' | null>(
        null
    );
    const displayedScan = snapshot?.scan ?? null;
    const canRunScan = inventoryClient.isAvailable();
    const progressPercent = scanProgress
        ? Math.round(
              (scanProgress.completedCollectors / scanProgress.totalCollectors) * 100
          )
        : 0;

    const handleRunScan = async (mode: 'bounded' | 'full'): Promise<void> => {
        setIsRunning(true);
        setRunningMode(mode);
        setScanError(null);
        setScanProgress({
            completedCollectors: 0,
            totalCollectors: 1,
            stage:
                mode === 'bounded'
                    ? 'Starting bounded live inventory'
                    : 'Starting complete live inventory',
        });
        try {
            const completed =
                mode === 'bounded'
                    ? await inventoryClient.runBoundedScan(setScanProgress)
                    : await inventoryClient.runFullScan(setScanProgress);
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
                    ? 'Every page is reading this live KV Store snapshot. A complete scan paginates supported REST endpoints and extracts dependency evidence; usage timestamps remain unknown until measured telemetry is available.'
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
