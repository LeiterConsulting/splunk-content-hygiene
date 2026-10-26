import React from 'react';
import CollapsiblePanel from '@splunk/react-ui/CollapsiblePanel';
import { DefinitionList, EvidenceList, InlineNotice, SmallText } from '../AppStyles';
import { ContentObject, FieldDependencyProvenance } from '../types';

function FieldNames({ names, label }: { names: string[]; label: string }): React.ReactElement {
    const unique = [...new Set(names)];
    if (!names.length) { return <span>No names established by the supported declaration subset</span>; }
    return <>
        <span>{names.slice(0, 12).join(', ')}</span>
        {names.length > 12 ? <CollapsiblePanel appearance="subtle" title={`All ${label} (${names.length})`}>
            <EvidenceList>{unique.map(name => <li key={name}>{name}</li>)}</EvidenceList>
        </CollapsiblePanel> : null}
    </>;
}

/** Reuses the existing detail workflow; no customer expression is displayed. */
export function FieldLineagePanel({ object }: { object: ContentObject }): React.ReactElement | null {
    const facts = object.fieldLineage;
    if (!facts) { return null; }
    let enabledLabel = 'Not exposed by native metadata';
    if (facts.enabled === true) { enabledLabel = 'Configured enabled'; }
    else if (facts.enabled === false) { enabledLabel = 'Configured disabled'; }
    const aliases = [...new Map(facts.aliases.map(mapping => [JSON.stringify(mapping), mapping])).values()];
    const reportTargets = facts.transforms.map((name, index) => ({ name, position: index + 1 }));
    const phases = { inline: 'Extraction (opaque inline regex)', report: 'Extraction (ordered REPORT targets)',
        transform: 'Transform (scope supplied by REPORT callers)', alias: 'Alias (after extraction)',
        eval: 'Calculated (parallel EVAL declarations)', lookup: 'Lookup (after aliases and calculated fields)' };
    return <section aria-label="Declared field lineage">
        <strong>Declared field lineage</strong>
        <SmallText>Configured names and provenance only—not field values, proven execution or removal approval.</SmallText>
        <DefinitionList>
            <dt>Processing phase</dt><dd>{phases[facts.operation]}</dd>
            <dt>Event scope</dt><dd>{facts.scope ? `${facts.scope.field}=${facts.scope.value}${facts.scope.exact ? ' · exact literal scope' : ' · pattern/default/encoded scope not evaluated'}` : 'Not independently established'}</dd>
            <dt>Enabled state</dt><dd>{enabledLabel}</dd>
            <dt>Supported syntax</dt><dd>{facts.syntax}</dd>
            <dt>Declared inputs</dt><dd><FieldNames names={facts.inputs} label="input names" /></dd>
            <dt>Declared outputs</dt><dd><FieldNames names={facts.outputs} label="output names" /></dd>
            {facts.aliases.length ? <><dt>Alias assignments</dt><dd><EvidenceList>
                {aliases.map(mapping => <li key={JSON.stringify(mapping)}>
                    {mapping.input} {mapping.mode} {mapping.output} · {mapping.mode === 'ASNEW' ? 'preserves an existing output' : 'can replace or remove the output'}
                </li>)}
            </EvidenceList></dd></> : null}
            {facts.transforms.length ? <><dt>REPORT order</dt><dd><ol>
                {reportTargets.map(target => <li key={target.position}>{target.name}</li>)}
            </ol></dd></> : null}
            <dt>Provenance</dt><dd>{facts.sourceLocation}</dd>
        </DefinitionList>
        <InlineNotice>Extraction → alias → parallel calculated fields → lookup. No alias-to-alias or calculated-to-calculated chain is inferred. Literal declarations do not establish effective field availability, regex matches, props precedence or the invoking app.</InlineNotice>
        {facts.limitations.length ? <EvidenceList aria-label="Field-lineage limitations">{facts.limitations.map(message => <li key={message}>{message}</li>)}</EvidenceList> : null}
    </section>;
}

export function FieldProvenanceDetails({ provenance }: { provenance?: FieldDependencyProvenance }): React.ReactElement | null {
    if (!provenance) { return null; }
    return <section aria-label="Field relationship provenance">
        <DefinitionList>
            <dt>Declared fields</dt><dd>{provenance.fields.join(', ') || 'Scope/configuration binding only—not proven field consumption'}</dd>
            <dt>Dependency phases</dt><dd>{provenance.kind === 'report_binding' ? 'REPORT configuration → named transform' : `${provenance.consumerPhase ?? 'Original-event search'} → ${provenance.producerPhase} dependency`}</dd>
            <dt>Scope</dt><dd>{provenance.scope ? `${provenance.scope.field}=${provenance.scope.value}` : 'Not established independently'}</dd>
            {provenance.transformPositions.length ? <><dt>REPORT positions</dt><dd>{provenance.transformPositions.join(', ')} (one-based)</dd></> : null}
            {provenance.viaObjectIds.length ? <><dt>Transform provenance</dt><dd>{provenance.viaObjectIds.join('; ')}</dd></> : null}
            <dt>Namespace</dt><dd>{provenance.contextApps.join(', ')} · {provenance.invocation === 'fixed_app' ? 'fixed caller app' : 'possible invoking app, unverified at runtime'}</dd>
        </DefinitionList>
    </section>;
}
