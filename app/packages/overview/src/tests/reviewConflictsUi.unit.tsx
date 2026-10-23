import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplunkThemeProvider } from '@splunk/themes';
import { ReviewEditor } from '../components/ReviewEditor';
import { ReviewWorkflowContext, ReviewWorkflow } from '../components/ReviewWorkflowContext';
import { ContentObject, ReviewInput, ReviewRecord } from '../types';
import { downloadJson } from '../utils/downloadJson';

jest.mock('../utils/downloadJson', () => ({ downloadJson: jest.fn() }));
jest.mock('../utils/downloadCsv', () => ({ downloadCsv: jest.fn() }));

const object: ContentObject = { objectId: 'macro::example::a', canonicalName: 'a', name: 'A', objectType: 'Macro',
    app: 'example', owner: 'analyst', sharing: 'app', enabled: true, scheduled: false, updated: null,
    lastUsed: null, usageEvidence: null, healthStatus: 'unknown', abandonmentConfidence: null,
    removalImpact: null, inboundReferences: 0, outboundReferences: 0, protected: false, evidence: [], suggestedAction: 'Review' };
const original: ReviewRecord = { objectId: object.objectId, objectName: 'A', canonicalName: 'a', objectType: 'Macro',
    app: 'example', owner: 'analyst', healthStatusAtReview: 'unknown', usageCoverageAtReview: null,
    usageLastObservedAtReview: null, usageObservationCountAtReview: null, usageRunIdAtReview: null,
    stage: 'retain', note: 'Original rationale', assignedTo: 'alpha', scanId: 'original-scan',
    createdAt: '2026-07-28T10:00:00Z', updatedAt: '2026-07-28T10:00:00Z', updatedBy: 'A',
    revisionId: 'revision-1', revisionNumber: 1 };
const latest: ReviewRecord = { ...original, stage: 'blocked', note: 'Other reviewer rationale', assignedTo: 'beta',
    updatedAt: '2026-07-28T11:00:00Z', updatedBy: 'B', revisionId: 'revision-2', revisionNumber: 2 };
const conflict = (): Error => Object.assign(new Error('Another session changed this review. Your draft is preserved.'), { name: 'ReviewConflictError' });

function ui(colorScheme: 'light' | 'dark', workflow: ReviewWorkflow, onSave: (input: ReviewInput) => Promise<ReviewRecord>) {
    return <SplunkThemeProvider family="enterprise" colorScheme={colorScheme}>
        <ReviewWorkflowContext.Provider value={workflow}>
            <ReviewEditor contentObject={object} review={original} scanId="current" canWrite onSave={onSave} onDelete={jest.fn()} />
        </ReviewWorkflowContext.Provider>
    </SplunkThemeProvider>;
}

test.each(['light', 'dark'] as const)('a rejected %s save preserves the draft and requires deliberate reconciliation against the latest revision', async (scheme) => {
    const user = userEvent.setup();
    const onSave = jest.fn().mockRejectedValueOnce(conflict()).mockImplementationOnce(async (input: ReviewInput) => ({
        ...latest, stage: input.stage, note: input.note, assignedTo: input.assignedTo,
        revisionId: 'revision-3', revisionNumber: 3,
    }));
    const reload = jest.fn().mockResolvedValue(latest);
    render(ui(scheme, { states: new Map([[object.objectId, original]]), reload }, onSave));
    const note = screen.getByRole('textbox', { name: 'Investigation note' });
    await user.clear(note); await user.type(note, 'My investigation draft');
    await user.click(screen.getByRole('button', { name: 'Update review record' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update review record' })).toBeDisabled());
    expect(note).toHaveValue('My investigation draft');
    expect(screen.getByText(/Your draft has not been discarded/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Compare with latest saved review' }));
    await screen.findByText('Other reviewer rationale');
    expect(note).toHaveValue('My investigation draft');
    await user.click(screen.getByRole('button', { name: 'Save reconciled draft' }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
        note: 'My investigation draft', stage: 'retain', expectedRevisionId: latest.revisionId,
        expectedUpdatedAt: latest.updatedAt, captureEvidence: false,
    })));
    // A delayed old context value must not roll the accepted local revision back.
    expect(note).toHaveValue('My investigation draft');
});

test('a refreshed shared context never silently advances a dirty form precondition', async () => {
    const user = userEvent.setup(); const onSave = jest.fn().mockRejectedValue(conflict());
    const first = { states: new Map([[object.objectId, original]]) };
    const view = render(ui('light', first, onSave));
    const note = screen.getByRole('textbox', { name: 'Investigation note' });
    await user.type(note, ' - unsaved');
    view.rerender(ui('light', { states: new Map([[object.objectId, latest]]) }, onSave));
    expect(note).toHaveValue('Original rationale - unsaved');
    await user.click(screen.getByRole('button', { name: 'Update review record' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ expectedRevisionId: original.revisionId }));
});

test('an archived record is restored from its retained decision, not recreated from an empty form', async () => {
    const user = userEvent.setup(); const onSave = jest.fn().mockResolvedValue({ ...latest, removed: false });
    const archived = { ...original, removed: true, revisionId: latest.revisionId, revisionNumber: 2 };
    render(ui('dark', { states: new Map([[object.objectId, archived]]) }, onSave));
    expect(screen.getByRole('textbox', { name: 'Investigation note' })).toHaveValue(original.note);
    expect(screen.queryByRole('button', { name: 'Remove library record' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore to review library' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ stage: 'retain', note: original.note,
        expectedRevisionId: latest.revisionId, captureEvidence: false }));
});

test('revision history is read on demand, pages by revision, exports loaded rows and never resets a draft', async () => {
    const user = userEvent.setup();
    const history = jest.fn().mockResolvedValueOnce({ entries: [{ revisionId: 'r2', revisionNumber: 2,
        operation: 'save', stage: 'retain', note: 'History note', assignedTo: null,
        updatedAt: latest.updatedAt, updatedBy: 'server-reviewer', capturedEvidence: false }], nextBefore: 2 })
        .mockResolvedValueOnce({ entries: [{ revisionId: 'r1', revisionNumber: 1, operation: 'remove',
            stage: 'retain', note: 'Earlier note', assignedTo: null, updatedAt: original.updatedAt,
            updatedBy: 'server-reviewer', capturedEvidence: false }], nextBefore: null });
    render(ui('light', { states: new Map([[object.objectId, original]]), history }, jest.fn()));
    expect(history).not.toHaveBeenCalled();
    const note = screen.getByRole('textbox', { name: 'Investigation note' });
    await user.type(note, ' - draft');
    await user.click(screen.getByRole('button', { name: 'Show saved revisions' }));
    await screen.findByText('History note');
    await user.click(screen.getByRole('button', { name: 'Load older revisions' }));
    await screen.findByText('Earlier note');
    expect(history).toHaveBeenLastCalledWith(object.objectId, 2);
    expect(note).toHaveValue('Original rationale - draft');
    await user.click(screen.getByRole('button', { name: 'Export loaded revisions JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-review-revisions.json', expect.objectContaining({
        revisions: expect.arrayContaining([expect.objectContaining({ note: 'History note' }), expect.objectContaining({ note: 'Earlier note' })]),
        moreAvailable: false,
    }));
});
