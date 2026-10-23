import React from 'react';
import { RowButton, SmallText, StatusPill, Table, TableScroller } from '../AppStyles';
import { EvidenceCoverageDimension, ReviewCoverage } from '../types';

const areas = [
    ['configuration', 'Returned configuration'], ['access', 'Returned ACL'],
    ['outbound', 'Declared outbound references'], ['inbound', 'Potential inbound references'],
] as const;

function CoverageBadge({ area }: { area?: EvidenceCoverageDimension }): React.ReactElement {
    if (!area) { return <span>Not scoped</span>; }
    const labels = { complete: 'Within declared scope', partial: 'Partial', unavailable: 'Unavailable' };
    return <StatusPill $status={area.status === 'complete' ? 'active' : 'unknown'}>
        {labels[area.status]}
    </StatusPill>;
}

export function ReviewCoveragePanel({ current, baseline, onDrillTo, canDrillTo }: {
    current?: ReviewCoverage;
    baseline?: ReviewCoverage;
    onDrillTo: (id: string) => void;
    canDrillTo: (id: string) => boolean;
}): React.ReactElement {
    return <section aria-label="Object-specific evidence coverage">
        <strong>Object-specific coverage</strong>
        <SmallText>
            Scope: shared objects visible to the scanning identity, supported static references,
            and REST app containment. This is not all runtime behavior or a removal approval.
        </SmallText>
        {!current ? <SmallText>Run a complete scan with this version to obtain scoped coverage.</SmallText> : null}
        <TableScroller><Table><thead><tr><th scope="col">Evidence area</th><th scope="col">At review</th><th scope="col">Now / investigate</th></tr></thead>
            <tbody>{areas.map(([key, label]) => {
                const area = current?.[key];
                return <tr key={key}><td>{label}</td><td><CoverageBadge area={baseline?.[key]} /></td><td>
                    <CoverageBadge area={area} />
                    {area?.reasons.length ? <ul>{area.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
                    {area?.sourceObjectIds.map((id) => <div key={id}><RowButton type="button" disabled={!canDrillTo(id)}
                        aria-label={`Inspect possible reference source ${id}`} onClick={() => onDrillTo(id)}>
                        Inspect possible source: {id}
                    </RowButton></div>)}
                    {area && area.sourceCount > area.sourceObjectIds.length ? <SmallText>
                        {area.sourceCount} relevant uncertain source(s); up to five visible examples are shown. Private identities are never included.
                    </SmallText> : null}
                </td></tr>;
            })}</tbody></Table></TableScroller>
        <SmallText>
            Unknown references propagate only to compatible target types and namespaces. Exported targets
            retain cross-app uncertainty. Missing source catalogs and relevant excluded private sources
            remain unverified; display filters never change this assessment.
        </SmallText>
    </section>;
}
