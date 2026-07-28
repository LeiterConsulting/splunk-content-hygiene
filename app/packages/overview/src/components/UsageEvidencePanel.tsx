import React from 'react';
import {
    DefinitionList,
    EvidenceList,
    InlineNotice,
    SpacedBlock,
} from '../AppStyles';
import {
    usageCoverageLabel,
    usageSourceForObject,
} from '../services/usage';
import { ContentObject, UsageEvidence } from '../types';

interface UsageEvidencePanelProps {
    contentObject: ContentObject;
}

function formatDateTime(value: string | null): string {
    if (!value) {
        return 'Not observed';
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
        ? value
        : new Intl.DateTimeFormat('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
          }).format(parsed);
}

function formatCoverageBoundary(value: string | null): string {
    return value ? formatDateTime(value) : 'Unknown';
}

function usageNotice(usage: UsageEvidence): string {
    if (usage.observationCount > 0) {
        return `${usage.observationCount.toLocaleString()} attributable observation${
            usage.observationCount === 1 ? '' : 's'
        } found.`;
    }
    if (usage.coverage === 'complete') {
        return 'No attributable activity was observed in the complete source window. Owner confirmation is still required.';
    }
    return 'No attributable activity was observed, but source coverage is incomplete; no inactivity conclusion is supported.';
}

export function UsageEvidencePanel({
    contentObject,
}: UsageEvidencePanelProps): React.ReactElement {
    const supportedSource = usageSourceForObject(contentObject);
    const usage = contentObject.usageEvidence;

    if (!supportedSource) {
        return (
            <>
                <strong>Usage evidence</strong>
                <p>
                    Direct usage telemetry is not currently attributable to this
                    object type. Dependency and ownership evidence still apply.
                </p>
            </>
        );
    }

    if (!usage) {
        return (
            <>
                <strong>Usage evidence</strong>
                <p>
                    No usage window has been measured for this object. Run an
                    on-demand usage scan from Settings before interpreting
                    inactivity.
                </p>
            </>
        );
    }

    return (
        <>
            <strong>Usage evidence</strong>
            <SpacedBlock>
                <InlineNotice>{usageNotice(usage)}</InlineNotice>
            </SpacedBlock>
            <DefinitionList>
                <dt>Evidence source</dt>
                <dd>{usage.sourceLabel}</dd>
                <dt>Window</dt>
                <dd>{usage.windowDays} days</dd>
                <dt>Coverage</dt>
                <dd>{usageCoverageLabel(usage.coverage)}</dd>
                <dt>Last observed</dt>
                <dd>{formatDateTime(usage.lastObserved)}</dd>
                <dt>Observations</dt>
                <dd>{usage.observationCount.toLocaleString()}</dd>
                {usage.activityKind === 'saved_search_execution' ? (
                    <>
                        <dt>Completed/successful</dt>
                        <dd>{usage.successfulCount.toLocaleString()}</dd>
                        <dt>Failed</dt>
                        <dd>{usage.failedCount.toLocaleString()}</dd>
                        <dt>Skipped</dt>
                        <dd>{usage.skippedCount.toLocaleString()}</dd>
                    </>
                ) : null}
                <dt>Source coverage</dt>
                <dd>
                    {formatCoverageBoundary(usage.coverageStart)} through{' '}
                    {formatCoverageBoundary(usage.coverageEnd)}
                </dd>
            </DefinitionList>
            <EvidenceList>
                {usage.evidence.map((item) => (
                    <li key={item}>{item}</li>
                ))}
            </EvidenceList>
        </>
    );
}
