import React, { useEffect, useState } from 'react';
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
import {
    ContentObject,
    ReviewInput,
    ReviewRecord,
    ReviewStage,
} from '../types';
import { ReviewStageBadge } from './ReviewStageBadge';

interface ReviewEditorProps {
    contentObject: ContentObject;
    review: ReviewRecord | null;
    scanId: string;
    canWrite: boolean;
    onSave: (input: ReviewInput) => Promise<ReviewRecord>;
    onDelete: (objectId: string) => Promise<void>;
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
    review,
    scanId,
    canWrite,
    onSave,
    onDelete,
}: ReviewEditorProps): React.ReactElement {
    const [stage, setStage] = useState<ReviewStage>(
        review?.stage ?? 'triage'
    );
    const [note, setNote] = useState(review?.note ?? '');
    const [assignedTo, setAssignedTo] = useState(review?.assignedTo ?? '');
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setStage(review?.stage ?? 'triage');
        setNote(review?.note ?? '');
        setAssignedTo(review?.assignedTo ?? '');
    }, [contentObject.objectId, review?.stage, review?.note, review?.assignedTo]);

    useEffect(() => {
        setMessage(null);
        setError(null);
    }, [contentObject.objectId]);

    const handleSave = async (): Promise<void> => {
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
            });
            setStage(saved.stage);
            setNote(saved.note);
            setAssignedTo(saved.assignedTo ?? '');
            setMessage('Review record saved to the app-local library.');
        } catch (saveError) {
            setError(
                saveError instanceof Error
                    ? saveError.message
                    : 'Unable to save this review record.'
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
            await onDelete(contentObject.objectId);
            setStage('triage');
            setNote('');
            setAssignedTo('');
            setMessage(
                'Removed from the app-local review library. The Splunk object was not changed.'
            );
        } catch (deleteError) {
            setError(
                deleteError instanceof Error
                    ? deleteError.message
                    : 'Unable to remove this review record.'
            );
        } finally {
            setIsSaving(false);
        }
    };
    let saveLabel = 'Add to review library';
    if (isSaving) {
        saveLabel = 'Saving…';
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
                    </dd>
                    <dt>Last updated</dt>
                    <dd>
                        {dateFormatter.format(new Date(review.updatedAt))} by{' '}
                        {review.updatedBy}
                    </dd>
                    <dt>Source scan</dt>
                    <dd>{review.scanId}</dd>
                </DefinitionList>
            ) : (
                <SmallText>
                    This object is not yet in the review library.
                </SmallText>
            )}

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
                        disabled={!canWrite || isSaving}
                        onChange={(event) =>
                            setStage(event.currentTarget.value as ReviewStage)
                        }
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
                        disabled={!canWrite || isSaving}
                        placeholder="Splunk user or team"
                        onChange={(event) =>
                            setAssignedTo(event.currentTarget.value)
                        }
                    />
                </FilterField>
                <FilterField>
                    Investigation note
                    <TextArea
                        value={note}
                        maxLength={4000}
                        disabled={!canWrite || isSaving}
                        placeholder="Record evidence checked, owner response, blockers, or decision rationale."
                        onChange={(event) => setNote(event.currentTarget.value)}
                    />
                </FilterField>
                <SmallText>
                    Saves only an app-local workflow record. It does not modify,
                    disable, or remove this Splunk object.
                </SmallText>
                <ButtonRow>
                    <StyledButton
                        type="submit"
                        $primary
                        disabled={!canWrite || isSaving}
                    >
                        {saveLabel}
                    </StyledButton>
                    {review ? (
                        <StyledButton
                            type="button"
                            disabled={!canWrite || isSaving}
                            onClick={() =>
                                handleDelete().catch(() => undefined)
                            }
                        >
                            Remove library record
                        </StyledButton>
                    ) : null}
                </ButtonRow>
            </WorkflowForm>
            {(message || error) && (
                <InlineNotice role={error ? 'alert' : 'status'}>
                    {error ?? message}
                </InlineNotice>
            )}
        </>
    );
}
