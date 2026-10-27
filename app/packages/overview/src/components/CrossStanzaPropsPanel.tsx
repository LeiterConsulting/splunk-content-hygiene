import React, { useState } from 'react';
import CollapsiblePanel from '@splunk/react-ui/CollapsiblePanel';
import Link from '@splunk/react-ui/Link';
import { ButtonRow, CompositionPagination, EvidenceList, FilterField, Input, Select, SmallText, StyledButton, WrappingEvidenceSection } from '../AppStyles';
import { CrossStanzaPropsEvidence } from '../types';
import { CROSS_STANZA_LIMITATION, crossStanzaReasonLabels, crossStanzaStatusLabels } from '../services/crossStanzaEvidence';
import { readQueryParam, viewPath } from '../utils/navigation';

const PAGE_SIZE = 4;
const objectLink = (id: string): string => viewPath('dependencies', { object: id, scan: readQueryParam('scan'), tab: 'object' });
/** Cache-only, independently scoped contexts; never a global effective winner. */
export function CrossStanzaPropsPanel({ rows, truncated = false }: { rows?: CrossStanzaPropsEvidence[]; truncated?: boolean }): React.ReactElement {
    const [filter, setFilter] = useState(''); const [status, setStatus] = useState('all'); const [page, setPage] = useState(0);
    const query = filter.trim().toLowerCase();
    const matches = (rows ?? []).filter(row => (status === 'all' || row.status === status) && (!query ||
        [row.app, row.attribute, row.objectId, row.callerObjectId, row.sourceLocation, ...row.selectors.map(item => `${item.field}=${item.value}`)]
            .some(value => value.toLowerCase().includes(query))));
    const last = Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1); const current = Math.min(page, last);
    const displayed = matches.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
    return <WrappingEvidenceSection aria-label="Cross-stanza props order">
        <strong>Cross-stanza props order</strong>
        <SmallText>{rows === undefined ? 'Not recorded by this snapshot. Run a new complete scan; saved decisions are unchanged.' :
            `${rows.filter(row => row.status !== 'unverified').length} conditional order observation(s) · ${rows.filter(row => row.status === 'unverified').length} unverified`}</SmallText>
        {truncated ? <SmallText role="status">Cross-stanza evidence reached a work or size ceiling. Additional contexts remain unverified.</SmallText> : null}
        <CollapsiblePanel appearance="subtle" title={`Inspect cross-stanza order (${rows?.length ?? 0})`}>
            <SmallText>{CROSS_STANZA_LIMITATION}</SmallText>
            {rows?.length ? <>
                <ButtonRow>
                    <FilterField>Find cross-stanza context<Input value={filter} onChange={event => { setFilter(event.currentTarget.value); setPage(0); }} placeholder="Caller, app, attribute or selector" /></FilterField>
                    <FilterField>Cross-stanza status<Select value={status} onChange={event => { setStatus(event.currentTarget.value); setPage(0); }}>
                        <option value="all">All order statuses</option>{Object.entries(crossStanzaStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </Select></FilterField>
                </ButtonRow>
                <EvidenceList aria-label="Cross-stanza order observations">{displayed.map(row => <li key={JSON.stringify([row.objectId, row.callerObjectId, row.app, row.attribute, row.sourceLocation])}>
                    <strong>{crossStanzaStatusLabels[row.status]}</strong>
                    <SmallText>{row.app} · {row.attribute} · {row.sourceLocation}</SmallText>
                    <SmallText>{crossStanzaReasonLabels[row.reason]}</SmallText>
                    {['priority', 'ascii'].includes(row.reason) ? <SmallText>Captured priority: this stanza {row.stanzaPriority ?? 'unverified'} · highest captured stanza {row.selectedPriority ?? 'unverified'}.</SmallText> : null}
                    <SmallText>Declared conjunction: {row.selectors.length ? row.selectors.map(item => `${item.field}=${item.value}`).join(' AND ') : 'Not established by the supported grammar'}</SmallText>
                    <SmallText>Caller: <Link to={objectLink(row.callerObjectId)}>{row.callerObjectId}</Link></SmallText>
                    {row.status === 'lower' && row.selectedObjectId ? <SmallText>Higher captured binding: <Link to={objectLink(row.selectedObjectId)}>{row.selectedObjectId}</Link></SmallText> : null}
                    {row.competingObjectIds.length ? <CollapsiblePanel appearance="subtle" title={`Captured comparison members (${row.competingObjectIds.length})`}>
                        <EvidenceList>{row.competingObjectIds.map(id => <li key={id}><Link to={objectLink(id)}>{id}</Link></li>)}</EvidenceList>
                    </CollapsiblePanel> : null}
                </li>)}</EvidenceList>
                {!matches.length ? <SmallText role="status">No cross-stanza contexts match these filters.</SmallText> : null}
                <CompositionPagination aria-label="Cross-stanza context pages">
                    <SmallText role="status">{matches.length ? `${current * PAGE_SIZE + 1}–${Math.min((current + 1) * PAGE_SIZE, matches.length)} of ${matches.length} matching cross-stanza contexts` : '0 matching cross-stanza contexts'}</SmallText>
                    <ButtonRow><StyledButton disabled={current === 0} onClick={() => setPage(current - 1)}>Previous cross-stanza contexts</StyledButton>
                        <StyledButton disabled={current >= last} onClick={() => setPage(current + 1)}>Next cross-stanza contexts</StyledButton></ButtonRow>
                </CompositionPagination>
            </> : <SmallText>Start from a captured caller relationship with a supported initial-search conjunction. No recorded comparison does not establish absence.</SmallText>}
        </CollapsiblePanel>
    </WrappingEvidenceSection>;
}
