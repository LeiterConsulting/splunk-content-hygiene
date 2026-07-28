import React from 'react';
import {
    ButtonRow,
    Card,
    CardBody,
    CardHeader,
    CardTitle,
    DefinitionList,
    EvidenceList,
    FilterField,
    InlineNotice,
    MetricGrid,
    RowButton,
    Select,
    SmallText,
    StackedContent,
    StyledButton,
    Table,
    TableScroller,
    TwoColumnGrid,
} from '../AppStyles';
import { SummaryMetric } from './SummaryMetric';
import { RemovalImpactAnalysis, RemovalImpactLevel } from '../services/removalImpact';
import { ContentObject } from '../types';

interface RemovalImpactPanelProps {
    selected: ContentObject;
    analysis: RemovalImpactAnalysis;
    depth: number;
    onDepthChange: (depth: number) => void;
    onDrillTo: (objectId: string) => void;
}

const impactAccent: Record<RemovalImpactLevel, 'positive' | 'warning' | 'negative' | 'neutral'> = {
    critical: 'negative',
    high: 'negative',
    medium: 'warning',
    low: 'positive',
    unknown: 'neutral',
};

function plural(value: number, singular: string, pluralValue = `${singular}s`): string {
    return value === 1 ? singular : pluralValue;
}

function impactLabel(level: RemovalImpactLevel): string {
    return level === 'unknown' ? 'Unknown' : `${level.charAt(0).toUpperCase()}${level.slice(1)}`;
}

function usageMetricValue(selected: ContentObject): string {
    if (!selected.usageEvidence) {
        return 'Not measured';
    }
    return selected.usageEvidence.observationCount > 0
        ? `${selected.usageEvidence.observationCount.toLocaleString()} observed`
        : 'None observed';
}

function usageMetricAccent(
    selected: ContentObject,
): 'warning' | 'positive' | 'neutral' {
    if ((selected.usageEvidence?.observationCount ?? 0) > 0) {
        return 'warning';
    }
    return selected.usageEvidence?.coverage === 'complete'
        ? 'positive'
        : 'neutral';
}

