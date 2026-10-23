import React, { useState } from 'react';
import {
    ButtonRow,
    DefinitionList,
    FilterField,
    InlineNotice,
    Select,
    SmallText,
    StatusPill,
    StyledButton,
    Table,
    TableScroller,
} from '../AppStyles';
import { ReviewFreshness, reviewValidityLabels, ReviewValidity } from '../services/reviewEvidence';
import { HealthStatus } from '../types';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { ResultPagination } from './ResultPagination';
import { ReviewCoveragePanel } from './ReviewCoveragePanel';

const statusColors: Record<ReviewValidity, HealthStatus> = {
    current: 'active',
    needs_review: 'dormant',
    cannot_verify: 'unknown',
    unreviewed: 'unknown',
};
const changeLabels = {
    new: 'Newly observed',
    no_longer_observed: 'No longer observed',
    changed: 'Evidence changed',
};

export function ReviewFreshnessBadge({ status }: { status: ReviewValidity }): React.ReactElement {
    return <StatusPill $status={statusColors[status]}>{reviewValidityLabels[status]}</StatusPill>;
}

export function ReviewFreshnessPanel({
    objectId,
    comparison,
    onDrillTo,
    canDrillTo,
}: {
    objectId: string;
    comparison: ReviewFreshness;
    onDrillTo: (id: string) => void;
    canDrillTo: (id: string) => boolean;
}): React.ReactElement {
    const [page, setPage] = useState(0);
    const [filter, setFilter] = useState('all');
    const [showAllLimits, setShowAllLimits] = useState(false);
    const rows = comparison.relationships.filter((row) => filter === 'all' || row.kind === filter);
    const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 10) - 1));
    return (
        <section aria-label="Changes since review">
            <ButtonRow>
                <strong>Review evidence</strong>
                <ReviewFreshnessBadge status={comparison.status} />
            </ButtonRow>
            <SmallText>
                Evidence status is separate from your saved decision. Current means unchanged within
                supported inventory coverage, not safe to remove or live verification.
            </SmallText>
            <ReviewCoveragePanel current={comparison.current?.coverage} baseline={comparison.baseline?.evidence.coverage}
                canDrillTo={canDrillTo} onDrillTo={onDrillTo} />
            <DefinitionList>
                <dt>Evidence captured</dt>
                <dd>
                    {comparison.baseline
                        ? `${comparison.baseline.capturedAt} by ${comparison.baseline.capturedBy}`
                        : 'No supported baseline'}
                </dd>
                <dt>Baseline scan</dt>
                <dd>{comparison.baseline?.evidence.scanId ?? 'Not captured'}</dd>
                <dt>Compared scan</dt>
                <dd>{comparison.comparedScanId ?? 'Unavailable'}</dd>
            </DefinitionList>
            <ul>
                {comparison.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                ))}
            </ul>
            {comparison.limitations.length ? (
                <InlineNotice>
                    <strong>Verification limits</strong>
                    <ul>
                        {(showAllLimits ? comparison.limitations : comparison.limitations.slice(0, 4)).map((reason) => (
                            <li key={reason}>{reason}</li>
                        ))}
                    </ul>
                    {comparison.limitations.length > 4 ? <StyledButton type="button" aria-expanded={showAllLimits}
                        onClick={() => setShowAllLimits(!showAllLimits)}>{showAllLimits ? 'Show fewer limits' : `Show all ${comparison.limitations.length} limits`}</StyledButton> : null}
                </InlineNotice>
            ) : null}
            <SmallText>
                Fingerprints cover returned configuration and parsed direct relationships, not
                lookup contents, external callers, scripts, or unsupported dynamic references.
                Changes to those require separate investigation. No longer observed never means
                deleted.
            </SmallText>
            <ButtonRow>
                <StyledButton
                    onClick={() =>
                        downloadJson('content-hygiene-review-changes.json', {
                            exportedAt: new Date().toISOString(),
                            objectId,
                            ...comparison,
                        })
                    }
                >
                    Export review evidence JSON
                </StyledButton>
                <StyledButton
                    onClick={() =>
                        downloadCsv(
                            'content-hygiene-review-changes.csv',
                            [
                                'Object ID',
                                'Review evidence status',
                                'Baseline scan',
                                'Compared scan',
                                'Kind',
                                'Related object ID',
                                'Direction',
                                'Relation',
                                'Before confidence',
                                'Now confidence',
                                'Before resolved',
                                'Now resolved',
                                'Before source',
                                'Now source',
                                'Summary',
                                'Limits',
                                'Coverage policy', 'Configuration coverage', 'ACL coverage', 'Outbound coverage', 'Inbound coverage',
                            ],
                            (rows.length ? rows : [null]).map((row) => [
                                objectId,
                                comparison.status,
                                comparison.baseline?.evidence.scanId ?? '',
                                comparison.comparedScanId,
                                row?.kind ?? 'summary',
                                row?.after?.objectId ?? row?.before?.objectId ?? '',
                                row?.after?.direction ?? row?.before?.direction ?? '',
                                row?.after?.relation ?? row?.before?.relation ?? '',
                                row?.before?.confidence ?? '',
                                row?.after?.confidence ?? '',
                                row?.before?.resolved ?? '',
                                row?.after?.resolved ?? '',
                                row?.before?.sourceLocation ?? '',
                                row?.after?.sourceLocation ?? '',
                                comparison.reasons.join('; '),
                                comparison.limitations.join('; '),
                                comparison.current?.coverage?.policy ?? 'legacy-unscoped',
                                comparison.current?.coverage?.configuration.status ?? 'unavailable',
                                comparison.current?.coverage?.access.status ?? 'unavailable',
                                comparison.current?.coverage?.outbound.status ?? 'unavailable',
                                comparison.current?.coverage?.inbound.status ?? 'unavailable',
                            ]),
                        )
                    }
                >
                    Export filtered changes CSV
                </StyledButton>
            </ButtonRow>
            {comparison.relationships.length ? (
                <>
                    <FilterField>
                        Relationship changes
                        <Select
                            value={filter}
                            onChange={(event) => {
                                setFilter(event.currentTarget.value);
                                setPage(0);
                            }}
                        >
                            <option value="all">All recorded changes</option>
                            {Object.entries(changeLabels).map(([value, label]) => (
                                <option key={value} value={value}>
                                    {label}
                                </option>
                            ))}
                        </Select>
                    </FilterField>
                    <ResultPagination
                        page={currentPage}
                        pageSize={10}
                        total={rows.length}
                        onChange={setPage}
                    />
                    <TableScroller>
                        <Table>
                            <thead>
                                <tr>
                                    <th scope="col">Change / object</th>
                                    <th scope="col">Relationship evidence</th>
                                    <th scope="col">Investigate</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.slice(currentPage * 10, currentPage * 10 + 10).map((row) => {
                                    const item = (row.after ?? row.before)!;
                                    return (
                                        <tr key={item.key}>
                                            <td>
                                                {changeLabels[row.kind]}
                                                <div>{item.name}</div>
                                            </td>
                                            <td>
                                                {item.direction} ·{' '}
                                                {item.relation.replace(/_/g, ' ')}
                                                <div>
                                                    Confidence:{' '}
                                                    {row.before?.confidence ?? 'Not observed'} →{' '}
                                                    {row.after?.confidence ?? 'Not observed'}
                                                </div>
                                                <div>
                                                    Resolved:{' '}
                                                    {row.before
                                                        ? String(row.before.resolved)
                                                        : 'Not observed'}{' '}
                                                    →{' '}
                                                    {row.after
                                                        ? String(row.after.resolved)
                                                        : 'Not observed'}
                                                </div>
                                                <SmallText>{item.sourceLocation}</SmallText>
                                                {row.before &&
                                                row.after &&
                                                row.before.neighborDigest !==
                                                    row.after.neighborDigest ? (
                                                    <div>
                                                        Adjacent object configuration or access
                                                        changed.
                                                    </div>
                                                ) : null}
                                                {row.before &&
                                                row.after &&
                                                row.before.evidenceDigest !==
                                                    row.after.evidenceDigest ? (
                                                    <div>Source relationship evidence changed.</div>
                                                ) : null}
                                            </td>
                                            <td>
                                                <StyledButton
                                                    disabled={!canDrillTo(item.objectId)}
                                                    onClick={() => onDrillTo(item.objectId)}
                                                >
                                                    Investigate object
                                                </StyledButton>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </Table>
                    </TableScroller>
                </>
            ) : null}
        </section>
    );
}
