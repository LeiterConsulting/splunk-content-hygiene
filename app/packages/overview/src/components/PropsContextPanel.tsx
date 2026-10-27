import React, { useState } from 'react';
import CollapsiblePanel from '@splunk/react-ui/CollapsiblePanel';
import Link from '@splunk/react-ui/Link';
import { ButtonRow, CompositionPagination, EvidenceList, FilterField, Input, Select, SmallText, StyledButton, WrappingEvidenceSection } from '../AppStyles';
import { PropsContextEvidence } from '../types';
import { PROPS_CONTEXT_LIMITATION, propsReasonLabels, propsStatusLabels } from '../services/propsEvidence';
import { readQueryParam, viewPath } from '../utils/navigation';

const PAGE_SIZE = 8;
/** Cache-only progressive disclosure; filtering never reads native config or
 * changes a review. Links use the existing unsaved-draft navigation guard. */
export function PropsContextPanel({ rows, truncated = false }: { rows?: PropsContextEvidence[]; truncated?: boolean }): React.ReactElement {
    const [filter, setFilter] = useState(''); const [status, setStatus] = useState('all'); const [page, setPage] = useState(0);
    const query = filter.trim().toLowerCase();
    const matches = (rows ?? []).filter(row => (status === 'all' || row.status === status) &&
        (!query || [row.app, row.objectId, row.selectedObjectId ?? ''].some(value => value.toLowerCase().includes(query))));
    const last = Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1); const current = Math.min(page, last);
    const displayed = matches.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
    const summary = Object.entries(propsStatusLabels).map(([key, label]) => `${(rows ?? []).filter(row => row.status === key).length} ${label.toLowerCase()}`).join(' · ');
    return <WrappingEvidenceSection aria-label="Shared props precedence">
        <strong>Shared props precedence &amp; inheritance</strong>
        <SmallText>{rows === undefined ? 'Not recorded by this snapshot. Run a new complete scan; saved decisions are unchanged.' : summary}</SmallText>
        {truncated ? <SmallText role="status">Context evidence was truncated by a safety budget. Additional contexts remain unverified.</SmallText> : null}
        <CollapsiblePanel appearance="subtle" title={`Inspect shared props contexts (${rows?.length ?? 0})`}>
            <SmallText>{PROPS_CONTEXT_LIMITATION}</SmallText>
            {rows?.length ? <>
                <ButtonRow>
                    <FilterField>Find props context<Input value={filter} onChange={event => { setFilter(event.currentTarget.value); setPage(0); }} placeholder="App or object name" /></FilterField>
                    <FilterField>Props binding status<Select value={status} onChange={event => { setStatus(event.currentTarget.value); setPage(0); }}>
                        <option value="all">All binding statuses</option>{Object.entries(propsStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </Select></FilterField>
                </ButtonRow>
                <EvidenceList aria-label="Shared props context observations">{displayed.map(row => <li key={`${row.objectId}-${row.app}`}>
                    <strong>{row.app} · {propsStatusLabels[row.status]}</strong>
                    <SmallText>{row.objectId}</SmallText>
                    <SmallText>{propsReasonLabels[row.reason]}</SmallText>
                    {row.stanzaPriority !== undefined ? <SmallText>Captured stanza priority: {row.stanzaPriority ?? 'unverified'}. Used only within the same category, not across source/host/sourcetype or to promote a default fallback.</SmallText> : null}
                    {row.selectedObjectId && row.selectedObjectId !== row.objectId ? <SmallText>Returned binding: <Link to={viewPath('dependencies', { object: row.selectedObjectId, scan: readQueryParam('scan'), tab: 'object' })}>{row.selectedObjectId}</Link></SmallText> : null}
                </li>)}</EvidenceList>
                {!matches.length ? <SmallText role="status">No contexts match these filters.</SmallText> : null}
                <CompositionPagination aria-label="Props context pages">
                    <SmallText role="status">{matches.length ? `${current * PAGE_SIZE + 1}–${Math.min((current + 1) * PAGE_SIZE, matches.length)} of ${matches.length} matching contexts` : '0 matching contexts'}</SmallText>
                    <ButtonRow><StyledButton disabled={current === 0} onClick={() => setPage(current - 1)}>Previous contexts</StyledButton>
                        <StyledButton disabled={current >= last} onClick={() => setPage(current + 1)}>Next contexts</StyledButton></ButtonRow>
                </CompositionPagination>
            </> : <SmallText>No verified context rows are available. This is not proof of absence.</SmallText>}
        </CollapsiblePanel>
    </WrappingEvidenceSection>;
}
