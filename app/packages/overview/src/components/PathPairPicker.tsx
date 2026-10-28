import React, { useMemo, useState } from 'react';
import { FilterField, Input, Select, SmallText, WrappingEvidenceSection } from '../AppStyles';
import { DependencyIndex } from '../services/dependencyGraph';
import { AlternativePathPanel } from './AlternativePathPanel';
import { ResultPagination } from './ResultPagination';

/** Exact visible identities, never a name-based inferred binding or saved decision. */
export function PathPairPicker({ index, objectId, onInspect }: { index: DependencyIndex; objectId: string; onInspect: (id: string) => void }): React.ReactElement {
    const [query, setQuery] = useState('');
    const [targetId, setTargetId] = useState('');
    const [direction, setDirection] = useState('from');
    const [page, setPage] = useState(0);
    const matches = useMemo(() => [...index.objects.values()].filter(object => object.objectId !== objectId &&
        `${object.name} ${object.app} ${object.objectType} ${object.objectId}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name) || a.objectId.localeCompare(b.objectId)), [index, objectId, query]);
    const currentPage = Math.min(page, Math.max(0, Math.ceil(matches.length / 50) - 1));
    const visible = matches.slice(currentPage * 50, (currentPage + 1) * 50);
    const selected = index.objects.get(targetId);
    return <WrappingEvidenceSection aria-label="Choose dependency path endpoints">
        <SmallText>Investigate a directed path involving this reviewed object without changing its decision. Choose exact cached endpoints; no relationship is inferred from matching names.</SmallText>
        <FilterField>Path direction<Select value={direction} onChange={event => setDirection(event.currentTarget.value)}>
            <option value="from">From this object to another object</option><option value="to">From another object to this object</option>
        </Select></FilterField>
        <FilterField>Find other endpoint<Input value={query} onChange={event => { setQuery(event.currentTarget.value); setPage(0); }} placeholder="Name, type, app or exact identity" /></FilterField>
        <ResultPagination page={currentPage} pageSize={50} total={matches.length} onChange={setPage} />
        <FilterField>Other endpoint<Select value={targetId} onChange={event => setTargetId(event.currentTarget.value)}>
            <option value="">Choose an exact object</option>
            {selected && !visible.some(item => item.objectId === targetId) ? <option value={targetId}>{selected.name} · {selected.objectType} · {selected.app}</option> : null}
            {visible.map(object => <option key={object.objectId} value={object.objectId}>{object.name} · {object.objectType} · {object.app} · {object.objectId}</option>)}
        </Select></FilterField>
        {selected ? <><SmallText>Other endpoint: {selected.objectId}</SmallText><AlternativePathPanel
            key={`${direction}:${objectId}:${targetId}`} index={index} sourceId={direction === 'from' ? objectId : targetId} targetId={direction === 'from' ? targetId : objectId}
            baselineEdgeIds={[]} onInspect={onInspect} /></> : <SmallText>Select an endpoint to begin an explicit bounded comparison.</SmallText>}
    </WrappingEvidenceSection>;
}
