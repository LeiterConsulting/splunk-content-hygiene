import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
    ButtonRow,
    DefinitionList,
    FilterField,
    InlineNotice,
    Input,
    Select,
    SmallText,
    StyledButton,
    TextArea,
    WorkflowForm,
} from '../AppStyles';
import { reviewStageOptions } from '../services/reviews';
import { evidenceWindowFresh } from '../services/usage';
import { ContentObject, ReviewInput, ReviewRecord, ReviewStage } from '../types';
import { ReviewStageBadge } from './ReviewStageBadge';
import { ReviewWorkflowContext } from './ReviewWorkflowContext';
import { ReviewHistoryPanel } from './ReviewHistoryPanel';

interface ReviewEditorProps {
    contentObject: ContentObject;
    review: ReviewRecord | null;
    scanId: string;
    canWrite: boolean;
    onSave: (input: ReviewInput) => Promise<ReviewRecord>;
    onDelete: (objectId: string, expectedRevisionId?: string | null) => Promise<void>;
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
});

export function ReviewEditor({
    contentObject,
    review: suppliedReview,
    scanId,
    canWrite,
    onSave,
    onDelete,
}: ReviewEditorProps): React.ReactElement {
    const workflow = useContext(ReviewWorkflowContext);
    const storedReview = workflow.states.get(contentObject.objectId) ?? suppliedReview;
    const [review, setBaseReview] = useState(storedReview);
    const [stage, setStage] = useState<ReviewStage>(review?.stage ?? 'triage');
    const [note, setNote] = useState(review?.note ?? '');
    const [assignedTo, setAssignedTo] = useState(review?.assignedTo ?? '');
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [needsReload, setNeedsReload] = useState(false);
    const [reconciling, setReconciling] = useState(false);
    const [compared, setCompared] = useState(false);
    const applySaved = useCallback((latest: ReviewRecord | null) => {
        setBaseReview(latest); setStage(latest?.stage ?? 'triage'); setNote(latest?.note ?? '');
        setAssignedTo(latest?.assignedTo ?? ''); setNeedsReload(false);
    }, []);
    const hasUnsavedChanges = stage !== (review?.stage ?? 'triage') || note !== (review?.note ?? '') ||
        assignedTo !== (review?.assignedTo ?? '');
    useEffect(() => {
        const newer = storedReview && (!review ||
            (storedReview.revisionNumber ?? 0) > (review.revisionNumber ?? 0) ||
            (storedReview.revisionNumber === 0 && review.revisionNumber === 0 && storedReview.revisionId !== review.revisionId));
        if (!isSaving && !hasUnsavedChanges && newer) {
            applySaved(storedReview);
        }
    }, [storedReview, review, isSaving, hasUnsavedChanges, applySaved]);

    useEffect(() => {
        setMessage(null);
        setError(null);
    }, [contentObject.objectId]);

    const canCapture = contentObject.reviewEvidence?.scanId === scanId &&
        evidenceWindowFresh(contentObject.reviewEvidence.observedAt);
    const writable = canWrite && !review?.persistenceIssue && !needsReload;
    const handleSave = async (captureEvidence = false): Promise<void> => {
        setIsSaving(true);
        setMessage(null);
        setError(null);
        try {
            const saved = await onSave({
                object: contentObject,
                stage,
                note,
                assignedTo: assignedTo || null,
                scanId,
                captureEvidence: captureEvidence || (!review && canCapture),
                expectedUpdatedAt: review?.updatedAt ?? null,
                expectedRevisionId: review?.revisionId ?? null,
            });
            setStage(saved.stage);
            setNote(saved.note);
            setAssignedTo(saved.assignedTo ?? '');
            setBaseReview(saved); setNeedsReload(false); setReconciling(false); setCompared(false);
            setMessage(captureEvidence ? 'Evidence baseline captured. The saved decision is unchanged; coverage limits still apply.' : 'Review record saved to the app-local library.');
        } catch (saveError) {
            setNeedsReload(saveError instanceof Error &&
                (saveError.name === 'ReviewConflictError' || saveError.message.includes('could not be confirmed')));
            setError(
                saveError instanceof Error
                    ? saveError.message
                    : 'Unable to save this review record.',
            );
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (): Promise<void> => {
        setIsSaving(true);
        setMessage(null);
        setError(null);
        try {
            await onDelete(contentObject.objectId, review?.revisionId ?? null);
            applySaved(workflow.reload ? await workflow.reload(contentObject.objectId) : null);
            setMessage(
                'Removed from the active app-local review library. Saved decisions and revisions are retained; the Splunk object was not changed.',
            );
        } catch (deleteError) {
            setNeedsReload(deleteError instanceof Error && deleteError.name === 'ReviewConflictError');
            setError(
                deleteError instanceof Error
                    ? deleteError.message
                    : 'Unable to remove this review record.',
            );
        } finally {
            setIsSaving(false);
        }
    };
    const reload = async (keepDraft: boolean): Promise<void> => {
        if (!workflow.reload) { return; }
        setIsSaving(true); setError(null); setMessage(null);
        try {
            const latest = await workflow.reload(contentObject.objectId);
            if (keepDraft) { setBaseReview(latest); setNeedsReload(false); setReconciling(true); }
            else { applySaved(latest); setReconciling(false); }
            setCompared(keepDraft);
            setMessage(keepDraft ? 'Latest saved revision loaded for comparison. Your draft is retained. Reconcile the values below before saving.' : 'Saved values loaded. No decision was changed.');
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to reload the saved review.'); }
        finally { setIsSaving(false); }
    };
    let saveLabel = 'Add to review library';
    if (isSaving) {
        saveLabel = 'Saving…';
    } else if (reconciling) {
        saveLabel = 'Save reconciled draft';
    } else if (review?.removed) {
        saveLabel = 'Restore to review library';
    } else if (review) {
        saveLabel = 'Update review record';
    }

    return (
        <>
            {review ? (
                <DefinitionList>
                    <dt>Current stage</dt>
                    <dd>
                        <ReviewStageBadge stage={review.stage} />
                        {review.removed ? ' · Archived; decision retained' : ''}
                    </dd>
                    <dt>Last updated</dt>
                    <dd>
                        {Number.isNaN(Date.parse(review.updatedAt)) ? 'Unknown time' : dateFormatter.format(new Date(review.updatedAt))} by {review.updatedBy}
                    </dd>
                    <dt>Source scan</dt>
                    <dd>{review.scanId}</dd>
                    <dt>Saved revision</dt>
                    <dd>{review.revisionNumber ?? 0}{review.revisionNumber === 0 ? ' · preserved legacy record' : ''}</dd>
                </DefinitionList>
            ) : (
                <SmallText>This object is not yet in the review library.</SmallText>
            )}
            {review?.persistenceIssue ? <InlineNotice role="alert">{review.persistenceIssue}</InlineNotice> : null}
            {needsReload ? <InlineNotice role="alert">Your draft has not been discarded. Compare with the latest saved revision before retrying. No automatic merge or overwrite was performed.</InlineNotice> : null}
            {compared ? <InlineNotice>
                <strong>Latest saved values — compare with your draft</strong>
                <DefinitionList><dt>State</dt><dd>{review?.removed ? 'Archived' : 'Active'}</dd>
                    <dt>Stage</dt><dd>{review?.stage.replace(/_/g, ' ') ?? 'Not in library'}</dd>
                    <dt>Assigned reviewer</dt><dd>{review?.assignedTo ?? 'Unassigned'}</dd>
                    <dt>Saved note</dt><dd>{review?.note || 'No note'}</dd></DefinitionList>
            </InlineNotice> : null}

            <WorkflowForm
                onSubmit={(event) => {
                    event.preventDefault();
                    handleSave().catch(() => undefined);
                }}
            >
                <FilterField>
                    Confirmation stage
                    <Select
                        value={stage}
                        disabled={!canWrite || isSaving || Boolean(review?.persistenceIssue)}
                        onChange={(event) => setStage(event.currentTarget.value as ReviewStage)}
                    >
                        {reviewStageOptions.map((option) => (
                            <option value={option.value} key={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </Select>
                </FilterField>
                <FilterField>
                    Assigned reviewer
                    <Input
                        value={assignedTo}
                        maxLength={256}
                        disabled={!canWrite || isSaving || Boolean(review?.persistenceIssue)}
                        placeholder="Splunk user or team"
                        onChange={(event) => setAssignedTo(event.currentTarget.value)}
                    />
                </FilterField>
                <FilterField>
                    Investigation note
                    <TextArea
                        value={note}
                        maxLength={4000}
                        disabled={!canWrite || isSaving || Boolean(review?.persistenceIssue)}
                        onChange={(event) => setNote(event.currentTarget.value)}
                    />
                </FilterField>
                <SmallText>
                    Record evidence checked, the owner response, blockers, or the decision
                    rationale.
                </SmallText>
                <SmallText>
                    Saves only an app-local workflow record. It does not modify, disable, or remove
                    this Splunk object.
                </SmallText>
                <SmallText>
                    {review
                        ? 'Updating notes or stages does not reset the evidence baseline. After investigating changes, explicitly reaffirm evidence. Save form edits first.'
                        : 'A new record captures the current evidence baseline when a recent fingerprint is available. Incomplete coverage remains unverified.'}
                </SmallText>
                <ButtonRow>
                    <StyledButton type="submit" $primary disabled={!writable || isSaving}>
                        {saveLabel}
                    </StyledButton>
                    {review && !review.removed ? (
                        <StyledButton
                            type="button"
                            disabled={!writable || isSaving || !canCapture || hasUnsavedChanges}
                            onClick={() => handleSave(true).catch(() => undefined)}
                        >
                            {review.evidenceBaseline ? 'Reaffirm review evidence' : 'Capture review evidence'}
                        </StyledButton>
                    ) : null}
                    {review && !review.removed ? (
                        <StyledButton
                            type="button"
                            disabled={!writable || isSaving}
                            onClick={() => handleDelete().catch(() => undefined)}
                        >
                            Remove library record
                        </StyledButton>
                    ) : null}
                    {workflow.reload ? <>
                        <StyledButton type="button" disabled={isSaving} onClick={() => reload(true).catch(() => undefined)}>Compare with latest saved review</StyledButton>
                        {(compared || needsReload) ? <StyledButton type="button" disabled={isSaving} onClick={() => reload(false).catch(() => undefined)}>Use saved values</StyledButton> : null}
                    </> : null}
                </ButtonRow>
            </WorkflowForm>
            {(message || error) && (
                <InlineNotice role={error ? 'alert' : 'status'}>{error ?? message}</InlineNotice>
            )}
            <ReviewHistoryPanel objectId={contentObject.objectId} />
        </>
    );
}
