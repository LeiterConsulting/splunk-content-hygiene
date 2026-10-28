// Synthetic bounded-evidence contracts only; never imported by production code.
import { DependencyEdge, PropsCallerWitness } from '../types';
import { edge, object, snapshot } from './milestoneFixtures';

export function callerReceipt(changes: Partial<PropsCallerWitness> = {}): PropsCallerWitness {
    return { callerObjectId: 'caller', app: 'example', sourceLocation: 'dashboard.panel[0].query', selectors: [
        { field: 'sourcetype', value: 'access', sourceLocation: 'dashboard.panel[0].query:0' },
        { field: 'host', value: 'web-01', sourceLocation: 'dashboard.panel[0].query:18' },
    ], ...changes };
}
export function scopedEdge(source: string, target: string, callers: PropsCallerWitness[] = [callerReceipt()], apps = ['example']): DependencyEdge {
    return { ...edge(source, target, 'may_read_aliased_field'), confidence: 'medium', fieldProvenance: {
        version: 1, kind: 'field_input', fields: ['actor'], scope: { field: 'sourcetype', value: 'access', exact: true },
        consumerPhase: 'calculated', producerPhase: 'alias', transformPositions: [], viaObjectIds: [], contextApps: apps, invocation: 'fixed_app',
        scopeCompatibility: { version: 1, basis: 'captured_conjunction', consumer: { field: 'sourcetype', value: 'access', exact: true },
            producer: { field: 'host', value: 'web-01', exact: true }, callerWitnesses: callers },
    } };
}
export function pathFixture() {
    const objects = [object('caller', 'Dashboard'), object('other-caller', 'Report'), object('a', 'Calculated Field'),
        object('b', 'Field Alias'), object('c', 'Field Extraction'), { ...object('other-app-caller', 'Report'), app: 'other' }];
    const entry = { ...edge('caller', 'a', 'may_apply_calculated_field'), confidence: 'medium' as const,
        fieldProvenance: { ...scopedEdge('a', 'b').fieldProvenance!, kind: 'event_scope' as const, consumerPhase: null,
            scopeCompatibility: undefined, contexts: [{ declaringApp: 'example', dependencyApp: 'example', invokingApp: 'example',
                declaration: 'local_candidate' as const, dependency: 'local_candidate' as const,
                selector: callerReceipt().selectors[0] }] } };
    const edges = [entry, scopedEdge('a', 'b'), scopedEdge('b', 'c')];
    const data = snapshot(objects, edges);
    return { data, objects, edges, byId: new Map(objects.map(item => [item.objectId, item])) };
}
