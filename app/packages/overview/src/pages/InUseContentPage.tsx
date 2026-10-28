import React, { useContext, useMemo, useState } from 'react';
import Checkbox from '@splunk/react-ui/Checkbox';
import { AppPolicyContext } from '../components/AppPolicyContext';
import {
    ButtonRow,
    Card,
    CardHeader,
    CardTitle,
    DetailTitle,
    EmptyState,
    EvidenceList,
    FactGrid,
    FilterBar,
    FilterField,
    InlineNotice,
    Input,
    MetricGrid,
    RowButton,
    Select,
    StyledButton,
    Table,
    TableScroller,
} from '../AppStyles';
import { ExportMenu } from '../components/ExportMenu';
import { PageHeader } from '../components/PageHeader';
import { ResultPagination } from '../components/ResultPagination';
import { SummaryMetric } from '../components/SummaryMetric';
import { useEvidenceClock } from '../components/useEvidenceClock';
import { useReviewNavigation } from '../components/ReviewNavigationContext';
import { useSelectionFocus } from '../components/useSelectionFocus';
import { PathContextDetails } from '../components/PathContextDetails';
import { AlternativePathPanel } from '../components/AlternativePathPanel';
import { buildDependencyIndex } from '../services/dependencyGraph';
import {
    buildInUseReport,
    InUseOptions,
    InUseReport,
    InUseRow,
    inUsePath,
} from '../services/inUseContent';
import { InventorySnapshot, ReviewRecord } from '../types';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { navigateToView, readQueryParam } from '../utils/navigation';

function reasonLabel(row: InUseRow): string {
    return (
        row.reasons
            .map((reason) => {
                if (reason.kind === 'observed') {
                    return 'Activity observed';
                }
                if (reason.kind === 'retained') {
                    return 'Retained by review';
                }
                if (reason.kind === 'app_policy') { return 'Retained by app policy'; }
                return 'Explicit starting object';
            })
            .join(' + ') ||
        `${row.via?.conditional ? 'Potential requirement' : 'Required by a starting object'} (${row.via?.confidence ?? 'unknown'} witness confidence)`
    );
}
function exportRows(report: InUseReport, rows: InUseRow[], scope: string): void {
    downloadCsv(
        `content-hygiene-required-${scope}.csv`,
        [
            'Object ID',
            'Name',
            'Type',
            'App',
            'Owner',
            'Sharing',
            'In current inventory',
            'Why included',
            'Reason details',
            'Root object ID',
            'Required by object ID',
            'Relation',
            'Depth',
            'Witness path confidence',
            'Witness contains potential implicit dependency',
            'Observations',
            'Last observed',
            'Usage run ID',
            'Usage window ended',
            'Usage coverage',
            'Usage validity',
            'Retain reviewer',
            'Retain date',
            'Retain evidence status',
            'Outbound coverage',
            'Inventory scan ID',
            'Report coverage',
            'Traversal truncated',
            'Scope limitations',
            'Declared field facts', 'Field witness provenance',
            'Policy-derived retention (not an individual decision)',
            'Chosen witness path context',
        ],
        rows.map((row) => {
            const retained = row.reasons.find((reason) => reason.kind === 'retained');
            return [
                row.objectId,
                row.name,
                row.objectType,
                row.app,
                row.owner,
                row.sharing,
                row.inInventory,
                reasonLabel(row),
                row.reasons.map((reason) => reason.detail).join(' | '),
                row.via?.rootId ?? row.objectId,
                row.via?.parentId ?? '',
                row.via?.relation ?? '',
                row.via?.depth ?? 0,
                row.via?.confidence ?? '',
                row.via?.conditional ?? false,
                row.usage?.observationCount ?? '',
                row.usage?.lastObserved ?? '',
                row.usage?.usageRunId ?? '',
                row.usage?.windowEnd ?? '',
                row.usage?.coverage ?? 'not measured',
                row.usageValidity,
                retained?.reviewer ?? '',
                retained?.reviewedAt ?? '',
                retained?.evidenceStatus ?? '',
                row.outboundCoverage,
                report.scanId,
                report.coverage,
                report.truncated,
                'Shared static footprint only; potential props paths are conditional, not proof of execution. Other implicit, private, dynamic and ad-hoc consumers remain unverified. Export coverage CSV or full JSON for diagnostics.',
                row.fieldLineage ? JSON.stringify(row.fieldLineage) : '',
                row.via?.fieldProvenance ? JSON.stringify(row.via.fieldProvenance) : '',
                JSON.stringify(row.reasons.filter(reason => reason.kind === 'app_policy')),
                row.via ? JSON.stringify(row.via.pathContext) : '',
            ];
        }),
    );
}