export function RemovalImpactPanel({
    selected,
    analysis,
    depth,
    onDepthChange,
    onDrillTo,
}: RemovalImpactPanelProps): React.ReactElement {
    return (
        <StackedContent>
            <Card>
                <CardHeader>
                    <div>
                        <CardTitle>Impact of removal</CardTitle>
                        <SmallText>
                            Simulates the known blast radius for {selected.name} without changing
                            Splunk content. Relationship-view filters do not reduce this impact
                            analysis.
                        </SmallText>
                    </div>
                    <FilterField>
                        Impact depth
                        <Select
                            value={depth}
                            onChange={(event) => onDepthChange(Number(event.currentTarget.value))}
                        >
                            <option value={1}>Direct dependents only</option>
                            <option value={2}>Up to 2 hops</option>
                            <option value={3}>Up to 3 hops</option>
                            <option value={5}>Up to 5 hops</option>
                        </Select>
                    </FilterField>
                </CardHeader>
                <CardBody>
                    <InlineNotice>
                        <strong>{analysis.readinessLabel}.</strong> {analysis.summary}
                    </InlineNotice>
                    <MetricGrid>
                        <SummaryMetric
                            label="Impact level"
                            value={impactLabel(analysis.impactLevel)}
                            hint={`Combined impact indicator ${
                                analysis.impactScore === null
                                    ? 'unknown'
                                    : `${analysis.impactScore}/100`
                            }`}
                            accent={impactAccent[analysis.impactLevel]}
                        />
                        <SummaryMetric
                            label="Direct dependents"
                            value={analysis.directDependents.length.toLocaleString()}
                            hint="Known objects that immediately consume this object"
                            accent={analysis.directDependents.length > 0 ? 'negative' : 'positive'}
                        />
                        <SummaryMetric
                            label="Indirect dependents"
                            value={analysis.indirectDependents.length.toLocaleString()}
                            hint={`Known cascading impact within ${analysis.maxDepth} ${plural(
                                analysis.maxDepth,
                                'hop',
                            )}`}
                            accent={analysis.indirectDependents.length > 0 ? 'warning' : 'positive'}
                        />
                        <SummaryMetric
                            label="Affected apps"
                            value={analysis.affectedAppCount.toLocaleString()}
                            hint="App namespaces represented in the known blast radius"
                            accent={analysis.affectedAppCount > 1 ? 'warning' : 'neutral'}
                        />
                        <SummaryMetric
                            label="Usage evidence"
                            value={usageMetricValue(selected)}
                            hint={
                                selected.usageEvidence
                                    ? `${selected.usageEvidence.coverage} ${selected.usageEvidence.windowDays}-day window`
                                    : 'Required before change-planning readiness'
                            }
                            accent={usageMetricAccent(selected)}
                        />
                    </MetricGrid>
                    <DefinitionList>
                        <dt>Protected affected</dt>
                        <dd>{analysis.protectedAffectedCount}</dd>
                        <dt>Unresolved affected</dt>
                        <dd>{analysis.unresolvedAffectedCount}</dd>
                        <dt>Traversal scope</dt>
                        <dd>
                            {analysis.truncated
                                ? `Truncated at ${analysis.maxDepth} hops or the object safety limit`
                                : `Complete within the selected ${analysis.maxDepth}-hop scope`}
                        </dd>
                    </DefinitionList>
                </CardBody>
            </Card>

            {analysis.affectedObjects.length > 0 ? (
                <Card>
                    <CardHeader>
                        <CardTitle>
                            {analysis.affectedObjects.length} known affected{' '}
                            {plural(analysis.affectedObjects.length, 'object')}
                        </CardTitle>
                    </CardHeader>
                    <TableScroller>
                        <Table>
                            <thead>
                                <tr>
                                    <th scope="col">Affected object</th>
                                    <th scope="col">Impact</th>
                                    <th scope="col">Path to selected object</th>
                                    <th scope="col">Likely outcome</th>
                                    <th scope="col">Evidence</th>
                                    <th scope="col">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {analysis.affectedObjects.map((affected) => (
                                    <tr key={affected.objectId}>
                                        <td>
                                            <RowButton
                                                type="button"
                                                onClick={() => onDrillTo(affected.objectId)}
                                                disabled={!affected.resolved}
                                            >
                                                {affected.name}
                                            </RowButton>
                                            <div>
                                                {affected.objectType} · {affected.app}
                                            </div>
                                        </td>
                                        <td>
                                            {affected.direct ? 'Direct' : `${affected.depth} hops`}
                                            <div>{affected.confidence} confidence</div>
                                        </td>
                                        <td>{affected.pathNames.join(' → ')}</td>
                                        <td>{affected.likelyOutcome}</td>
                                        <td>
                                            {affected.evidence}
                                            {affected.sourceLocation
                                                ? ` [${affected.sourceLocation}]`
                                                : ''}
                                        </td>
                                        <td>
                                            <StyledButton
                                                type="button"
                                                disabled={!affected.resolved}
                                                onClick={() => onDrillTo(affected.objectId)}
                                            >
                                                Inspect object
                                            </StyledButton>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    </TableScroller>
                </Card>
            ) : (
                <Card>
                    <CardBody>
                        <InlineNotice>
                            No affected objects were found in the captured graph. Continue with the
                            confirmation and caveat checks below; this result is not proof of zero
                            impact.
                        </InlineNotice>
                    </CardBody>
                </Card>
            )}

            <TwoColumnGrid>
                <Card>
                    <CardHeader>
                        <CardTitle>Potential consequences</CardTitle>
                    </CardHeader>
                    <CardBody>
                        <EvidenceList>
                            {analysis.potentialConsequences.map((consequence) => (
                                <li key={consequence}>{consequence}</li>
                            ))}
                        </EvidenceList>
                    </CardBody>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>Evidence limitations</CardTitle>
                    </CardHeader>
                    <CardBody>
                        <EvidenceList>
                            {analysis.caveats.map((caveat) => (
                                <li key={caveat}>{caveat}</li>
                            ))}
                        </EvidenceList>
                    </CardBody>
                </Card>
            </TwoColumnGrid>

            <Card>
                <CardHeader>
                    <CardTitle>Recommended removal sequence</CardTitle>
                </CardHeader>
                <CardBody>
                    <EvidenceList as="ol">
                        {analysis.removalPlan.map((step) => (
                            <li key={step.sequence}>
                                <strong>{step.title}</strong>
                                <div>{step.detail}</div>
                                <SmallText>
                                    {step.blocking
                                        ? 'Blocking prerequisite'
                                        : 'Required change-control evidence'}
                                </SmallText>
                                {step.objectIds.length > 0 ? (
                                    <ButtonRow>
                                        {step.objectIds.slice(0, 8).map((objectId) => {
                                            const affected = analysis.affectedObjects.find(
                                                (item) => item.objectId === objectId,
                                            );
                                            return affected?.resolved ? (
                                                <StyledButton
                                                    key={objectId}
                                                    type="button"
                                                    onClick={() => onDrillTo(objectId)}
                                                >
                                                    Inspect {affected.name}
                                                </StyledButton>
                                            ) : null;
                                        })}
                                    </ButtonRow>
                                ) : null}
                            </li>
                        ))}
                    </EvidenceList>
                </CardBody>
            </Card>

            {analysis.dependencyFollowUps.length > 0 ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Dependency objects to reassess after removal</CardTitle>
                    </CardHeader>
                    <TableScroller>
                        <Table>
                            <thead>
                                <tr>
                                    <th scope="col">Dependency</th>
                                    <th scope="col">Relationship</th>
                                    <th scope="col">Known consumers</th>
                                    <th scope="col">Follow-up</th>
                                    <th scope="col">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {analysis.dependencyFollowUps.map((followUp) => (
                                    <tr key={`${followUp.objectId}-${followUp.relation}`}>
                                        <td>
                                            {followUp.name}
                                            <div>
                                                {followUp.objectType} · {followUp.app}
                                            </div>
                                        </td>
                                        <td>
                                            {followUp.relation}
                                            <div>{followUp.confidence} confidence</div>
                                        </td>
                                        <td>{followUp.knownDependentCount}</td>
                                        <td>{followUp.recommendation}</td>
                                        <td>
                                            <StyledButton
                                                type="button"
                                                disabled={
                                                    !analysis.affectedObjects.some(
                                                        ({ objectId }) =>
                                                            objectId === followUp.objectId,
                                                    ) && followUp.objectId.startsWith('missing::')
                                                }
                                                onClick={() => onDrillTo(followUp.objectId)}
                                            >
                                                Inspect dependency
                                            </StyledButton>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    </TableScroller>
                </Card>
            ) : null}
        </StackedContent>
    );
}
