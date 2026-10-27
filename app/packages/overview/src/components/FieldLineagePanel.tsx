import React from 'react';
import CollapsiblePanel from '@splunk/react-ui/CollapsiblePanel';
import { DefinitionList, EvidenceList, InlineNotice, SmallText } from '../AppStyles';
import { ContentObject, ExtractionOutputProvenance, FieldDependencyProvenance } from '../types';
import { PropsContextPanel } from './PropsContextPanel';
import { CrossStanzaPropsPanel } from './CrossStanzaPropsPanel';

const outputMethods: Record<ExtractionOutputProvenance['method'], string> = {
    inline_named_captures: 'Inline named captures', transform_named_captures: 'Transform named captures',
    transform_format: 'Literal FORMAT capture mapping', transform_fields: 'Literal DELIMS/FIELDS mapping',
};

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
    const phases = { inline: 'Extraction (declared inline regex)', report: 'Extraction (ordered REPORT targets)',
        transform: 'Transform (scope supplied by REPORT callers)', alias: 'Alias (after extraction)',
        eval: 'Calculated (parallel EVAL declarations)', lookup: 'Lookup (after aliases and calculated fields)' };
    let lookupMode = 'Output columns are not enumerated; no lookup data is read.';
    if (facts.lookupMapping?.outputMode === 'OUTPUTNEW') { lookupMode = 'OUTPUTNEW preserves each existing event output field.'; }
    else if (facts.lookupMapping?.outputMode === 'OUTPUT') { lookupMode = 'OUTPUT may overwrite or clear event output fields when no lookup row matches.'; }
    return <section aria-label="Declared field lineage">
        <strong>Declared field lineage</strong>
        <SmallText>Configured names and provenance only—not field values, proven execution or removal approval.</SmallText>
        {facts.operation !== 'transform' ? <PropsContextPanel key={object.objectId} rows={facts.propsContexts} truncated={facts.propsContextsTruncated} /> : null}
        {facts.operation !== 'transform' ? <CrossStanzaPropsPanel key={`cross-${object.objectId}`} rows={facts.crossStanzaProps} truncated={facts.crossStanzaPropsTruncated} /> : null}
        <DefinitionList>
            <dt>Processing phase</dt><dd>{phases[facts.operation]}</dd>
            <dt>Event scope</dt><dd>{facts.scope ? `${facts.scope.field}=${facts.scope.value}${facts.scope.exact ? ' · exact literal scope' : ' · pattern/default/encoded scope not evaluated'}` : 'Not independently established'}</dd>
            <dt>Enabled state</dt><dd>{enabledLabel}</dd>
            <dt>Supported syntax</dt><dd>{facts.syntax}</dd>
            <dt>Declared inputs</dt><dd><FieldNames names={facts.inputs} label="input names" /></dd>
            <dt>Declared outputs</dt><dd><FieldNames names={facts.outputs} label="output names" /></dd>
            {facts.lookupMapping ? <><dt>Lookup mappings</dt><dd>
                <SmallText>{lookupMode}</SmallText>
                <CollapsiblePanel appearance="subtle" title="Configured lookup field mappings">
                    <EvidenceList aria-label="Configured lookup field mappings">
                        {facts.lookupMapping.inputs.map(row => <li key={`in-${row.position}`}>Input {row.position}: lookup column <strong>{row.lookupField}</strong> ← event field <strong>{row.eventField}</strong></li>)}
                        {facts.lookupMapping.outputs.map(row => <li key={`out-${row.position}`}>{facts.lookupMapping!.outputMode} {row.position}: lookup column <strong>{row.lookupField}</strong> → event field <strong>{row.eventField}</strong></li>)}
                    </EvidenceList>
                </CollapsiblePanel>
            </dd></> : null}
            {facts.outputProvenance ? <><dt>Output attribution</dt><dd>
                {outputMethods[facts.outputProvenance.method]}
                <SmallText>Input: {facts.outputProvenance.sourceField ?? 'not established'} · {facts.outputProvenance.sourceOrigin.replace(/_/g, ' ')}.
                    {facts.outputProvenance.regexCaptureCount !== null ? ` ${facts.outputProvenance.regexCaptureCount} declared capture group(s).` : ''}</SmallText>
                <CollapsiblePanel appearance="subtle" title={`Output declaration locations (${facts.outputProvenance.declarations.length})`}>
                    <SmallText>Offsets are zero-based UTF-16 positions in the named native attribute. Capture numbers are one-based. Patterns and event values are not cached.</SmallText>
                    <EvidenceList aria-label="Output declaration locations">{facts.outputProvenance.declarations.map(item => <li key={`${item.attribute}-${item.offset}-${item.field}-${item.capture}`}>
                        <strong>{item.field}</strong> · {item.capture === null ? 'literal field list' : `capture ${item.capture}`} · {item.attribute} offset {item.offset}
                    </li>)}</EvidenceList>
                </CollapsiblePanel>
            </dd></> : null}
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
    let phases = `${provenance.consumerPhase ?? 'Original-event search'} → ${provenance.producerPhase} dependency`;
    if (provenance.kind === 'report_binding') { phases = 'REPORT configuration → named transform'; }
    else if (provenance.kind === 'lookup_binding') { phases = 'LOOKUP configuration → named lookup definition (not a lookup execution chain)'; }
    return <section aria-label="Field relationship provenance">
        <PropsContextPanel rows={provenance.propsContexts} truncated={provenance.propsContextsTruncated} />
        {provenance.kind === 'event_scope' ? <CrossStanzaPropsPanel rows={provenance.crossStanzaProps} truncated={provenance.crossStanzaPropsTruncated} /> : null}
        <DefinitionList>
            <dt>Declared fields</dt><dd>{provenance.fields.join(', ') || 'Scope/configuration binding only—not proven field consumption'}</dd>
            <dt>Dependency phases</dt><dd>{phases}</dd>
            <dt>Scope</dt><dd>{provenance.scope ? `${provenance.scope.field}=${provenance.scope.value}` : 'Not established independently'}</dd>
            {provenance.transformPositions.length ? <><dt>REPORT positions</dt><dd>{provenance.transformPositions.join(', ')} (one-based)</dd></> : null}
            {provenance.viaObjectIds.length ? <><dt>Transform provenance</dt><dd>{provenance.viaObjectIds.join('; ')}</dd></> : null}
            <dt>Namespace</dt><dd>{provenance.contextApps.join(', ')} · {provenance.invocation === 'fixed_app' ? 'fixed caller app' : 'possible invoking app, unverified at runtime'}</dd>
            {provenance.contexts?.length ? <><dt>Configuration contexts</dt><dd>
                <SmallText>Candidate bindings only, not an effective-props winner. Other relationship rows can represent alternatives. Cross-scope, system and user-private precedence remain unverified.</SmallText>
                <CollapsiblePanel appearance="subtle" title={`Possible configuration contexts (${provenance.contexts.length})`}>
                    <EvidenceList aria-label="Possible configuration contexts">{provenance.contexts.map(row => <li key={JSON.stringify(row)}>
                        <strong>Invoking app: {row.invokingApp}</strong>
                        <SmallText>Source: {row.declaringApp} · {row.declaration.replace(/_/g, ' ')}. Dependency: {row.dependencyApp ?? 'not resolved'} · {row.dependency.replace(/_/g, ' ')}.</SmallText>
                        {row.selector ? <SmallText>Original selector: {row.selector.field}={row.selector.value} · {row.selector.sourceLocation}. Case-insensitive literal comparison; native identities are unchanged.</SmallText> : null}
                    </li>)}</EvidenceList>
                </CollapsiblePanel>
            </dd></> : <><dt>Configuration contexts</dt><dd>Not recorded by this snapshot. Run a complete scan to collect context evidence.</dd></>}
            {provenance.outputDeclarations?.length ? <><dt>Output attribution</dt><dd>
                <CollapsiblePanel appearance="subtle" title={`Matched output declarations (${provenance.outputDeclarations.length})`}>
                    <SmallText>Declared producer locations, not proof of matching or field availability. Offsets are zero-based UTF-16; capture numbers are one-based.</SmallText>
                    <EvidenceList aria-label="Matched output declaration locations">{provenance.outputDeclarations.map(item => <li key={`${item.objectId}-${item.attribute}-${item.offset}-${item.field}-${item.capture}`}>
                        <strong>{item.field}</strong> · {outputMethods[item.method]} · {item.capture === null ? 'literal field list' : `capture ${item.capture}`} · {item.attribute} offset {item.offset}
                        <SmallText>{item.objectId}</SmallText>
                    </li>)}</EvidenceList>
                </CollapsiblePanel>
            </dd></> : null}
        </DefinitionList>
    </section>;
}
