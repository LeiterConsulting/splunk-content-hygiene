import { planBulkReviews, runBulkReviews } from '../services/bulkReviews';
import { ReviewInput } from '../types';
import { attachReviewEvidence, configurationFingerprint } from '../services/reviewEvidence';
import { now, object, review } from './milestoneFixtures';

const options = {
    scanId: 'scan-fixture',
    stage: 'retain' as const,
    note: '',
    assignedTo: '',
    updateExisting: false,
};
const saved = jest.fn(async (input: ReviewInput) =>
    review(input.object.objectId, { note: input.note }),
);
beforeEach(() => {
    saved.mockClear();
    jest.spyOn(Date, 'now').mockReturnValue(now);
});
afterEach(() => jest.restoreAllMocks());
const callbacks = (load = jest.fn().mockResolvedValue(null)) => ({
    load,
    save: saved,
    canContinue: () => true,
    cancelled: () => false,
});

test('deduplicates selection and skips every existing, archived or unverifiable decision by default', async () => {
    const states = new Map([
        ['old', review('old')],
        ['archived', review('archived', { removed: true })],
        ['broken', review('broken', { persistenceIssue: 'bad history' })],
    ]);
    const plan = planBulkReviews(
        ['new', 'new', 'old', 'archived', 'broken'].map((id) => object(id)),
        states,
        options,
    );
    const results = await runBulkReviews(plan, callbacks());
    expect(plan.entries).toHaveLength(4);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(results.map((row) => row.status)).toEqual(['saved', 'skipped', 'skipped', 'skipped']);
    expect(saved.mock.calls[0][0]).toMatchObject({
        expectedRevisionId: null,
        expectedUpdatedAt: null,
    });
});
test('explicit existing updates append rationale, preserve blank assignees and never reaffirm evidence', async () => {
    const previous = review('old');
    const plan = planBulkReviews([object('old')], new Map([['old', previous]]), {
        ...options,
        updateExisting: true,
        note: 'New shared reason',
    });
    await runBulkReviews(plan, callbacks(jest.fn().mockResolvedValue(previous)));
    expect(saved.mock.calls[0][0]).toMatchObject({
        note: 'Original rationale\n\nNew shared reason',
        assignedTo: 'original-team',
        captureEvidence: false,
        expectedRevisionId: 'revision-1',
        expectedUpdatedAt: previous.updatedAt,
    });
});
test('new reviews use the ordinary per-object evidence capture when a current manifest is available', async () => {
    const source = {
        ...object('new'),
        configurationFingerprint: configurationFingerprint(
            { definition: 'index=unit_test' },
            {
                app: 'example',
                owner: 'reviewer',
                sharing: 'app',
                perms: { read: ['user'], write: ['admin'] },
            },
        ),
    };
    const [prepared] = await attachReviewEvidence([source], [], {
        scanId: 'scan-fixture',
        observedAt: new Date(now).toISOString(),
        principal: 'reviewer',
        roles: ['hygiene_reviewer'],
        mode: 'full',
        collectionComplete: true,
        analysisComplete: true,
        collectors: { macros: true },
    });
    await runBulkReviews(planBulkReviews([prepared], new Map(), options), callbacks());
    expect(saved.mock.calls[0][0].captureEvidence).toBe(true);
});
test('newly created reviews are skipped after a fresh default-policy recheck', async () => {
    const plan = planBulkReviews([object('new')], new Map(), options);
    const result = await runBulkReviews(
        plan,
        callbacks(jest.fn().mockResolvedValue(review('new'))),
    );
    expect(result[0].status).toBe('skipped');
    expect(saved).not.toHaveBeenCalled();
});
test('updates reject stale revision tokens without overwriting a newer review', async () => {
    const previous = review('old');
    const plan = planBulkReviews([object('old')], new Map([['old', previous]]), {
        ...options,
        updateExisting: true,
    });
    const result = await runBulkReviews(
        plan,
        callbacks(jest.fn().mockResolvedValue({ ...previous, revisionId: 'revision-2' })),
    );
    expect(result[0].status).toBe('conflict');
    expect(saved).not.toHaveBeenCalled();
});
test('archived reviews are never restored by the explicit update option', async () => {
    const previous = review('old', { removed: true });
    const result = await runBulkReviews(
        planBulkReviews([object('old')], new Map([['old', previous]]), {
            ...options,
            updateExisting: true,
        }),
        callbacks(),
    );
    expect(result[0].status).toBe('skipped');
    expect(saved).not.toHaveBeenCalled();
});
test('cancellation preserves completed writes and reports every remaining item as not saved', async () => {
    const plan = planBulkReviews(
        ['a', 'b', 'c'].map((id) => object(id)),
        new Map(),
        options,
    );
    const result = await runBulkReviews(plan, {
        ...callbacks(),
        cancelled: () => saved.mock.calls.length > 0,
    });
    expect(result.map((row) => row.status)).toEqual(['saved', 'cancelled', 'cancelled']);
    expect(saved).toHaveBeenCalledTimes(1);
});
test('snapshot or capability changes after the server read stop the write', async () => {
    let current = true;
    const result = await runBulkReviews(planBulkReviews([object('a')], new Map(), options), {
        ...callbacks(),
        load: async () => {
            current = false;
            return null;
        },
        canContinue: () => current,
    });
    expect(result[0].status).toBe('cancelled');
    expect(saved).not.toHaveBeenCalled();
});
test('uncertain writes halt the remainder and are never replayed', async () => {
    const save = jest
        .fn()
        .mockRejectedValueOnce(new Error('The save could not be confirmed.'))
        .mockRejectedValueOnce(
            Object.assign(new Error('Changed elsewhere'), { name: 'ReviewConflictError' }),
        );
    const result = await runBulkReviews(
        planBulkReviews(
            ['a', 'b'].map((id) => object(id)),
            new Map(),
            options,
        ),
        { ...callbacks(), save },
    );
    expect(result.map((row) => row.status)).toEqual(['unconfirmed', 'cancelled']);
    expect(save).toHaveBeenCalledTimes(1);
});
test('permission errors halt the queue rather than repeating unauthorized requests', async () => {
    const load = jest.fn().mockRejectedValue(Object.assign(new Error('HTTP 403'), { status: 403 }));
    const result = await runBulkReviews(
        planBulkReviews(
            ['a', 'b'].map((id) => object(id)),
            new Map(),
            options,
        ),
        callbacks(load),
    );
    expect(result.map((row) => row.status)).toEqual(['failed', 'cancelled']);
    expect(load).toHaveBeenCalledTimes(1);
    expect(saved).not.toHaveBeenCalled();
});
test('shared notes cannot silently truncate original rationale', async () => {
    const previous = review('old', { note: 'x'.repeat(3999) });
    const result = await runBulkReviews(
        planBulkReviews([object('old')], new Map([['old', previous]]), {
            ...options,
            updateExisting: true,
            note: 'new',
        }),
        callbacks(jest.fn().mockResolvedValue(previous)),
    );
    expect(result[0].status).toBe('failed');
    expect(result[0].message).toMatch(/not truncated/);
    expect(saved).not.toHaveBeenCalled();
});
