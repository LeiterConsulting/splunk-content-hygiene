import { reviewRecordFromKv } from '../services/reviews';

test('normalizes app-local review records and rejects unknown stages', () => {
    const review = reviewRecordFromKv({
        _key: 'review-key',
        object_id: 'dashboard::search::retired_host_report',
        object_name: 'Retired Host Report',
        canonical_name: 'retired_host_report',
        object_type: 'Dashboard',
        app: 'search',
        owner: null,
        health_status_at_review: 'dormant',
        stage: 'unsupported-stage',
        note: 'Owner confirmation required',
        assigned_to: 'platform-team',
        scan_id: 'scan-live-test',
        created_at: '2026-07-24T17:00:00Z',
        updated_at: '2026-07-24T18:00:00Z',
        updated_by: 'analyst',
    });

    expect(review.stage).toBe('triage');
    expect(review.healthStatusAtReview).toBe('dormant');
    expect(review.assignedTo).toBe('platform-team');
});