export function InUseContentPage({
    snapshot,
    isLoading,
    reviews,
    reviewsVerified,
}: {
    snapshot: InventorySnapshot | null;
    isLoading: boolean;
    reviews: ReviewRecord[];
    reviewsVerified: boolean;
}): React.ReactElement {
    const { navigate } = useReviewNavigation();
    const policies = useContext(AppPolicyContext);
    const now = useEvidenceClock();
    const [mode, setMode] = useState(readQueryParam('object') ? 'selected' : 'evidence');
    const [startIds, setStartIds] = useState<string[]>(() =>
        readQueryParam('object') ? [readQueryParam('object')] : [],
    );
    const [activity, setActivity] = useState<InUseOptions['activity']>(
        readQueryParam('activity') === 'none' ? 'none' : 'all',
    );
    const [includeRetained, setIncludeRetained] = useState(true);
    const [successfulOnly, setSuccessfulOnly] = useState(false);
    const [findStart, setFindStart] = useState('');
    const [pickerId, setPickerId] = useState('');
    const [type, setType] = useState('all');
    const [app, setApp] = useState('all');
    const [query, setQuery] = useState('');
    const [filterNotice, setFilterNotice] = useState('');
    const [page, setPage] = useState(0);
    const [inspectedId, setInspectedId] = useState('');
    const [requestedScanId] = useState(() => readQueryParam('scan'));
    const pathIndex = useMemo(() => snapshot ? buildDependencyIndex(snapshot.objects, snapshot.edges) : null, [snapshot]);
    const report = useMemo(
        () =>
            snapshot
                ? buildInUseReport(
                      snapshot,
                      reviews,
                      {
                          activity,
                          includeRetained,
                          successfulOnly,
                          ...(mode === 'selected' ? { selectedIds: startIds } : {}),
                      },
                      now,
                      reviewsVerified,
                      policies.store,
                  )
                : null,
        [
            snapshot,
            reviews,
            activity,
            includeRetained,
            successfulOnly,
            mode,
            startIds,
            now,
            reviewsVerified,
            policies.store,
        ],
    );
    const objects = useMemo(
        () => new Map(snapshot?.objects.map((object) => [object.objectId, object]) ?? []),
        [snapshot],
    );
    const rows = useMemo(
        () => new Map(report?.rows.map((row) => [row.objectId, row]) ?? []),
        [report],
    );
    const matches = useMemo(
        () =>
            (snapshot?.objects ?? [])
                .filter((object) =>
                    `${object.name} ${object.app} ${object.objectType}`
                        .toLowerCase()
                        .includes(findStart.trim().toLowerCase()),
                )
                .slice(0, 200),
        [snapshot, findStart],
    );
    const typeOptions = useMemo(() => Object.keys(report?.groups ?? {}), [report]);
    const appOptions = useMemo(
        () => [...new Set(report?.rows.map((row) => row.app) ?? [])].sort(),
        [report],
    );
    // Adjust only invalid selections before committing the new report. A
    // loading/null snapshot is not evidence that a filter option disappeared.
    // Clearing the stored selection also prevents it silently returning later.
    if (report && !isLoading) {
        const invalidType = type !== 'all' && !typeOptions.includes(type);
        const invalidApp = app !== 'all' && !appOptions.includes(app);
        if (invalidType || invalidApp) {
            if (invalidType) {
                setType('all');
            }
            if (invalidApp) {
                setApp('all');
            }
            setPage(0);
            setFilterNotice(
                `Included ${invalidType && invalidApp ? 'type and app filters were' : `${invalidType ? 'type' : 'app'} filter was`} reset to All because ${invalidType && invalidApp ? 'those options are' : 'that option is'} not in the current footprint. Starting objects and dependency traversal are unchanged.`,
            );
        }
    }
    const filtered = (report?.rows ?? []).filter(
        (row) =>
            (type === 'all' || row.objectType === type) &&
            (app === 'all' || row.app === app) &&
            `${row.name} ${row.app} ${row.objectId}`
                .toLowerCase()
                .includes(query.trim().toLowerCase()),
    );
    const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 50) - 1));
    const inspected = rows.get(inspectedId);
    const { detailTitle, listTitle } = useSelectionFocus(inspected?.objectId);
    const path = report && inspected ? inUsePath(report, inspected.objectId) : null;
    return (
        <>
            <PageHeader
                title="In-use & required content"
                subtitle="Observed activity, individual Retain decisions, app-wide policies, and their supported outbound requirements. Customer content stays read-only."
                actions={
                    <ExportMenu
                        label="Export required-content report"
                        disabled={!report || isLoading}
                        items={[
                            {
                                label: 'Full footprint and coverage JSON',
                                onClick: () => {
                                    if (report) {
                                        downloadJson(
                                            'content-hygiene-required-content.json',
                                            report,
                                        );
                                    }
                                },
                            },
                            {
                                label: 'All included objects CSV (partial scope)',
                                onClick: () => {
                                    if (report) {
                                        exportRows(report, report.rows, 'all');
                                    }
                                },
                            },
                            {
                                label: 'Displayed results CSV (filtered scope)',
                                onClick: () => {
                                    if (report) {
                                        exportRows(report, filtered, 'filtered');
                                    }
                                },
                            },
                            {
                                label: 'Coverage and limitations CSV',
                                onClick: () => {
                                    if (report) {
                                        downloadCsv(
                                            'content-hygiene-required-coverage.csv',
                                            [
                                                'Inventory scan ID',
                                                'Coverage',
                                                'Truncated',
                                                'Limitation',
                                            ],
                                            report.gaps.map((gap) => [
                                                report.scanId,
                                                report.coverage,
                                                report.truncated,
                                                gap,
                                            ]),
                                        );
                                    }
                                },
                            },
                        ]}
                    />
                }
            />
            <FilterBar
                aria-label="Required-content starting set"
                onSubmit={(event) => event.preventDefault()}
            >
                <FilterField>
                    Starting set
                    <Select
                        value={mode}
                        onChange={(event) => {
                            setMode(event.currentTarget.value);
                            setPage(0);
                        }}
                    >
                        <option value="evidence">Observed activity and Retain decisions</option>
                        <option value="selected">Explicitly selected objects</option>
                    </Select>
                </FilterField>
                {mode === 'evidence' ? (
                    <>
                        <FilterField>
                            Activity kinds
                            <Select
                                value={activity}
                                onChange={(event) => {
                                    setActivity(
                                        event.currentTarget.value as InUseOptions['activity'],
                                    );
                                    setPage(0);
                                }}
                            >
                                <option value="all">
                                    Dashboard views and saved-search executions
                                </option>
                                <option value="dashboard_view">Dashboard views only</option>
                                <option value="saved_search_execution">
                                    Saved-search executions only
                                </option>
                                <option value="none">No activity roots (Retain only)</option>
                            </Select>
                        </FilterField>
                        <Checkbox
                            checked={includeRetained}
                            onChange={(_event, data) => setIncludeRetained(data.checked)}
                        >
                            Include active Retain decisions and app policies
                        </Checkbox>
                        <Checkbox
                            checked={successfulOnly}
                            onChange={(_event, data) => setSuccessfulOnly(data.checked)}
                        >
                            Require successful saved-search executions
                        </Checkbox>
                    </>
                ) : (
                    <>
                        <FilterField>
                            Find starting object
                            <Input
                                type="search"
                                value={findStart}
                                placeholder="Name, app, or type"
                                onChange={(event) => {
                                    setFindStart(event.currentTarget.value);
                                    setPickerId('');
                                }}
                            />
                        </FilterField>
                        <FilterField>
                            Starting object
                            <Select
                                value={pickerId}
                                onChange={(event) => setPickerId(event.currentTarget.value)}
                            >
                                <option value="" disabled>
                                    Choose an exact starting object
                                </option>
                                {matches.map((object) => (
                                    <option key={object.objectId} value={object.objectId}>
                                        {object.name} · {object.objectType} · {object.app}
                                    </option>
                                ))}
                            </Select>
                        </FilterField>
                        <StyledButton
                            disabled={!objects.has(pickerId) || startIds.includes(pickerId)}
                            onClick={() => {
                                setStartIds((current) => [...current, pickerId]);
                                setPickerId('');
                                setPage(0);
                            }}
                        >
                            Add starting object
                        </StyledButton>
                    </>
                )}
            </FilterBar>
            <div role="status" aria-live="polite" aria-atomic="true">
                {filterNotice ? <InlineNotice>{filterNotice}</InlineNotice> : null}
            </div>
            {mode === 'selected' ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Explicit starting objects</CardTitle>
                    </CardHeader>
                    <ButtonRow>
                        {startIds.map((id) => (
                            <StyledButton
                                key={id}
                                onClick={() =>
                                    setStartIds((current) => current.filter((item) => item !== id))
                                }
                            >
                                Remove {objects.get(id)?.name ?? id}
                            </StyledButton>
                        ))}
                        {!startIds.length ? (
                            <p>
                                Choose a starting object. No unrelated object is selected
                                automatically.
                            </p>
                        ) : null}
                        <p>
                            Picker shows up to 200 matches; refine the search. Explicit selection
                            does not claim observed activity.
                        </p>
                    </ButtonRow>
                </Card>
            ) : (
                <p>
                    Only current, attributable observations count. Saved-search telemetry does not
                    distinguish scheduled from manual saved-search executions. Historical activity
                    is not silently reused.
                </p>
            )}
            <InlineNotice role="status">
                <strong>
                    {report?.truncated
                        ? 'Truncated footprint — incomplete results'
                        : 'Partial coverage — not a migration manifest'}
                </strong>
                <p>
                    Absence from this report is not proof of inactivity or removal eligibility.
                    Individual Retain and app-policy retention are separate from observed usage. Review the coverage and
                    limitations below before relying on this list.
                </p>
            </InlineNotice>
            {report && requestedScanId && requestedScanId !== report.scanId ? (
                <InlineNotice role="status">
                    <strong>Inventory changed since the originating investigation</strong>
                    <p>
                        The link came from scan {requestedScanId}; this report uses {report.scanId}.
                        Explicit starting identities are preserved; missing definitions are
                        disclosed rather than substituted.
                    </p>
                </InlineNotice>
            ) : null}
            {report ? (
                <>
                    <MetricGrid aria-label="Required-content summary">
                        <SummaryMetric
                            label="Starting objects"
                            value={String(report.rootCount)}
                            hint="Deduplicated observed, retained, or explicit roots"
                        />
                        <SummaryMetric
                            label="Included identities"
                            value={String(report.rows.length)}
                            hint="Roots plus every traversed supported dependency"
                        />
                        <SummaryMetric
                            label="Traversed references"
                            value={String(report.relationships.length)}
                            hint="Outbound only; containment is excluded"
                        />
                        <SummaryMetric
                            label="Coverage limitations"
                            value={String(report.gaps.length)}
                            hint="Explicit gaps, not hidden exclusions"
                        />
                    </MetricGrid>
                    <Card>
                        <CardHeader>
                            <CardTitle>Included content by type</CardTitle>
                        </CardHeader>
                        <ButtonRow>
                            {Object.entries(report.groups).map(([group, count]) => (
                                <StyledButton
                                    key={group}
                                    onClick={() => {
                                        setFilterNotice('');
                                        setType(group);
                                        setPage(0);
                                        setInspectedId('');
                                    }}
                                >
                                    {group}: {count}
                                </StyledButton>
                            ))}
                        </ButtonRow>
                    </Card>
                    {inspected ? (
                        <Card>
                            <ButtonRow>
                                <StyledButton onClick={() => setInspectedId('')}>
                                    Back to required-content results
                                </StyledButton>
                                <StyledButton
                                    disabled={!inspected.inInventory}
                                    onClick={() =>
                                        navigate(() =>
                                            navigateToView('dependencies', {
                                                object: inspected.objectId,
                                                scan: report.scanId,
                                            }),
                                        )
                                    }
                                >
                                    Explore dependencies
                                </StyledButton>
                                {inspected.reasons.some((reason) => reason.kind === 'retained') ? (
                                    <StyledButton
                                        onClick={() =>
                                            navigate(() =>
                                                navigateToView('reviews', {
                                                    object: inspected.objectId,
                                                }),
                                            )
                                        }
                                    >
                                        Open Retain decision
                                    </StyledButton>
                                ) : null}
                            </ButtonRow>
                            <DetailTitle ref={detailTitle} tabIndex={-1}>
                                {inspected.name}
                            </DetailTitle>
                            <p>
                                {inspected.objectType} · {inspected.app} · {reasonLabel(inspected)}
                            </p>
                            <FactGrid>
                                <div>
                                    <dt>Owner</dt>
                                    <dd>{inspected.owner ?? 'Shared / unknown'}</dd>
                                </div>
                                <div>
                                    <dt>Sharing</dt>
                                    <dd>{inspected.sharing ?? 'Unknown'}</dd>
                                </div>
                                <div>
                                    <dt>In current inventory</dt>
                                    <dd>
                                        {inspected.inInventory
                                            ? 'Yes'
                                            : 'No — historical or unresolved identity'}
                                    </dd>
                                </div>
                                <div>
                                    <dt>Outbound coverage</dt>
                                    <dd>{inspected.outboundCoverage}</dd>
                                </div>
                                <div>
                                    <dt>Witness applicability</dt>
                                    <dd>{inspected.via?.conditional ? 'Potential implicit dependency — not observed execution' : 'Supported configuration path or explicit starting object'}</dd>
                                </div>
                            </FactGrid>
                            <EvidenceList>
                                {inspected.reasons.map((reason) => (
                                    <li key={reason.kind}>
                                        {reason.detail}
                                        {reason.kind === 'retained' || reason.kind === 'app_policy'
                                            ? ` Reviewer: ${reason.reviewer}; date: ${reason.reviewedAt}; review evidence: ${reason.evidenceStatus?.replace(/_/g, ' ')}.`
                                            : ''}
                                    </li>
                                ))}
                            </EvidenceList>
                            {path ? (
                                <>
                                    <h3>One supported witness path</h3>
                                    {inspected.via ? <PathContextDetails context={inspected.via.pathContext} /> : null}
                                    {inspected.via && pathIndex ? <AlternativePathPanel index={pathIndex} sourceId={inspected.via.rootId} targetId={inspected.objectId}
                                        baselineEdgeIds={path.ids.slice(1).map(id => rows.get(id)?.via?.edgeId ?? '')} onInspect={setInspectedId} /> : null}
                                    {path.truncated ? (
                                        <InlineNotice>
                                            Only the last 100 identities are shown. Root:{' '}
                                            {inspected.via?.rootId}. The full adjacency is preserved
                                            in JSON and parent/root columns in CSV.
                                        </InlineNotice>
                                    ) : null}
                                    <EvidenceList>
                                        {path.ids.map((id) => (
                                            <li key={id}>
                                                <RowButton onClick={() => setInspectedId(id)}>
                                                    {rows.get(id)?.name ?? id}
                                                </RowButton>{' '}
                                                · {id}
                                                {rows.get(id)?.via
                                                    ? ` · ${rows.get(id)?.via?.relation}`
                                                    : ' · starting object'}
                                            </li>
                                        ))}
                                    </EvidenceList>
                                </>
                            ) : null}
                            <h3>Declared-outbound coverage</h3>
                            <EvidenceList>
                                {inspected.outboundLimitations.map((limitation) => (
                                    <li key={limitation}>{limitation}</li>
                                ))}
                            </EvidenceList>
                        </Card>
                    ) : (
                        <>
                            <FilterBar
                                aria-label="Required-content display filters"
                                onSubmit={(event) => event.preventDefault()}
                            >
                                <FilterField>
                                    Find included object
                                    <Input
                                        type="search"
                                        value={query}
                                        onChange={(event) => {
                                            setFilterNotice('');
                                            setQuery(event.currentTarget.value);
                                            setPage(0);
                                        }}
                                    />
                                </FilterField>
                                <FilterField>
                                    Included type
                                    <Select
                                        value={type}
                                        onChange={(event) => {
                                            setFilterNotice('');
                                            setType(event.currentTarget.value);
                                            setPage(0);
                                        }}
                                    >
                                        <option value="all">All types</option>
                                        {typeOptions.map((group) => (
                                            <option key={group} value={group}>
                                                {group}
                                            </option>
                                        ))}
                                    </Select>
                                </FilterField>
                                <FilterField>
                                    Included app
                                    <Select
                                        value={app}
                                        onChange={(event) => {
                                            setFilterNotice('');
                                            setApp(event.currentTarget.value);
                                            setPage(0);
                                        }}
                                    >
                                        <option value="all">All apps</option>
                                        {appOptions.map((name) => (
                                            <option key={name} value={name}>
                                                {name}
                                            </option>
                                        ))}
                                    </Select>
                                </FilterField>
                                <StyledButton
                                    onClick={() => {
                                        setFilterNotice('');
                                        setType('all');
                                        setApp('all');
                                        setQuery('');
                                        setPage(0);
                                    }}
                                >
                                    Clear display filters
                                </StyledButton>
                            </FilterBar>
                            <p>
                                Display filters do not change the dependency closure. Exports
                                identify full versus filtered scope.
                            </p>
                            <Card>
                                <CardHeader>
                                    <CardTitle ref={listTitle} tabIndex={-1}>
                                        {filtered.length} included identities
                                    </CardTitle>
                                    <ResultPagination
                                        page={currentPage}
                                        pageSize={50}
                                        total={filtered.length}
                                        onChange={setPage}
                                    />
                                </CardHeader>
                                {filtered.length ? (
                                    <TableScroller>
                                        <Table>
                                            <thead>
                                                <tr>
                                                    <th>Object</th>
                                                    <th>Type</th>
                                                    <th>App / owner / sharing</th>
                                                    <th>Why included</th>
                                                    <th>Required by</th>
                                                    <th>Coverage</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filtered
                                                    .slice(currentPage * 50, currentPage * 50 + 50)
                                                    .map((row) => (
                                                        <tr key={row.objectId}>
                                                            <td>
                                                                <RowButton
                                                                    onClick={() =>
                                                                        setInspectedId(row.objectId)
                                                                    }
                                                                >
                                                                    {row.name}
                                                                </RowButton>
                                                            </td>
                                                            <td>{row.objectType}</td>
                                                            <td>
                                                                {row.app}
                                                                <div>
                                                                    {row.owner ??
                                                                        'Shared / unknown'}{' '}
                                                                    ·{' '}
                                                                    {row.sharing ??
                                                                        'Unknown sharing'}
                                                                </div>
                                                            </td>
                                                            <td>
                                                                {reasonLabel(row)}
                                                                {row.reasons.map((reason) => (
                                                                    <div key={reason.kind}>
                                                                        {reason.detail}
                                                                    </div>
                                                                ))}
                                                            </td>
                                                            <td>
                                                                {row.via ? (
                                                                    <RowButton
                                                                        onClick={() =>
                                                                            setInspectedId(
                                                                                row.via!.parentId,
                                                                            )
                                                                        }
                                                                    >
                                                                        {rows.get(row.via.parentId)
                                                                            ?.name ??
                                                                            row.via.parentId}
                                                                    </RowButton>
                                                                ) : (
                                                                    'Starting object'
                                                                )}
                                                            </td>
                                                            <td>
                                                                {row.inInventory
                                                                    ? row.outboundCoverage
                                                                    : 'Not in inventory'}
                                                            </td>
                                                        </tr>
                                                    ))}
                                            </tbody>
                                        </Table>
                                    </TableScroller>
                                ) : (
                                    <EmptyState>
                                        <p>
                                            {isLoading
                                                ? 'Loading verified inventory…'
                                                : 'No identities match this starting set and display scope. Collect current usage, include Retain decisions, or explicitly choose starting objects. Missing observations are not evidence of inactivity.'}
                                        </p>
                                    </EmptyState>
                                )}
                            </Card>
                        </>
                    )}
                    <Card>
                        <CardHeader>
                            <CardTitle>Coverage and limitations</CardTitle>
                        </CardHeader>
                        <EvidenceList>
                            {report.gaps.map((gap) => (
                                <li key={gap}>{gap}</li>
                            ))}
                        </EvidenceList>
                        <p>
                            Full JSON includes all diagnostics, parameters, root reasons, and
                            traversed relationships. CSV parent/root IDs preserve a compact witness
                            chain; export coverage CSV alongside object CSV.
                        </p>
                    </Card>
                </>
            ) : (
                <Card>
                    <EmptyState>
                        <p>
                            {isLoading
                                ? 'Loading verified inventory…'
                                : 'No verified snapshot is cached. Run a live scan from Settings.'}
                        </p>
                    </EmptyState>
                </Card>
            )}
        </>
    );
}
