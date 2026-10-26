import { ConfidenceLevel } from '../types';

/** These edges express configuration possibilities, never observed execution. */
export function isPotentialRelation(relation: string): boolean {
    return ['may_apply_automatic_lookup', 'may_use_lookup', 'may_match_event_type', 'may_exclude_event_type',
        'may_match_tag', 'may_exclude_tag', 'may_tag_event_type', 'may_use_field_transform',
        'may_read_extracted_field', 'may_read_aliased_field', 'may_read_calculated_field',
        'may_apply_field_extraction', 'may_apply_field_alias', 'may_apply_calculated_field'].includes(relation);
}
export function weakestDependencyConfidence(first: ConfidenceLevel, second: ConfidenceLevel): ConfidenceLevel {
    const rank = { unknown: 0, low: 1, medium: 2, high: 3 };
    return rank[first] < rank[second] ? first : second;
}
