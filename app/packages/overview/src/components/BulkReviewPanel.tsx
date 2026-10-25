import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import Checkbox from '@splunk/react-ui/Checkbox';
import Modal from '@splunk/react-ui/Modal';
import {
    ButtonRow,
    FilterField,
    InlineNotice,
    Input,
    ReviewFields,
    Select,
    SmallText,
    StyledButton,
    Table,
    TableScroller,
    TextArea,
} from '../AppStyles';
import {
    BulkReviewPlan,
    BulkReviewResult,
    planBulkReviews,
    runBulkReviews,
} from '../services/bulkReviews';
import { reviewStageOptions } from '../services/reviews';
import { ContentObject, ReviewInput, ReviewRecord, ReviewStage } from '../types';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { navigateToView } from '../utils/navigation';
import { ResultPagination } from './ResultPagination';
import { ReviewWorkflowContext } from './ReviewWorkflowContext';
import { useReviewNavigation } from './ReviewNavigationContext';

export function BulkReviewPanel({
    objects,
    scanId,
    reviews,
    canWrite,
    onSave,
}: {
    objects: ContentObject[];
    scanId: string;
    reviews: ReviewRecord[];
    canWrite: boolean;
    onSave: (input: ReviewInput) => Promise<ReviewRecord>;
}): React.ReactElement {
    const workflow = useContext(ReviewWorkflowContext);
    const { navigate, setDraft } = useReviewNavigation();
    const trigger = useRef<HTMLButtonElement | null>(null);
    const cancel = useRef(false);
    const running = useRef(false);
    const live = useRef({ scanId, canWrite, onSave, workflow });
    live.current = { scanId, canWrite, onSave, workflow };
    const [open, setOpen] = useState(false);
    const [phase, setPhase] = useState<'edit' | 'confirm' | 'results'>('edit');
    const [stage, setStage] = useState<ReviewStage>('retain');
    const [note, setNote] = useState('');
    const [assignedTo, setAssignedTo] = useState('');
    const [updateExisting, setUpdateExisting] = useState(false);
    const [plan, setPlan] = useState<BulkReviewPlan | null>(null);
    const [results, setResults] = useState<BulkReviewResult[]>([]);
    const [busy, setBusy] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [page, setPage] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const close = useCallback(() => {
        if (!running.current) {
            setOpen(false);
        }
    }, []);
    useEffect(() => {
        if (!open) {
            return undefined;
        }
        setDraft({ objectId: 'bulk-review', dirty: phase !== 'results', busy, onDiscard: close });
        return () => setDraft({ objectId: 'bulk-review', dirty: false, busy: false });
    }, [open, phase, busy, close, setDraft]);
    useEffect(
        () => () => {
            cancel.current = true;
        },
        [],
    );

    const preview = (): void => {
        const states = new Map(reviews.map((review) => [review.objectId, review]));
        workflow.states.forEach((review, id) => states.set(id, review));
        setPlan(
            planBulkReviews(objects, states, { scanId, stage, note, assignedTo, updateExisting }),
        );
        setPhase('confirm');
        setPage(0);
    };
    const execute = async (retry = false): Promise<void> => {
        if (!plan || running.current) {
            return;
        }
        running.current = true;
        cancel.current = false;
        setBusy(true);
        setStopping(false);
        const failed = new Set(
            results.filter((result) => result.status === 'failed').map((result) => result.objectId),
        );
        const pending = retry
            ? {
                  ...plan,
                  entries: plan.entries.filter((entry) => failed.has(entry.object.objectId)),
              }
            : plan;
        setProgress({ done: 0, total: pending.entries.length });
        try {
            const updated = await runBulkReviews(pending, {
                load: (id) => {
                    const { reload } = live.current.workflow;
                    if (!reload) {
                        throw new Error(
                            'Current server review recheck is unavailable; no write attempted.',
                        );
                    }
                    return reload(id);
                },
                save: (input) => live.current.onSave(input),
                canContinue: () => live.current.canWrite && live.current.scanId === plan.scanId,
                cancelled: () => cancel.current,
                progress: (done) => setProgress({ done, total: pending.entries.length }),
            });
            const merged = new Map(
                (retry ? results : []).map((result) => [result.objectId, result]),
            );
            updated.forEach((result) => merged.set(result.objectId, result));
            setResults([...merged.values()]);
            setPhase('results');
            setPage(0);
        } finally {
            running.current = false;
            setBusy(false);
        }
    };
    const counts = results.reduce<Record<string, number>>(
        (all, result) => ({ ...all, [result.status]: (all[result.status] ?? 0) + 1 }),
        {},
    );
    const types =
        plan?.entries.reduce<Record<string, number>>(
            (all, entry) => ({
                ...all,
                [entry.object.objectType]: (all[entry.object.objectType] ?? 0) + 1,
            }),
            {},
        ) ?? {};
    const existing = plan?.entries.filter((entry) => entry.previous).length ?? 0;
    const skipped = plan?.entries.filter((entry) => entry.skip).length ?? 0;
    const exportJson = (): void =>
        downloadJson('content-hygiene-bulk-review.json', {
            exportedAt: new Date().toISOString(),
            scanId: plan?.scanId,
            stage: plan?.stage,
            existingPolicy: plan?.updateExisting
                ? 'update active; append note; preserve blank assignee'
                : 'skip existing',
            results,
        });
    let title = 'Review selected candidates';
    if (busy) {
        title = 'Saving app-local reviews';
    } else if (phase === 'confirm') {
        title = 'Confirm bulk review';
    } else if (phase === 'results') {
        title = 'Bulk review results';
    }
    const save = (retry = false): void => {
        setError(null);
        execute(retry).catch((failure) =>
            setError(
                failure instanceof Error
                    ? failure.message
                    : 'The batch could not finish. Recheck individual saved reviews before retrying.',
            ),
        );
    };
    return (
        <>
            <StyledButton
                ref={trigger}
                disabled={!canWrite || !objects.length}
                onClick={() => {
                    setOpen(true);
                    setPhase('edit');
                    setStage('retain');
                    setNote('');
                    setAssignedTo('');
                    setUpdateExisting(false);
                    setPlan(null);
                    setResults([]);
                    setPage(0);
                    setError(null);
                }}
            >
                Review {objects.length} selected
            </StyledButton>
            <Modal
                open={open}
                onRequestClose={close}
                returnFocus={trigger}
                style={{ width: 960, maxWidth: 'calc(100vw - 32px)' }}
            >
                <Modal.Header title={title} />
                <Modal.Body
                    data-content-hygiene-portal="true"
                    style={{ maxHeight: '65vh', overflowY: 'auto', overflowWrap: 'anywhere' }}
                >
                    <SmallText>
                        Customer knowledge objects stay read-only. This applies ordinary per-object
                        review decisions, not an app-wide rule or removal approval.
                    </SmallText>
                    {error ? <InlineNotice role="alert">{error}</InlineNotice> : null}
                    {phase === 'edit' ? (
                        <>
                            <p>
                                {objects.length} selected candidates from scan {scanId}. New objects
                                in a later scan are not included.
                            </p>
                            <ReviewFields>
                                <FilterField>
                                    Bulk confirmation stage
                                    <Select
                                        value={stage}
                                        onChange={(event) =>
                                            setStage(event.currentTarget.value as ReviewStage)
                                        }
                                    >
                                        {reviewStageOptions.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </Select>
                                </FilterField>
                                <FilterField>
                                    Shared assignee (optional)
                                    <Input
                                        value={assignedTo}
                                        maxLength={256}
                                        onChange={(event) =>
                                            setAssignedTo(event.currentTarget.value)
                                        }
                                        placeholder="Blank preserves existing assignees"
                                    />
                                </FilterField>
                                <FilterField>
                                    Shared note (optional)
                                    <TextArea
                                        value={note}
                                        maxLength={4000}
                                        onChange={(event) => setNote(event.currentTarget.value)}
                                    />
                                </FilterField>
                            </ReviewFields>
                            <Checkbox
                                checked={updateExisting}
                                onChange={(_event, data) => setUpdateExisting(data.checked)}
                            >
                                Update existing active reviews instead of skipping them
                            </Checkbox>
                            <SmallText>
                                Archived or unverifiable histories are always skipped. Existing
                                evidence baselines are never silently reaffirmed. New reviews
                                capture available current evidence just as an individual save does.
                            </SmallText>
                        </>
                    ) : null}
                    {phase === 'confirm' && plan ? (
                        <>
                            <p>
                                <strong>
                                    {plan.entries.length} selected · {plan.entries.length - skipped}{' '}
                                    proposed saves · {skipped} skipped · {existing} already reviewed
                                </strong>
                            </p>
                            <p>
                                {Object.entries(types)
                                    .map(([type, count]) => `${type}: ${count}`)
                                    .join(' · ')}
                            </p>
                            <p>
                                Stage:{' '}
                                {
                                    reviewStageOptions.find((option) => option.value === plan.stage)
                                        ?.label
                                }
                                . Shared note: {plan.note || 'None'}. Assignee:{' '}
                                {plan.assignedTo ||
                                    'Preserve existing / unassigned for new reviews'}
                                .
                            </p>
                            <InlineNotice>
                                Each item is rechecked and saved sequentially with its original
                                revision token. This is not atomic: completed saves remain if you
                                stop or another item fails.
                            </InlineNotice>
                            {!busy ? (
                                <ResultPagination
                                    page={page}
                                    pageSize={20}
                                    total={plan.entries.length}
                                    onChange={setPage}
                                />
                            ) : null}
                            <TableScroller>
                                <Table>
                                    <thead>
                                        <tr>
                                            <th>Object</th>
                                            <th>Type / app</th>
                                            <th>Planned operation</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {plan.entries
                                            .slice(page * 20, page * 20 + 20)
                                            .map((entry) => (
                                                <tr key={entry.object.objectId}>
                                                    <td>{entry.object.name}</td>
                                                    <td>
                                                        {entry.object.objectType} ·{' '}
                                                        {entry.object.app}
                                                    </td>
                                                    <td>
                                                        {entry.skip ??
                                                            (entry.previous
                                                                ? 'Update active review; preserve baseline'
                                                                : 'Create per-object review')}
                                                    </td>
                                                </tr>
                                            ))}
                                    </tbody>
                                </Table>
                            </TableScroller>
                        </>
                    ) : null}
                    {busy ? (
                        <p role="status">
                            Processed {progress.done} of {progress.total}.{' '}
                            {stopping
                                ? 'Stopping after the current item…'
                                : 'Keep this tab open until the results are confirmed.'}
                        </p>
                    ) : null}
                    {phase === 'results' ? (
                        <>
                            <p role="status">
                                {Object.entries(counts)
                                    .map(([status, count]) => `${count} ${status}`)
                                    .join(' · ') || 'No writes attempted'}
                            </p>
                            {counts.conflict || counts.unconfirmed ? (
                                <InlineNotice>
                                    Conflicts and unconfirmed saves are not automatically retried.
                                    Open the individual saved record to compare before deciding what
                                    to do next.
                                </InlineNotice>
                            ) : null}
                            <ResultPagination
                                page={page}
                                pageSize={20}
                                total={results.length}
                                onChange={setPage}
                            />
                            <TableScroller>
                                <Table>
                                    <thead>
                                        <tr>
                                            <th>Object</th>
                                            <th>Outcome</th>
                                            <th>Explanation</th>
                                            <th>Investigation</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {results.slice(page * 20, page * 20 + 20).map((result) => (
                                            <tr key={result.objectId}>
                                                <td>
                                                    {result.name}
                                                    <div>
                                                        {result.objectType} · {result.app}
                                                    </div>
                                                </td>
                                                <td>{result.status}</td>
                                                <td>{result.message}</td>
                                                <td>
                                                    <StyledButton
                                                        disabled={busy}
                                                        onClick={() =>
                                                            navigate(() =>
                                                                navigateToView('reviews', {
                                                                    object: result.objectId,
                                                                }),
                                                            )
                                                        }
                                                    >
                                                        Open review
                                                    </StyledButton>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            </TableScroller>
                        </>
                    ) : null}
                </Modal.Body>
                <Modal.Footer>
                    {busy ? (
                        <StyledButton
                            disabled={stopping}
                            onClick={() => {
                                cancel.current = true;
                                setStopping(true);
                            }}
                        >
                            Stop after current item
                        </StyledButton>
                    ) : (
                        <>
                            <StyledButton onClick={close}>
                                {phase === 'results' ? 'Close results' : 'Cancel bulk review'}
                            </StyledButton>
                            {phase === 'edit' ? (
                                <StyledButton
                                    $primary
                                    disabled={!canWrite || !objects.length}
                                    onClick={preview}
                                >
                                    Preview affected objects
                                </StyledButton>
                            ) : null}
                            {phase === 'confirm' ? (
                                <>
                                    <StyledButton onClick={() => setPhase('edit')}>
                                        Back to decision
                                    </StyledButton>
                                    <StyledButton
                                        $primary
                                        disabled={
                                            !canWrite ||
                                            !plan ||
                                            scanId !== plan.scanId ||
                                            skipped === plan.entries.length
                                        }
                                        onClick={() => save()}
                                    >
                                        Confirm and save reviews
                                    </StyledButton>
                                </>
                            ) : null}
                            {phase === 'results' ? (
                                <ButtonRow>
                                    <StyledButton onClick={exportJson}>
                                        Export batch results JSON
                                    </StyledButton>
                                    <StyledButton
                                        onClick={() =>
                                            downloadCsv(
                                                'content-hygiene-bulk-review.csv',
                                                [
                                                    'Object ID',
                                                    'Name',
                                                    'Type',
                                                    'App',
                                                    'Status',
                                                    'Message',
                                                    'Revision ID',
                                                    'Saved at',
                                                    'Saved by',
                                                    'Inventory scan ID',
                                                    'Requested stage',
                                                ],
                                                results.map((result) => [
                                                    result.objectId,
                                                    result.name,
                                                    result.objectType,
                                                    result.app,
                                                    result.status,
                                                    result.message,
                                                    result.revisionId ?? '',
                                                    result.savedAt ?? '',
                                                    result.savedBy ?? '',
                                                    plan?.scanId ?? '',
                                                    plan?.stage ?? '',
                                                ]),
                                            )
                                        }
                                    >
                                        Export batch results CSV
                                    </StyledButton>
                                    {counts.failed ? (
                                        <StyledButton
                                            disabled={!canWrite || plan?.scanId !== scanId}
                                            onClick={() => save(true)}
                                        >
                                            Retry failed after recheck
                                        </StyledButton>
                                    ) : null}
                                </ButtonRow>
                            ) : null}
                        </>
                    )}
                </Modal.Footer>
            </Modal>
        </>
    );
}
