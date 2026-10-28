import React, { useMemo, useState } from 'react';
import Modal from '@splunk/react-ui/Modal';
import styled from 'styled-components';
import { variables } from '@splunk/themes';
import { DefinitionList, FilterField, Input, InlineNotice, RowButton, SmallText, StyledButton } from '../AppStyles';
import { DependencyIndex, GraphLink, GraphNode } from '../services/dependencyGraph';
import { isPotentialRelation } from '../utils/dependencySemantics';
import { ResultPagination } from './ResultPagination';
import { StatusBadge } from './StatusBadge';
import { FieldLineagePanel, FieldProvenanceDetails } from './FieldLineagePanel';
import { PathContextDetails } from './PathContextDetails';
import { createPathContextTracker } from '../services/pathContext';
import { DependencyEdge } from '../types';
import { AlternativePathPanel } from './AlternativePathPanel';

const ContextFacts = styled(DefinitionList)`
    grid-template-columns: minmax(90px, 0.3fr) minmax(0, 1fr);
    @media (width <= 480px) {
        grid-template-columns: minmax(0, 1fr);
        dd {
            margin-bottom: ${variables.spacingSmall};
        }
    }
`;
const ContextList = styled.ul`
    display: grid;
    gap: ${variables.spacingMedium};
    padding-left: ${variables.spacingLarge};
    li {
        min-width: 0;
        overflow-wrap: anywhere;
    }
    p {
        white-space: pre-wrap;
    }
`;

export type GraphContext = { node: GraphNode } | { link: GraphLink };

