import React, { useContext, useId, useState } from 'react';
import { ButtonRow, InlineNotice, SmallText, StyledButton, Table, TableScroller } from '../AppStyles';
import { ReviewHistoryEntry } from '../types';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { ReviewWorkflowContext } from './ReviewWorkflowContext';

export function ReviewHistoryPanel({ objectId }: { objectId: string }): React.ReactElement | null {
    const { history } = useContext(ReviewWorkflowContext);
    const panelId = useId();
    const [open, setOpen] = useState(false);
    const [rows, setRows] = useState<ReviewHistoryEntry[]>([]);
    const [nextBefore, setNextBefore] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);
    if (!history) { return null; }
    const load = async (older = false): Promise<void> => {
        setLoading(true); setError(null);
        try {
            const page = await history(objectId, older ? nextBefore ?? undefined : undefined);
            setRows((current) => older ? [...current, ...page.entries] : page.entries);
            setNextBefore(page.nextBefore); setLoaded(true);
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to load review revisions.'); }
        finally { setLoading(false); }
    };
    return (
        <section aria-label="Saved review revision history">
            <StyledButton type="button" aria-expanded={open} aria-controls={panelId}
                onClick={() => { setOpen(!open); if (!open && !loaded) { load().catch(() => undefined); } }}>
                {open ? 'Hide saved revisions' : 'Show saved revisions'}
            </StyledButton>
            {open ? <div id={panelId}>
                <SmallText>
                    Revisions are ordered by their server-enforced sequence, not the browser clock.
                    New reviewer names and timestamps come from the authenticated server coordinator.
                    Archiving preserves prior decisions. Privileged administrators can still alter KV data;
                    this is application history, not a tamper-proof audit system.
                </SmallText>
                {loading ? <SmallText role="status">Loading saved revisions…</SmallText> : null}
                {error ? <InlineNotice role="alert">{error}</InlineNotice> : null}
                {loaded && !rows.length ? <SmallText>No revision events yet. The original legacy record is preserved separately; the first edit starts its revision history.</SmallText> : null}
                <ButtonRow>
                    <StyledButton disabled={loading} onClick={() => load().catch(() => undefined)}>Refresh history</StyledButton>
                    <StyledButton disabled={!rows.length} onClick={() => downloadJson('content-hygiene-review-revisions.json', { objectId, exportedAt: new Date().toISOString(), revisions: rows, moreAvailable: nextBefore !== null })}>Export loaded revisions JSON</StyledButton>
                    <StyledButton disabled={!rows.length} onClick={() => downloadCsv('content-hygiene-review-revisions.csv',
                        ['Object ID', 'Revision', 'Operation', 'Stage', 'Note', 'Assigned to', 'Updated at', 'Updated by', 'Evidence captured'],
                        rows.map((row) => [objectId, row.revisionNumber, row.operation, row.stage, row.note, row.assignedTo, row.updatedAt, row.updatedBy, row.capturedEvidence]))}>Export loaded revisions CSV</StyledButton>
                </ButtonRow>
                {rows.length ? <TableScroller><Table><thead><tr>
                    <th scope="col">Revision / action</th><th scope="col">Decision / reviewer</th><th scope="col">Note</th><th scope="col">Saved</th>
                </tr></thead><tbody>{rows.map((row) => <tr key={row.revisionId}>
                    <td>{row.revisionNumber} · {row.operation === 'remove' ? 'Archived' : 'Saved'}{row.capturedEvidence ? <div>Evidence captured</div> : null}</td>
                    <td>{row.stage.replace(/_/g, ' ')}<div>{row.assignedTo ?? 'Unassigned'}</div></td>
                    <td>{row.note || 'No note'}</td><td>{row.updatedAt}<div>{row.updatedBy}</div></td>
                </tr>)}</tbody></Table></TableScroller> : null}
                {nextBefore !== null ? <StyledButton disabled={loading} onClick={() => load(true).catch(() => undefined)}>Load older revisions</StyledButton> : null}
            </div> : null}
        </section>
    );
}
