import React, { useState } from 'react';
import CollapsiblePanel from '@splunk/react-ui/CollapsiblePanel';
import styled from 'styled-components';
import { ButtonRow, DefinitionList, EvidenceList, InlineNotice, RowButton, SmallText, StyledButton, WrappingEvidenceSection } from '../AppStyles';
import { DependencyIndex } from '../services/dependencyGraph';
import { investigateAlternativePaths, PathInvestigation, pathInvestigationCsv } from '../services/alternativePaths';
import { PATH_CONTEXT_LABELS } from '../services/pathContext';
import { DependencyEdge } from '../types';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { PathContextDetails } from './PathContextDetails';
import { FieldProvenanceDetails } from './FieldLineagePanel';

const PathChoice = styled(StyledButton)`
    height: auto;
    max-width: 100%;
    span {
        white-space: normal;
        overflow-wrap: anywhere;
        text-align: left;
    }
`;

/** On-demand cached comparison. No effects, fetches, review writes or hidden scans. */
export function AlternativePathPanel({ index, sourceId, targetId, baselineEdgeIds, onInspect, onFocusPath }: {
    index: DependencyIndex;
    sourceId: string;
    targetId: string;
    baselineEdgeIds: readonly string[];
    onInspect: (id: string) => void;
    onFocusPath?: (edges: DependencyEdge[]) => void;
}): React.ReactElement {
    const [captured, setCaptured] = useState<{ index: DependencyIndex; sourceId: string; targetId: string; baseline: string; report: PathInvestigation } | null>(null);
    const [selectedId, setSelectedId] = useState('');
    const baseline = JSON.stringify(baselineEdgeIds);
    const report = captured?.index === index && captured.sourceId === sourceId && captured.targetId === targetId && captured.baseline === baseline ? captured.report : null;
    const selected = report?.paths.find(item => item.id === selectedId) ?? report?.paths[0];
    const name = (id: string): string => index.objects.get(id)?.name ?? id;
    const selectedEdges = selected?.edgeIds.map(id => index.edgeById.get(id)!) ?? [];
    const run = (): void => {
        const found = investigateAlternativePaths(index, sourceId, targetId, baselineEdgeIds);
        setCaptured({ index, sourceId, targetId, baseline, report: found }); setSelectedId('');
    };
    return <WrappingEvidenceSection aria-label="Alternative path investigation">
        <CollapsiblePanel appearance="subtle" title="Compare alternative paths" renderChildrenWhenCollapsed={false}>
            <SmallText>Compare directed captured paths from <strong>{name(sourceId)}</strong> to <strong>{name(targetId)}</strong>. The current witness is preserved. This uses the full cached adjacency, independently of display filters.</SmallText>
            <StyledButton onClick={run}>{report ? 'Recheck cached paths' : 'Find alternative paths'}</StyledButton>
            {report ? <>
                <InlineNotice role="status">{report.paths.filter(item => !item.baseline).length} displayed alternative(s); {report.diagnostics.completedCandidates} completed candidate path(s) inspected. Up to three alternatives are displayed from a bounded search. {report.limits.length ? `Limits/uncertainty: ${report.limits.join(', ')}.` : 'No search ceiling was reached within the explored scope.'} No result establishes absence or removal eligibility.</InlineNotice>
                <SmallText>Original witness first. Alternatives favor shared captured caller, then static/app-only context, then uncertain categories; within a category, shorter paths precede exact edge-ID order. This is a display preference, not a confidence or runtime ranking.</SmallText>
                <ButtonRow>
                    <StyledButton onClick={() => downloadJson('content-hygiene-path-investigation.json', report)}>Export path investigation JSON</StyledButton>
                    <StyledButton onClick={() => { const csv = pathInvestigationCsv(report); downloadCsv('content-hygiene-path-investigation.csv', csv.columns, csv.rows); }}>Export path investigation CSV</StyledButton>
                </ButtonRow>
                {selected ? <>
                    <SmallText>Path to inspect</SmallText>
                    <ButtonRow role="group" aria-label="Path to inspect">
                        {report.paths.map((item, position) => <PathChoice key={item.id} data-investigation-path={item.id} aria-pressed={selected.id === item.id} $primary={selected.id === item.id}
                            onClick={() => setSelectedId(item.id)}>{item.baseline ? 'Original witness' : `Alternative ${position + (report.paths[0]?.baseline ? 0 : 1)}`} · {item.edgeIds.length} hop(s) · {PATH_CONTEXT_LABELS[item.context.status]}</PathChoice>)}
                    </ButtonRow>
                    <div aria-live="polite"><SmallText>Selected: {selected.objectIds.map(name).join(' → ')}</SmallText></div>
                    {onFocusPath ? <StyledButton onClick={() => onFocusPath(selectedEdges)}>Focus selected path in map</StyledButton> : null}
                    <DefinitionList>
                        <dt>Path confidence</dt><dd>{selected.confidence} — weakest captured relationship, unchanged by context.</dd>
                        <dt>Applicability</dt><dd>{selected.conditional ? 'Contains potential implicit relationships — not observed execution' : 'Captured static relationships — not proof of execution'}</dd>
                    </DefinitionList>
                    <PathContextDetails context={selected.context} />
                    <h4>Selected directed path</h4>
                    <EvidenceList aria-label="Selected path hops">{selectedEdges.map((edge, hop) => <li key={edge.edgeId}>
                        <SmallText>Hop {hop + 1} · {edge.relation.replace(/_/g, ' ')} · {edge.confidence} · {edge.resolved ? 'Resolved in captured catalog' : 'Unresolved'}</SmallText>
                        <RowButton onClick={() => onInspect(edge.sourceId)}>{name(edge.sourceId)}</RowButton>{' → '}<RowButton onClick={() => onInspect(edge.targetId)}>{name(edge.targetId)}</RowButton>
                        <SmallText>{edge.sourceId} → {edge.targetId}</SmallText>
                        <SmallText>{edge.evidence || 'No explanation recorded'}</SmallText>
                        <SmallText>Source: {edge.sourceLocation || 'Not recorded'} · Relationship: {edge.edgeId}</SmallText>
                        <FieldProvenanceDetails provenance={edge.fieldProvenance} />
                    </li>)}</EvidenceList>
                    <CollapsiblePanel appearance="subtle" title="Inspect exact path identity" renderChildrenWhenCollapsed={false}>
                        <SmallText>{selected.id}</SmallText>
                    </CollapsiblePanel>
                </> : <SmallText>No supported path was returned by this bounded comparison. Check coverage and unresolved references; this is not proof that no dependency exists.</SmallText>}
                <SmallText>Ceilings: {report.ceilings.hops} search hops, {report.ceilings.edgeVisits.toLocaleString()} edge preparation/visits, {report.ceilings.states.toLocaleString()} queued states, {report.ceilings.candidates} completed candidates. {report.limitation}</SmallText>
            </> : null}
        </CollapsiblePanel>
    </WrappingEvidenceSection>;
}
