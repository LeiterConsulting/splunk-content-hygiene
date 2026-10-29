import React from 'react';
import styled from 'styled-components';
import { variables } from '@splunk/themes';
import CollapsiblePanel from '@splunk/react-ui/CollapsiblePanel';
import { ButtonRow, DefinitionList, EvidenceList, InlineNotice, SmallText, StyledButton, WrappingEvidenceSection } from '../AppStyles';
import { BriefAction, InvestigationBriefInput, investigationBrief, investigationBriefCsv } from '../services/investigationBrief';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { ExportMenu } from './ExportMenu';
import { useEvidenceClock } from './useEvidenceClock';

const Brief = styled(WrappingEvidenceSection)`
    margin-bottom: ${variables.spacingLarge};
    padding: ${variables.spacingLarge};
    border: 1px solid ${variables.borderColor};
    border-radius: ${variables.borderRadius};
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
    h3 {
        margin: 0 0 ${variables.spacingSmall};
        font-size: ${variables.fontSizeLarge};
    }
    h4 {
        margin: 0 0 ${variables.spacingXSmall};
        font-size: ${variables.fontSize};
    }
    p { margin: 0; }
`;
const BriefGrid = styled.div`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: ${variables.spacingMedium} ${variables.spacingLarge};
    margin: ${variables.spacingMedium} 0;
    > div { min-width: 0; }
    @media (width <= 680px) { grid-template-columns: minmax(0, 1fr); }
`;

function formatCapture(value: string | null): string {
    return value ? new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : 'Not available';
}

export function InvestigationBrief({ onAction, ...input }: InvestigationBriefInput & { onAction: (action: BriefAction) => void }): React.ReactElement {
    const clock = useEvidenceClock();
    const report = investigationBrief({ ...input, now: input.now ?? clock });
    return <Brief aria-label="Investigation brief" data-investigation-brief={report.object.objectId}>
        <h3>Investigation brief: {report.object.name}</h3>
        <ButtonRow>
            <span><strong>Saved decision:</strong> {report.decision.label}</span>
            <span><strong>Evidence status:</strong> {report.decision.evidenceLabel}{report.decision.evidenceStatus === 'current' ? ' — unchanged within captured coverage' : ''}</span>
        </ButtonRow>
        {report.protection ? <InlineNotice>{report.protection}</InlineNotice> : null}
        <BriefGrid>
            <div><h4>Why review?</h4><p>{report.why.summary}</p>{report.why.recordedReason ? <SmallText>Recorded reason: {report.why.recordedReason}</SmallText> : null}</div>
            <div><h4>What is known?</h4><p>{report.known.incoming === null && report.known.outgoing === null ? 'Current relationship counts are unknown.' : `${report.known.incoming ?? 'Unknown'} captured incoming link(s) · ${report.known.outgoing ?? 'unknown'} outgoing link(s).`}</p><SmallText>{report.known.usageLabel}</SmallText></div>
            <div><h4>What remains uncertain?</h4><p>{report.uncertainty.preview}</p>{report.uncertainty.count > 1 ? <SmallText>{report.uncertainty.count} recorded evidence concern(s); inspect the summary below and full evidence views.</SmallText> : null}</div>
            <div><h4>Suggested next check</h4><p>{report.nextCheck.reason}</p><ButtonRow><StyledButton $primary onClick={() => onAction(report.nextCheck.action)}>{report.nextCheck.label}</StyledButton>
                <ExportMenu label="Export brief" items={[
                    { label: 'Investigation brief JSON', onClick: () => downloadJson('content-hygiene-investigation-brief.json', report) },
                    { label: 'Investigation brief CSV', onClick: () => { const csv = investigationBriefCsv(report); downloadCsv('content-hygiene-investigation-brief.csv', csv.columns, csv.rows); } },
                ]} />
            </ButtonRow></div>
        </BriefGrid>
        <SmallText>Snapshot captured {formatCapture(report.snapshot.capturedAt)} · {report.snapshot.ageState === 'recent' ? 'within the seven-day freshness window' : 'historical or unavailable time'}{report.snapshot.retainedBaseline ? ' · retained baseline' : ''}. This page reads a cache, not the live object.</SmallText>
        <CollapsiblePanel appearance="subtle" title="Inspect brief evidence and provenance" renderChildrenWhenCollapsed={false}>
            <DefinitionList><dt>Investigated object ID</dt><dd>{report.object.objectId}</dd><dt>Current presence</dt><dd>{report.object.presence.replace(/_/g, ' ')}</dd><dt>Snapshot scan</dt><dd>{report.snapshot.scanId ?? 'Unavailable'}</dd>
                <dt>Usage window ended</dt><dd>{report.known.usageWindowEnded ?? 'Not measured / not attributable'}</dd><dt>Environment-wide collector warnings</dt><dd>{report.snapshot.globalWarningCount ?? 'Unavailable'} — separate from this object’s evidence concerns</dd></DefinitionList>
            {report.uncertainty.summaries.length ? <EvidenceList>{report.uncertainty.summaries.map(reason => <li key={reason}>{reason}</li>)}</EvidenceList> : null}
            {report.uncertainty.moreAvailable ? <SmallText>This brief is bounded to six concern summaries and shortened long messages. Full evidence remains in the existing detailed views and reports.</SmallText> : null}
        </CollapsiblePanel>
        <SmallText>{report.limitation}</SmallText>
    </Brief>;
}
