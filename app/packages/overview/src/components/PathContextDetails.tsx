import React from 'react';
import CollapsiblePanel from '@splunk/react-ui/CollapsiblePanel';
import Link from '@splunk/react-ui/Link';
import { DefinitionList, EvidenceList, SmallText, WrappingEvidenceSection } from '../AppStyles';
import { PathContextEvidence, PATH_CONTEXT_LABELS, PATH_CONTEXT_LIMITATION, PATH_CONTEXT_REASONS } from '../services/pathContext';
import { PropsCallerPanel } from './PropsCallerPanel';
import { readQueryParam, viewPath } from '../utils/navigation';

/** A chosen cached witness, not a runtime trace or an alternative-path search. */
export function PathContextDetails({ context, defaultOpen = false }: { context: PathContextEvidence; defaultOpen?: boolean }): React.ReactElement {
    const absentApps = context.reasons.includes('budget') ? 'Not listed — context evidence is bounded' : 'None established — not proof of incompatibility';
    return <WrappingEvidenceSection aria-label="Witness path context">
        <SmallText><strong>{PATH_CONTEXT_LABELS[context.status]}</strong></SmallText>
        {context.status !== 'static_only' ? <CollapsiblePanel appearance="subtle" title="Inspect path context" defaultOpen={defaultOpen} renderChildrenWhenCollapsed={false}>
            <DefinitionList>
                <dt>Chosen witness</dt><dd>{context.hopCount} directed hop(s); {context.scopedHopCount} scoped relationship(s).</dd>
                <dt>Captured fixed-app intersection</dt><dd>{context.apps.length ? context.apps.join(', ') : absentApps}. Unknown invocation is not an app mismatch.</dd>
                <dt>Common query receipts</dt><dd>{context.callerWitnesses.length} retained exact caller/query/conjunction receipt(s){context.reasons.includes('budget') ? ' (bounded evidence, not a complete count)' : ''}. App-only evidence does not establish one consistent query.</dd>
            </DefinitionList>
            {context.reasons.length ? <EvidenceList aria-label="Path context limitations">{context.reasons.map(reason => <li key={reason}>{PATH_CONTEXT_REASONS[reason]}</li>)}</EvidenceList> : null}
            {context.issues.length ? <><SmallText>Up to eight witness-hop examples are shown. Other relationships and alternative paths remain in the full adjacency.</SmallText><EvidenceList aria-label="Hops needing context verification">{context.issues.map(issue => <li key={`${issue.edgeId}:${issue.reason}`}>
                <Link to={viewPath('dependencies', { object: issue.sourceId, scan: readQueryParam('scan'), tab: 'relationships' })}>{issue.sourceId}</Link>
                {' → '}<Link to={viewPath('dependencies', { object: issue.targetId, scan: readQueryParam('scan'), tab: 'relationships' })}>{issue.targetId}</Link>
                <SmallText>{PATH_CONTEXT_REASONS[issue.reason]} Relationship: {issue.edgeId}</SmallText>
            </li>)}</EvidenceList></> : null}
            {context.callerWitnesses.length ? <PropsCallerPanel rows={context.callerWitnesses} /> : null}
            <SmallText>{PATH_CONTEXT_LIMITATION}</SmallText>
        </CollapsiblePanel> : null}
    </WrappingEvidenceSection>;
}
