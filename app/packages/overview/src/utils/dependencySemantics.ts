import { ConfidenceLevel } from '../types';

/** These edges express configuration possibilities, never observed execution. */
export function isPotentialRelation(relation: string): boolean {
    return relation === 'may_apply_automatic_lookup' || relation === 'may_use_lookup';
}
export function weakestDependencyConfidence(first: ConfidenceLevel, second: ConfidenceLevel): ConfidenceLevel {
    const rank = { unknown: 0, low: 1, medium: 2, high: 3 };
    return rank[first] < rank[second] ? first : second;
}
