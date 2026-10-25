import { ContentObject, ReviewInput, ReviewRecord, ReviewStage } from '../types';
import { evidenceWindowFresh } from './usage';

export interface BulkReviewEntry {
    object: ContentObject;
    previous: ReviewRecord | null;
    skip: string | null;
}
export interface BulkReviewPlan {
    scanId: string;
    stage: ReviewStage;
    note: string;
    assignedTo: string;
    updateExisting: boolean;
    entries: BulkReviewEntry[];
}
export interface BulkReviewResult {
    objectId: string;
    name: string;
    objectType: string;
    app: string;
    status: 'saved' | 'skipped' | 'conflict' | 'unconfirmed' | 'failed' | 'cancelled';
    message: string;
    revisionId?: string;
    savedAt?: string;
    savedBy?: string;
}

export function planBulkReviews(
    objects: ContentObject[],
    states: ReadonlyMap<string, ReviewRecord>,
    options: Omit<BulkReviewPlan, 'entries'>,
): BulkReviewPlan {
    return {
        ...options,
        entries: [...new Map(objects.map((object) => [object.objectId, object])).values()].map(
            (object) => {
                const previous = states.get(object.objectId) ?? null;
                let skip: string | null = null;
                if (previous?.persistenceIssue) {
                    skip = 'Saved history cannot be verified; inspect this review individually.';
                } else if (previous?.removed) {
                    skip =
                        'Archived decision preserved. Restore individually, not through bulk review.';
                } else if (previous && !options.updateExisting) {
                    skip = 'Existing review preserved.';
                }
                return { object, previous, skip };
            },
        ),
    };
}

/** Sequential ordinary saves, not a transaction. Never replay an uncertain write. */
export async function runBulkReviews(
    plan: BulkReviewPlan,
    callbacks: {
        load: (id: string) => Promise<ReviewRecord | null>;
        save: (input: ReviewInput) => Promise<ReviewRecord>;
        canContinue: () => boolean;
        cancelled: () => boolean;
        progress?: (completed: number) => void;
    },
): Promise<BulkReviewResult[]> {
    const results: BulkReviewResult[] = [];
    let halted = false;
    for (let position = 0; position < plan.entries.length; position += 1) {
        const entry = plan.entries[position];
        const { object, previous } = entry;
        let result: BulkReviewResult = {
            objectId: object.objectId,
            name: object.name,
            objectType: object.objectType,
            app: object.app,
            status: 'skipped',
            message: entry.skip ?? '',
        };
        if (halted || callbacks.cancelled() || !callbacks.canContinue()) {
            result = {
                ...result,
                status: 'cancelled',
                message:
                    'Not saved: stopped, permissions changed, or the inventory snapshot changed.',
            };
        } else if (!entry.skip) {
            try {
                // eslint-disable-next-line no-await-in-loop -- Recheck and write one object at a time through the coordinator.
                const current = await callbacks.load(object.objectId);
                if (current?.persistenceIssue) {
                    throw new Error(
                        'Saved history cannot be verified. Inspect this review individually.',
                    );
                }
                if (current?.removed || (current && !plan.updateExisting)) {
                    result.message = 'Existing or archived decision preserved after recheck.';
                } else if (
                    (current?.revisionId ?? null) !== (previous?.revisionId ?? null) ||
                    (current?.updatedAt ?? null) !== (previous?.updatedAt ?? null)
                ) {
                    result = {
                        ...result,
                        status: 'conflict',
                        message:
                            'The saved review changed after confirmation. Inspect and reconcile it individually.',
                    };
                } else if (callbacks.cancelled() || !callbacks.canContinue()) {
                    result = {
                        ...result,
                        status: 'cancelled',
                        message: 'Not saved: the batch stopped before this write.',
                    };
                } else {
                    // A blank shared field preserves the existing value. Notes
                    // append; neither earlier rationale nor a baseline is replaced.
                    const note = [current?.note ?? '', plan.note.trim()]
                        .filter(Boolean)
                        .join('\n\n');
                    if (note.length > 4000) {
                        throw new Error(
                            'Appending the shared note would exceed 4,000 characters. Existing text was not truncated.',
                        );
                    }
                    const captureEvidence =
                        !current &&
                        object.reviewEvidence?.scanId === plan.scanId &&
                        evidenceWindowFresh(object.reviewEvidence.observedAt);
                    // eslint-disable-next-line no-await-in-loop -- Sequential writes preserve cancellation and coordinator conflict checks.
                    const saved = await callbacks.save({
                        object,
                        stage: plan.stage,
                        note,
                        assignedTo: plan.assignedTo.trim() || current?.assignedTo || null,
                        scanId: plan.scanId,
                        captureEvidence,
                        expectedRevisionId: previous?.revisionId ?? null,
                        expectedUpdatedAt: previous?.updatedAt ?? null,
                    });
                    result = {
                        ...result,
                        status: 'saved',
                        message: 'Saved through the ordinary review coordinator.',
                        revisionId: saved.revisionId,
                        savedAt: saved.updatedAt,
                        savedBy: saved.updatedBy,
                    };
                }
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : 'The review could not be saved.';
                let status: BulkReviewResult['status'] = 'failed';
                if (error instanceof Error && error.name === 'ReviewConflictError') {
                    status = 'conflict';
                } else if (/could not be confirmed/i.test(message)) {
                    status = 'unconfirmed';
                }
                const httpStatus =
                    error && typeof error === 'object' && 'status' in error ? error.status : null;
                if (
                    status === 'unconfirmed' ||
                    httpStatus === 401 ||
                    httpStatus === 403 ||
                    /HTTP (401|403)/.test(message)
                ) {
                    halted = true;
                }
                result = { ...result, status, message };
            }
        }
        results.push(result);
        callbacks.progress?.(results.length);
    }
    return results;
}
