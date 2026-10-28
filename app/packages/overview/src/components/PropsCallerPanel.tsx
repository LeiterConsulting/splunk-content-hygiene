import React, { useState } from 'react';
import CollapsiblePanel from '@splunk/react-ui/CollapsiblePanel';
import Link from '@splunk/react-ui/Link';
import { ButtonRow, CompositionPagination, EvidenceList, FilterField, Input, SmallText, StyledButton, WrappingEvidenceSection } from '../AppStyles';
import { PropsCallerWitness } from '../types';
import { propsCallerKey } from '../services/propsCallerScopes';
import { readQueryParam, viewPath } from '../utils/navigation';

const PAGE_SIZE = 4;
/** A cached evidence receipt, not a new live query or proof of execution. */
export function PropsCallerPanel({ rows }: { rows: PropsCallerWitness[] }): React.ReactElement {
    const [filter, setFilter] = useState(''); const [page, setPage] = useState(0);
    const query = filter.trim().toLowerCase();
    const matches = rows.filter(row => !query || [row.callerObjectId, row.app, row.sourceLocation, ...row.selectors.map(item => `${item.field}=${item.value}`)]
        .some(value => value.toLowerCase().includes(query)));
    const last = Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1); const current = Math.min(page, last);
    const displayed = matches.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
    return <WrappingEvidenceSection aria-label="Captured caller conjunctions">
        <CollapsiblePanel appearance="subtle" title={`Inspect supporting callers (${rows.length})`}>
            <SmallText>Each receipt is one original-event query in one fixed app context. Both declaration scopes matched that query&apos;s exact selectors. Independent panels and searches are never combined. These are declared possibilities, not observed events or execution.</SmallText>
            <FilterField>Find supporting caller<Input value={filter} onChange={event => { setFilter(event.currentTarget.value); setPage(0); }} placeholder="Caller, app, query location or selector" /></FilterField>
            <EvidenceList aria-label="Supporting caller evidence">{displayed.map(row => <li key={propsCallerKey(row)}>
                <Link to={viewPath('dependencies', { object: row.callerObjectId, scan: readQueryParam('scan'), tab: 'object' })}>{row.callerObjectId}</Link>
                <SmallText>Caller app: {row.app} · Query location: {row.sourceLocation}</SmallText>
                <SmallText>Declared conjunction: {row.selectors.map(item => `${item.field}=${item.value}`).join(' AND ')}</SmallText>
                <SmallText>Selector locations: {row.selectors.map(item => `${item.field} at ${item.sourceLocation}`).join('; ')}</SmallText>
            </li>)}</EvidenceList>
            {!matches.length ? <SmallText role="status">No supporting callers match this filter.</SmallText> : null}
            <CompositionPagination aria-label="Supporting caller pages">
                <SmallText role="status">{matches.length ? `${current * PAGE_SIZE + 1}–${Math.min((current + 1) * PAGE_SIZE, matches.length)} of ${matches.length} matching supporting callers` : '0 matching supporting callers'}</SmallText>
                <ButtonRow><StyledButton disabled={current === 0} onClick={() => setPage(current - 1)}>Previous supporting callers</StyledButton>
                    <StyledButton disabled={current >= last} onClick={() => setPage(current + 1)}>Next supporting callers</StyledButton></ButtonRow>
            </CompositionPagination>
        </CollapsiblePanel>
    </WrappingEvidenceSection>;
}