/** Read-only, portal-based context: never clipped by the graph's scroll area. */
export function GraphContextDialog({
    context,
    open,
    index,
    onClose,
    onInspect,
    returnFocus,
    onFocusConnection,
    onFocusPath,
    title,
}: {
    context: GraphContext | null;
    open: boolean;
    index: DependencyIndex;
    onClose: () => void;
    onInspect: (id: string) => void;
    returnFocus: () => void;
    onFocusConnection?: (edge: DependencyEdge) => void;
    onFocusPath?: (edges: DependencyEdge[]) => void;
    title?: string;
}): React.ReactElement {
    const [page, setPage] = useState(0);
    const [query, setQuery] = useState('');
    const node = context && 'node' in context ? context.node : null;
    const link = context && 'link' in context ? context.link : null;
    const ids = node?.memberIds ?? [];
    const references = useMemo(() => link?.edges ?? [], [link?.edges]);
    const name = (id: string): string => index.objects.get(id)?.name ?? id;
    const normalized = query.trim().toLocaleLowerCase();
    const filteredReferences = useMemo(() => references.filter(edge => !normalized ||
        [edge.sourceId, edge.targetId, index.objects.get(edge.sourceId)?.name, index.objects.get(edge.targetId)?.name,
            edge.relation.replace(/_/g, ' '), edge.evidence, edge.sourceLocation].join(' ').toLocaleLowerCase().includes(normalized)), [references, normalized, index]);
    const filteredIds = ids.filter(id => !normalized || `${id} ${name(id)}`.toLocaleLowerCase().includes(normalized));
    const total = link ? filteredReferences.length : filteredIds.length;
    const currentPage = Math.min(page, Math.max(0, Math.ceil(total / 25) - 1));
    const visibleReferences = useMemo(() => filteredReferences.slice(currentPage * 25, (currentPage + 1) * 25), [filteredReferences, currentPage]);
    const referenceContexts = useMemo(() => {
        const tracker = createPathContextTracker(index.objects);
        return new Map(visibleReferences.map(edge => [edge.edgeId, tracker.path(edge.sourceId, [edge])]));
    }, [visibleReferences, index]);
    const inspect = (id: string): void => {
        onClose();
        onInspect(id);
    };
    const nodeTitle = node?.memberIds ? 'Grouped object context' : 'Object context';
    return (
        <Modal
            open={open}
            onRequestClose={onClose}
            returnFocus={returnFocus}
            style={{ width: 760, maxWidth: 'calc(100vw - 32px)' }}
        >
            <Modal.Header title={title ?? (link ? 'Relationship context' : nodeTitle)} />
            <Modal.Body
                data-content-hygiene-portal="true"
                style={{ maxHeight: '65vh', overflowY: 'auto', overflowWrap: 'anywhere' }}
            >
                {link || node?.memberIds ? <FilterField>
                    {link ? 'Find a captured connection' : 'Find a grouped object'}
                    <Input value={query} onChange={event => { setQuery(event.currentTarget.value); setPage(0); }}
                        placeholder={link ? 'Endpoint, relationship or evidence' : 'Object name or identity'} />
                </FilterField> : null}
                {node ? (
                    <>
                        <ContextFacts>
                            <dt>Name</dt>
                            <dd>{node.name}</dd>
                            <dt>Type</dt>
                            <dd>{node.objectType}</dd>
                            <dt>App</dt>
                            <dd>{node.app}</dd>
                            {!node.memberIds ? (
                                <>
                                    <dt>Identity</dt>
                                    <dd>{node.id}</dd>
                                    <dt>Status</dt>
                                    <dd>
                                        <StatusBadge status={node.status} />
                                    </dd>
                                </>
                            ) : null}
                        </ContextFacts>
                        {node.witness && !node.memberIds ? <>
                            <h3>One graph witness from the center</h3>
                            <SmallText>{node.witness.objectIds.map(name).join(' → ')}</SmallText>
                            <SmallText>{node.witness.direction === 'inbound' ? 'Inbound witness ends at' : 'Outbound witness starts at'} {name(node.witness.centerId)}. Other arrows can represent different paths.</SmallText>
                            <PathContextDetails context={node.witness.context} />
                            <AlternativePathPanel index={index} sourceId={node.witness.objectIds[0]} targetId={node.witness.objectIds[node.witness.objectIds.length - 1]}
                                baselineEdgeIds={node.witness.edgeIds} onInspect={inspect}
                                onFocusPath={onFocusPath ? edges => { onClose(); onFocusPath(edges); } : undefined} />
                        </> : null}
                        {!node.memberIds && index.objects.get(node.id) ? <FieldLineagePanel object={index.objects.get(node.id)!} /> : null}
                        {!node.resolved && !node.memberIds ? (
                            <InlineNotice>
                                This target is unresolved. Its label and status are captured
                                context, not proof that an object is missing or safe to remove.
                            </InlineNotice>
                        ) : null}
                        {node.memberIds ? (
                            <>
                                <p>
                                    {ids.length} objects in this displayed group. Inspect a member
                                    for its full evidence; the graph center does not change.
                                </p>
                                <ResultPagination
                                    page={currentPage}
                                    pageSize={25}
                                    total={total}
                                    onChange={setPage}
                                />
                                <ContextList>
                                    {filteredIds
                                        .slice(currentPage * 25, (currentPage + 1) * 25)
                                        .map((id) => (
                                            <li key={id}>
                                                <RowButton onClick={() => inspect(id)}>
                                                    {name(id)}
                                                </RowButton>
                                                <SmallText>
                                                    {index.objects.get(id)?.objectType ??
                                                        'Unresolved target'}{' '}
                                                    · {index.objects.get(id)?.app ?? 'Unknown app'}
                                                </SmallText>
                                                <SmallText>{id}</SmallText>
                                            </li>
                                        ))}
                                </ContextList>
                            </>
                        ) : null}
                    </>
                ) : null}
                {link ? (
                    <>
                        <ContextFacts>
                            <dt>Relationship</dt>
                            <dd>{link.label}</dd>
                            <dt>Confidence</dt>
                            <dd>{link.confidence} — weakest captured confidence</dd>
                            <dt>References</dt>
                            <dd>
                                {references.length} captured reference
                                {references.length === 1 ? '' : 's'}
                            </dd>
                        </ContextFacts>
                        <InlineNotice>
                            {references.some((edge) => isPotentialRelation(edge.relation))
                                ? 'Potential implicit relationship — not observed execution. Confirm active state, exact field/value assignment, props precedence, field availability and invoking-app context before treating this as a runtime dependency.'
                                : 'Captured static relationship — not proof of runtime execution or removal eligibility.'}
                        </InlineNotice>
                        <p>
                            Full endpoints, explanations and source locations are listed below.
                            Grouped arrows can represent several distinct objects or relationship
                            types.
                        </p>
                        <ResultPagination
                            page={currentPage}
                            pageSize={25}
                            total={total}
                            onChange={setPage}
                        />
                        <ContextList>
                            {visibleReferences
                                .map((edge) => (
                                    <li key={edge.edgeId}>
                                        {onFocusConnection ? <StyledButton
                                            onClick={() => { onClose(); onFocusConnection(edge); }}
                                            aria-label={`Focus endpoints: ${name(edge.sourceId)} to ${name(edge.targetId)}`}
                                        >Focus both endpoints</StyledButton> : null}
                                        <ContextFacts>
                                            <dt>From</dt>
                                            <dd>
                                                <RowButton onClick={() => inspect(edge.sourceId)}>
                                                    {name(edge.sourceId)}
                                                </RowButton>
                                                <SmallText>{edge.sourceId}</SmallText>
                                            </dd>
                                            <dt>To</dt>
                                            <dd>
                                                <RowButton onClick={() => inspect(edge.targetId)}>
                                                    {name(edge.targetId)}
                                                </RowButton>
                                                <SmallText>{edge.targetId}</SmallText>
                                            </dd>
                                            <dt>Relation</dt>
                                            <dd>
                                                {edge.relation.replace(/_/g, ' ')} ·{' '}
                                                {edge.confidence} confidence
                                                {isPotentialRelation(edge.relation)
                                                    ? ' · potential, not observed'
                                                    : ''}
                                            </dd>
                                            <dt>Evidence</dt>
                                            <dd style={{ whiteSpace: 'pre-wrap' }}>
                                                {edge.evidence || 'No explanation recorded'}
                                            </dd>
                                            <dt>Source location</dt>
                                            <dd>{edge.sourceLocation || 'Not recorded'}</dd>
                                            <dt>Resolution</dt>
                                            <dd>
                                                {edge.resolved
                                                    ? 'Resolved in the captured catalog'
                                                    : 'Unresolved in the captured catalog'}
                                            </dd>
                                        </ContextFacts>
                                        <FieldProvenanceDetails provenance={edge.fieldProvenance} />
                                        {referenceContexts.get(edge.edgeId) ? <PathContextDetails context={referenceContexts.get(edge.edgeId)!} /> : null}
                                        <AlternativePathPanel index={index} sourceId={edge.sourceId} targetId={edge.targetId} baselineEdgeIds={[edge.edgeId]} onInspect={inspect}
                                            onFocusPath={onFocusPath ? edges => { onClose(); onFocusPath(edges); } : undefined} />
                                    </li>
                                ))}
                        </ContextList>
                        {!total ? <InlineNotice>No captured connections match this text. Clear the filter to browse all {references.length} references.</InlineNotice> : null}
                    </>
                ) : null}
            </Modal.Body>
            <Modal.Footer>
                {node && !node.memberIds ? (
                    <StyledButton onClick={() => inspect(node.id)}>Inspect object</StyledButton>
                ) : null}
                <StyledButton $primary onClick={onClose}>
                    Close context
                </StyledButton>
            </Modal.Footer>
        </Modal>
    );
}
