import React, { useState } from 'react';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import CollapsiblePanel from '@splunk/react-ui/CollapsiblePanel';
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
    SmallText,
    SpacedBlock,
    StyledButton,
    Table,
    TableScroller,
    TwoColumnGrid,
} from '../AppStyles';
import { PageHeader } from '../components/PageHeader';
import { ExportMenu } from '../components/ExportMenu';
import { evidenceWindowFresh } from '../services/usage';
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
    ['ch_reviews', 'Preserved legacy review decisions (read-only in the app)', 'Defined'],
    ['ch_review_revisions', 'Conflict-safe review revision journal', 'Defined'],
    ['ch_app_policy_revisions', 'Independent exact-app retention policy history', 'Defined'],
];

interface SettingsPageProps {
    inventoryClient: InventoryClient;
    canCollect?: boolean;
    snapshot: InventorySnapshot | null;
    snapshotLoadError: string | null;
    reviews: ReviewRecord[];
    onScanCompleted: (snapshot: InventorySnapshot) => void;
}

function startingStage(
    mode: 'bounded' | 'full' | 'usage',
    usageWindowDays: UsageWindowDays,
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
    return usage.matchesCurrentInventory ? 'Current inventory' : 'Earlier inventory snapshot';
}

export function SettingsPage({
    inventoryClient,
    canCollect = true,
    snapshot,
    snapshotLoadError,
    reviews,
    onScanCompleted,
}: SettingsPageProps): React.ReactElement {
    const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
    const [scanError, setScanError] = useState<string | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [runningMode, setRunningMode] = useState<'bounded' | 'full' | 'usage' | null>(null);
    const [usageWindowDays, setUsageWindowDays] = useState<UsageWindowDays>(90);
    const displayedScan = snapshot?.latestCheck ?? snapshot?.scan ?? null;
    let runFreshness = 'Not measured';
    if (snapshot?.usage) {
        runFreshness =
            snapshot.usage.matchesCurrentInventory && evidenceWindowFresh(snapshot.usage.windowEnd)
                ? 'Current window'
                : 'Historical — cannot establish current readiness';
    }
    const canRunScan = inventoryClient.isAvailable() && canCollect;
    const progressPercent = scanProgress
        ? Math.round((scanProgress.completedCollectors / scanProgress.totalCollectors) * 100)
        : 0;

    const handleRunScan = async (mode: 'bounded' | 'full' | 'usage'): Promise<void> => {
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
                completed = await inventoryClient.runBoundedScan(setScanProgress);
            } else if (mode === 'full') {
                completed = await inventoryClient.runFullScan(setScanProgress);
            } else {
                completed = await inventoryClient.runUsageScan(usageWindowDays, setScanProgress);
            }
            onScanCompleted(completed);
        } catch (error) {
            setScanError(
                error instanceof Error ? error.message : 'The live inventory scan failed.',
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
                    <ExportMenu label="Export scan report" disabled={!displayedScan} items={[
                        { label: 'Scan report CSV', onClick: () =>
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
                                        'Normalized collector records',
                                        'Collected native entries',
                                        'Visible native entries',
                                        'Analysis counters',
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
                                                  snapshot?.usage?.observedObjectCount ?? '',
                                                  JSON.stringify(displayedScan.collectorCounts),
                                                  JSON.stringify(displayedScan.collectorNativeCounts ?? {}),
                                                  JSON.stringify(displayedScan.collectorTotals),
                                                  JSON.stringify(displayedScan.parserCounts ?? {}),
                                              ],
                                          ]
                                        : [],
                                )
                            },
                        { label: 'Scan report JSON', onClick: () =>
                                downloadJson('content-hygiene-scan-report.json', {
                                    exportedAt: new Date().toISOString(),
                                    scan: displayedScan,
                                    operationalBaseline: snapshot?.scan ?? null,
                                    usage: snapshot?.usage ?? null,
                                    reviewRecordCount: reviews.length,
                                })
                            },
                    ]} />
                }
            />

            <InlineNotice>
                {snapshot
                    ? 'Every page is reading this live KV Store snapshot. Inventory scans collect configuration and dependencies; an on-demand usage scan runs bounded read-only searches against native Splunk telemetry and stores only derived evidence in app-local KV Store.'
                    : 'No fallback dataset is used. Run a bounded scan for a quick check or a complete scan for paginated inventory and dependency analysis. Neither scan changes customer content.'}
            </InlineNotice>
            {!canCollect ? (
                <InlineNotice>
                    Collection requires the Content Hygiene operator role. Your current role can
                    review the verified inventory.
                </InlineNotice>
            ) : null}
            {isRunning ? (
                <ButtonRow>
                    <WaitSpinner screenReaderText="Collecting live evidence" />
                    <StyledButton
                        onClick={() => inventoryClient.cancelScan?.()}
                        disabled={!inventoryClient.cancelScan}
                    >
                        Cancel scan
                    </StyledButton>
                </ButtonRow>
            ) : null}

            {(snapshotLoadError || scanError) && (
                <SpacedBlock>
                    <InlineNotice role="alert">
                        {scanError ?? `Live snapshot is unavailable: ${snapshotLoadError}`}
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
                                <dd>{displayedScan?.objectCount.toLocaleString() ?? '—'}</dd>
                                <dt>Relationships</dt>
                                <dd>{displayedScan?.edgeCount.toLocaleString() ?? '—'}</dd>
                                <dt>Findings</dt>
                                <dd>{displayedScan?.findingCount.toLocaleString() ?? '—'}</dd>
                                <dt>Analysis</dt>
                                <dd>{displayedScan?.analysisStatus ?? 'Not run'}</dd>
                                <dt>Warnings</dt>
                                <dd>{displayedScan?.warningCount ?? '—'}</dd>
                                <dt>Data source</dt>
                                <dd>{snapshot ? 'Live Splunk data' : 'None'}</dd>
                                <dt>Review library</dt>
                                <dd>{reviews.length.toLocaleString()}</dd>
                            </DefinitionList>
                            {displayedScan?.collectorVersions?.props_precedence === '1.0.0' ? <section aria-label="Shared props scan diagnostics">
                                <CollapsiblePanel appearance="subtle" title="Shared props context diagnostics">
                                    <SmallText>Scan-time shared exact-stanza observations, not runtime execution or complete effective-props coverage. Unverified and truncated contexts do not establish absence.</SmallText>
                                    <DefinitionList>
                                        <dt>Context observations</dt><dd>{(displayedScan.parserCounts?.props_context_checks ?? 0).toLocaleString()}</dd>
                                        <dt>Native GET reads</dt><dd>{(displayedScan.parserCounts?.props_context_reads ?? 0).toLocaleString()}</dd>
                                        <dt>Local / inherited</dt><dd>{displayedScan.parserCounts?.props_context_local ?? 0} / {displayedScan.parserCounts?.props_context_inherited ?? 0}</dd>
                                        <dt>Shadowed / unverified</dt><dd>{displayedScan.parserCounts?.props_context_shadowed ?? 0} / {displayedScan.parserCounts?.props_context_unverified ?? 0}</dd>
                                        <dt>Truncated edges / objects</dt><dd>{displayedScan.parserCounts?.props_context_truncated_edges ?? 0} / {displayedScan.parserCounts?.props_context_truncated_objects ?? 0}</dd>
                                    </DefinitionList>
                                    <SmallText>Complete-scan ceiling: 256 native attribute/app pairs, two reads per pair, four workers, 90 seconds; 128 KiB per response and eight seconds per read. Bounded scans use 32 pairs and 15 seconds. Fixed callers are prioritized. Additional candidate/task/row ceilings remain explicit in context details and JSON diagnostics.</SmallText>
                                </CollapsiblePanel>
                            </section> : null}
                            {displayedScan && displayedScan.warnings.length > 0 ? (
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
                                                    event.currentTarget.value,
                                                ) as UsageWindowDays,
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
                                    disabled={!canRunScan || isRunning || !snapshot}
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
                                This operation creates bounded, on-demand Splunk search jobs. It
                                does not edit, disable, or delete customer content. Raw user SPL and
                                actor lists are not persisted.
                            </InlineNotice>
                            <DefinitionList>
                                <dt>Latest usage run</dt>
                                <dd>{snapshot?.usage?.runId ?? 'Not run'}</dd>
                                <dt>Status</dt>
                                <dd>{snapshot?.usage?.status ?? 'Not run'}</dd>
                                <dt>Coverage</dt>
                                <dd>{snapshot?.usage?.coverage ?? 'Not measured'}</dd>
                                <dt>Window</dt>
                                <dd>
                                    {snapshot?.usage
                                        ? `${snapshot.usage.windowDays} days`
                                        : 'Not measured'}
                                </dd>
                                <dt>Eligible objects</dt>
                                <dd>
                                    {snapshot?.usage?.eligibleObjectCount.toLocaleString() ?? '—'}
                                </dd>
                                <dt>Complete-window objects</dt>
                                <dd>
                                    {snapshot?.usage?.fullyCoveredObjectCount.toLocaleString() ??
                                        '—'}
                                </dd>
                                <dt>Objects with activity</dt>
                                <dd>
                                    {snapshot?.usage?.observedObjectCount.toLocaleString() ?? '—'}
                                </dd>
                                <dt>Inventory match</dt>
                                <dd>{inventoryMatchLabel(snapshot?.usage)}</dd>
                                <dt>Run freshness</dt>
                                <dd>{runFreshness}</dd>
                                <dt>Window ended</dt>
                                <dd>{snapshot?.usage?.windowEnd ?? 'Not measured'}</dd>
                            </DefinitionList>
                            {snapshot?.usage?.sources.length ? (
                                <SpacedBlock>
                                    <strong>Telemetry sources</strong>
                                    <EvidenceList>
                                        {snapshot.usage.sources.map((source) => (
                                            <li key={source.sourceId}>
                                                {source.label}: {source.coverage};{' '}
                                                {source.sourceEventCount.toLocaleString()} source
                                                events and{' '}
                                                {source.matchedObjectCount.toLocaleString()} matched
                                                objects
                                                {source.warning ? ` — ${source.warning}` : ''}
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
                                <dt>Support baseline</dt>
                                <dd>Splunk Enterprise 10.2.5 or later; see the compatibility policy for exact tested builds.</dd>
                                <dt>Frontend</dt>
                                <dd>Splunk UI Toolkit / React</dd>
                                <dt>App ID</dt>
                                <dd>content_hygiene</dd>
                                <dt>Safety boundary</dt>
                                <dd>Read-only customer content</dd>
                                <dt>Bounded scan limit</dt>
                                <dd>100 records per collector</dd>
                                <dt>Complete scan cap</dt>
                                <dd>10,000 records per collector</dd>
                                <dt>Execution model</dt>
                                <dd>Explicit, browser-session scan</dd>
                                <dt>Interaction coverage</dt>
                                <dd>Declared navigation/workflow targets only. No link, field token or workflow search is executed.</dd>
                            </DefinitionList>
                        </CardBody>
                    </Card>
                </TwoColumnGrid>
            </SpacedBlock>

            {displayedScan && Object.keys(displayedScan.collectorCounts).length > 0 ? (
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
                                        <th scope="col">Collected native entries</th>
                                        <th scope="col">Visible native entries</th>
                                        <th scope="col">Normalized records</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Object.entries(displayedScan.collectorCounts).map(
                                        ([collector, count]) => (
                                            <tr key={collector}>
                                                <td>{collector === 'tag_bindings' ? 'tag binding stanzas' : collector.replace(/_/g, ' ')}</td>
                                                <td>{displayedScan.collectorNativeCounts?.[collector]?.toLocaleString() ?? '—'}</td>
                                                <td>
                                                    {(
                                                        displayedScan.collectorTotals[collector] ??
                                                        count
                                                    ).toLocaleString()}
                                                </td>
                                                <td>{count.toLocaleString()}</td>
                                            </tr>
                                        ),
                                    )}
                                </tbody>
                            </Table>
                        </TableScroller>
                        <CardBody>
                            Native entries and normalized records are different units: a tag stanza can produce several assignment objects. Private or unsupported entries are excluded from the shared inventory. Earlier snapshots did not record native-entry counts.
                        </CardBody>
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
