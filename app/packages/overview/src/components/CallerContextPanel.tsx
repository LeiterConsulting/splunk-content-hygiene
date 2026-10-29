import React, { useState } from 'react';
import CollapsiblePanel from '@splunk/react-ui/CollapsiblePanel';
import { ButtonRow, DefinitionList, EvidenceList, FilterField, InlineNotice, Input, Select, SmallText, StyledButton, WrappingEvidenceSection } from '../AppStyles';
import { ContentObject } from '../types';
import { CALLER_CONTEXT_LIMITATION, callerContextCsv, callerContextGuidance, callerContextLabels, callerContextOutcomeLabels, callerContextReport } from '../services/callerContextDiagnostics';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';

const PAGE_SIZE = 6;
/** Selected cached caller only. No native fetch, hidden scan or review write. */
export function CallerContextPanel({ object }: { object: ContentObject }): React.ReactElement {
    const [filter, setFilter] = useState(''); const [outcome, setOutcome] = useState('withheld'); const [page, setPage] = useState(0);
    const report = callerContextReport(object); const data = report.diagnostics;
    const supported = ['Saved Search', 'Report', 'Alert', 'Dashboard'].includes(object.objectType);
    const query = filter.trim().toLowerCase();
    const rows = (data?.rows ?? []).filter(row => (outcome === 'all' || row.outcome === outcome) &&
        (!query || [row.sourceLocation, row.queryDigest, row.firstRejection ? callerContextLabels[row.firstRejection] : '',
            ...row.features.map(reason => callerContextLabels[reason])].some(value => value.toLowerCase().includes(query))));
    const last = Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1); const current = Math.min(page, last);
    let notice: React.ReactElement | null = null;
    if (!supported) { notice = <InlineNotice>This object is not an independent saved-search or dashboard caller. Inspect its calling search/dashboard for query-specific context; reusable definitions do not establish their invocation context.</InlineNotice>; }
    else if (!data) { notice = <InlineNotice role="status">Not recorded in this snapshot. Run an explicit new inventory scan to capture diagnostics. Missing diagnostics do not mean complete coverage; saved decisions are unchanged.</InlineNotice>; }
    else if (data.state === 'unavailable') { notice = <InlineNotice role="status">Caller source could not be assessed in this snapshot. Context remains unknown. Check source access and scan diagnostics; no absence is inferred.</InlineNotice>; }
    return <WrappingEvidenceSection aria-label="Caller context diagnostics">
        <h3>Caller context: {object.name}</h3>
        <SmallText>Why the strict initial-search parser retained or withheld a caller conjunction. This is separate from general parser warnings and path-context compatibility.</SmallText>
        {notice}
        {supported ? <>
            <ButtonRow>
                <StyledButton onClick={() => downloadJson('content-hygiene-caller-context.json', report)}>Export caller context JSON</StyledButton>
                <StyledButton onClick={() => { const csv = callerContextCsv(object); downloadCsv('content-hygiene-caller-context.csv', csv.columns, csv.rows); }}>Export caller context CSV</StyledButton>
            </ButtonRow>
            <DefinitionList>
                <dt>Inventory scan</dt><dd>{report.inventoryScanId ?? 'Not recorded'}</dd>
                <dt>Diagnostic state</dt><dd>{report.state.replace(/_/g, ' ')}</dd>
                {data ? <><dt>Captured query occurrences</dt><dd>{data.counts.queries} total · {data.counts.retained} retained conjunction(s) · {data.counts.withheld} withheld · {data.counts.postProcess} post-process/chain excluded.</dd></> : null}
            </DefinitionList>
            {data?.limited || data?.state === 'budget' ? <InlineNotice role="status">A diagnostic safety ceiling was reached. {data.rows.length} query detail(s) retained of {data.counts.queries} counted occurrences; omitted context is unknown. Filters and exports cannot recover omitted rows.</InlineNotice> : null}
            {data?.sourceIncomplete ? <InlineNotice role="status">Source extraction or parsing was incomplete. Counts cover extracted query occurrences only, not every possible source query or consumer.</InlineNotice> : null}
            {data?.rows.length ? <>
                <ButtonRow>
                    <FilterField>Find query diagnostic<Input value={filter} onChange={event => { setFilter(event.currentTarget.value); setPage(0); }} placeholder="Location, reason or query digest" /></FilterField>
                    <FilterField>Query context outcome<Select value={outcome} onChange={event => { setOutcome(event.currentTarget.value); setPage(0); }}>
                        <option value="withheld">Context withheld</option><option value="retained">Retained static conjunctions</option><option value="post_process">Post-process / chain excluded</option><option value="all">All recorded outcomes</option>
                    </Select></FilterField>
                </ButtonRow>
                <SmallText role="status">{rows.length ? current * PAGE_SIZE + 1 : 0}–{Math.min((current + 1) * PAGE_SIZE, rows.length)} of {rows.length} matching recorded query diagnostics</SmallText>
                <EvidenceList aria-label="Recorded query diagnostics">{rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(row => <li key={`${row.sourceLocation}:${row.queryDigest}`}>
                    <strong>{callerContextGuidance(row).explanation}</strong>
                    <SmallText>Query location: {row.sourceLocation}</SmallText>
                    <SmallText>{callerContextGuidance(row).nextCheck}</SmallText>
                    <CollapsiblePanel appearance="subtle" title="Inspect query provenance" renderChildrenWhenCollapsed={false}>
                        <DefinitionList>
                            <dt>Outcome</dt><dd>{callerContextOutcomeLabels[row.outcome]}</dd>
                            <dt>First rejection code</dt><dd>{row.firstRejection ?? 'None — not a runtime confirmation'}</dd>
                            <dt>Query offset</dt><dd>{row.offset === null ? 'Not applicable / not retained' : `${row.offset} (zero-based UTF-16, not a line number)`}</dd>
                            <dt>Observed syntax features</dt><dd>{row.features.length ? row.features.map(reason => callerContextLabels[reason]).join('; ') : 'None recorded — not proof that no other blocker exists'}</dd>
                            <dt>Explicit selector mentioned</dt><dd>{row.selectorMentioned ? 'Yes — mention alone is not a valid conjunction' : 'No supported mention recorded — implicit scope can still exist'}</dd>
                            <dt>Exact query digest</dt><dd>{row.queryDigest}</dd>
                        </DefinitionList>
                    </CollapsiblePanel>
                </li>)}</EvidenceList>
                {!rows.length ? <SmallText>No recorded query diagnostics match these filters. This is not proof of complete context.</SmallText> : null}
                <ButtonRow>
                    <StyledButton disabled={current === 0} onClick={() => setPage(current - 1)}>Previous query diagnostics</StyledButton>
                    <StyledButton disabled={current === last} onClick={() => setPage(current + 1)}>Next query diagnostics</StyledButton>
                </ButtonRow>
            </> : null}
            {!data?.rows.length && data?.state === 'recorded' && !data.limited && !data.sourceIncomplete ? <SmallText>No inline query occurrences were extracted by the supported parser. Saved-search references and external/runtime consumers require separate investigation.</SmallText> : null}
            <CollapsiblePanel appearance="subtle" title="Inspect diagnostic provenance" renderChildrenWhenCollapsed={false}>
                <DefinitionList><dt>Configuration fingerprint</dt><dd>{report.configurationDigest ?? 'Not recorded — exact source freshness cannot be established'}</dd>
                    <dt>Diagnostic policy</dt><dd>{data?.policy ?? 'Not recorded'}</dd></DefinitionList>
                <SmallText>Digests identify captured bytes/configuration, not a live freshness check. Opening this panel never re-reads source content. Raw SPL, selector values and macro bodies are not stored in these diagnostics. Exports include all retained rows, regardless of display filters.</SmallText>
            </CollapsiblePanel>
        </> : null}
        <SmallText>{CALLER_CONTEXT_LIMITATION}</SmallText>
    </WrappingEvidenceSection>;
}
