/* eslint-disable no-underscore-dangle -- Native append-only policy revision IDs. */
import React, { useContext, useEffect, useMemo, useState } from 'react';
import CollapsiblePanel from '@splunk/react-ui/CollapsiblePanel';
import Checkbox from '@splunk/react-ui/Checkbox';
import Modal from '@splunk/react-ui/Modal';
import { ButtonRow, Card, CardBody, DefinitionList, EvidenceList, FilterField, InlineNotice, Input, Select, SmallText, StyledButton, Table, TableScroller, TextArea, WorkflowForm } from '../AppStyles';
import { ContentObject, InventorySnapshot } from '../types';
import { AppPolicyRevision, AppPolicyState, appPolicyFingerprint, appPolicyIdentity, previewAppPolicy } from '../services/appPolicies';
import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';
import { AppPolicyContext } from './AppPolicyContext';
import { ExportMenu } from './ExportMenu';
import { ResultPagination } from './ResultPagination';
import { useReviewNavigation } from './ReviewNavigationContext';

function PolicyEditor({ app, expected, snapshot, onClose, returnFocus }: { app: ContentObject; expected: AppPolicyRevision | null;
    snapshot: InventorySnapshot | null; onClose: () => void; returnFocus: React.MutableRefObject<HTMLElement | null> }): React.ReactElement {
    const workflow = useContext(AppPolicyContext);
    const { setDraft } = useReviewNavigation();
    const [state, setState] = useState<AppPolicyState>(expected?.state ?? 'active');
    const [note, setNote] = useState(expected?.note ?? '');
    const [confirmed, setConfirmed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [needsReload, setNeedsReload] = useState(false);
    const [compared, setCompared] = useState(false);
    const current = workflow.store.heads.find(row => row.app_id === app.app) ?? null;
    const [base, setBase] = useState(expected);
    const currentApp = snapshot?.objects.find(row => row.objectId === appPolicyIdentity(app.app));
    const scopePreview = useMemo(() => previewAppPolicy(snapshot, app.app, workflow.reviews, workflow.reviewsVerified),
        [snapshot, app.app, workflow.reviews, workflow.reviewsVerified]);
    const preview = scopePreview.objects;
    const dirty = state !== (base?.state ?? 'active') || note !== (base?.note ?? '') || !base;
    useEffect(() => {
        const objectId = `app-policy:${app.app}`;
        setDraft({ objectId, dirty, busy: saving, kind: 'policy', onDiscard: onClose });
        return () => setDraft({ objectId, dirty: false, busy: false });
    }, [setDraft, app.app, dirty, saving, onClose]);
    const canActivate = Boolean(currentApp && appPolicyFingerprint(currentApp) && snapshot?.scan.scanType === 'full' &&
        Number.isSafeInteger(snapshot.scan.collectorCounts.apps) && snapshot.scan.collectorCounts.apps > 0 && snapshot.scan.collectorCounts.apps === snapshot.scan.collectorTotals.apps);
    const canSubmit = workflow.canManage && confirmed && !saving && !needsReload && Boolean(workflow.save) &&
        (state === 'active' ? canActivate : Boolean(base));
    return <Modal open returnFocus={returnFocus} onRequestClose={() => {
        if (!saving && !dirty) { onClose(); }
        else if (!saving) { setError('Your policy draft is unsaved. Use Discard policy draft to close without changing the saved policy, or keep editing.'); }
    }} style={{ width: 'min(900px, calc(100vw - 32px))' }}>
        <Modal.Header title="Exact-app retention policy" />
        <Modal.Body data-content-hygiene-portal="true">
            <SmallText>App-local protection only. No customer content or individual review decision is changed.</SmallText>
            <DefinitionList>
                <dt>Exact app namespace</dt><dd>{app.app}</dd>
                <dt>App identity</dt><dd>{appPolicyIdentity(app.app)}</dd>
                <dt>Preview</dt><dd>{preview.length.toLocaleString()} currently visible shared objects, including the App object. Future shared objects in this exact namespace are included while active.</dd>
                <dt>Policy precedence</dt><dd>Policy retention is an additional protective reason. Individual stages, notes, assignees, baselines and history remain unchanged. A Confirmed eligible decision cannot override an active policy.</dd>
                <dt>Individual eligibility decisions</dt><dd>{scopePreview.decisionsVerified ? `${scopePreview.eligibilityIds.length} visible saved Confirmed eligible decisions would conflict while this policy is active.` : 'The loaded individual decisions cannot be fully verified; the conflict count is unknown, not zero.'} Confirmation does not resolve or rewrite individual decisions.</dd>
                <dt>Inventory scope</dt><dd>{snapshot?.scan.scanId ?? 'Unavailable'} · only visible shared objects. Private content, renamed app IDs, activity and complete dependency closure are not established.</dd>
            </DefinitionList>
            <CollapsiblePanel appearance="subtle" title={`Preview shared identities (${preview.length})`}>
                <EvidenceList>{preview.slice(0, 50).map(row => <li key={row.objectId}>{row.objectType} · {row.name}<SmallText>{row.objectId}</SmallText></li>)}</EvidenceList>
                {preview.length > 50 ? <SmallText>First 50 shown. Export the full exact-scope preview below before confirmation.</SmallText> : null}
                <StyledButton onClick={() => downloadJson('content-hygiene-app-policy-preview.json', { app: app.app, appObjectId: appPolicyIdentity(app.app), scanId: snapshot?.scan.scanId,
                    scope: 'shared_exact_app_current_and_future', existingObjects: preview, futureSharedObjectsIncluded: true,
                    eligibilityDecisionIds: scopePreview.eligibilityIds, individualDecisionsVerified: scopePreview.decisionsVerified })}>Export full scope preview</StyledButton>
            </CollapsiblePanel>
            <WorkflowForm onSubmit={event => event.preventDefault()}>
                <FilterField>Policy state<Select value={state} disabled={saving} onChange={event => { setState(event.currentTarget.value as AppPolicyState); setConfirmed(false); }}>
                    <option value="active">Active — retain current and future shared content</option>
                    <option value="disabled" disabled={!base}>Disabled — stop policy retention, preserve history</option>
                    <option value="archived" disabled={!base}>Archived — inactive, history remains recoverable</option>
                </Select></FilterField>
                <FilterField>Policy reason<TextArea value={note} maxLength={4000} disabled={saving} onChange={event => { setNote(event.currentTarget.value); setConfirmed(false); }} /></FilterField>
                {!canActivate && state === 'active' ? <InlineNotice>Activation requires the app’s current configuration/ACL fingerprint from a complete inventory scan. Disabling or archiving an existing policy remains available even if its app is missing.</InlineNotice> : null}
                <Checkbox checked={confirmed} disabled={saving} onChange={(_event, data) => setConfirmed(data.checked)}>
                    {state === 'active' ? `I confirm retention of current and future shared objects in exactly ${app.app}; existing individual decisions will not be changed.` : `I confirm ${state === 'disabled' ? 'disabling' : 'archiving'} this policy without deleting its history or changing individual decisions.`}
                </Checkbox>
                {error ? <InlineNotice role="alert">{error}</InlineNotice> : null}
                {needsReload ? <>
                    <StyledButton disabled={saving} onClick={() => workflow.refresh?.().then(() => setCompared(true)).catch(() => undefined)}>Reload saved policy for comparison</StyledButton>
                    {compared ? <InlineNotice>Latest saved revision: {current?.revision_number ?? 'none'} · state: {current?.state ?? 'none'} · reason: {current?.note ?? 'none'}. Your draft is still above.
                        <StyledButton onClick={() => { setBase(current); setNeedsReload(false); setConfirmed(false); setCompared(false); }}>Use this revision as the draft base</StyledButton>
                    </InlineNotice> : null}
                </> : null}
                <ButtonRow>
                    <StyledButton disabled={saving} onClick={onClose}>{dirty ? 'Discard policy draft' : 'Close'}</StyledButton>
                    <StyledButton $primary disabled={!canSubmit} onClick={async () => {
                        setSaving(true); setError('');
                        try { await workflow.save!({ app: currentApp ?? app, scanId: snapshot?.scan.scanId ?? base?.scan_id ?? '', state, note, expected: base }); onClose(); }
                        catch (failure) { setError(failure instanceof Error ? failure.message : 'Policy save failed.'); setNeedsReload(true); }
                        finally { setSaving(false); }
                    }}>{saving ? 'Saving policy…' : 'Confirm policy revision'}</StyledButton>
                </ButtonRow>
            </WorkflowForm>
        </Modal.Body>
    </Modal>;
}

export function AppPoliciesPanel({ snapshot }: { snapshot: InventorySnapshot | null }): React.ReactElement {
    const workflow = useContext(AppPolicyContext);
    const [query, setQuery] = useState(''); const [page, setPage] = useState(0);
    const [appId, setAppId] = useState('');
    const [editing, setEditing] = useState<{ app: ContentObject; expected: AppPolicyRevision | null } | null>(null);
    const returnFocus = React.useRef<HTMLElement | null>(null);
    const apps = useMemo(() => snapshot?.objects.filter(row => row.objectType === 'App').sort((a, b) => a.app.localeCompare(b.app)) ?? [], [snapshot]);
    const histories = useMemo(() => {
        const result = new Map<string, AppPolicyRevision[]>();
        workflow.store.revisions.forEach(row => { const list = result.get(row.app_id) ?? []; list.push(row); result.set(row.app_id, list); });
        result.forEach(list => list.sort((a, b) => b.revision_number - a.revision_number));
        return result;
    }, [workflow.store.revisions]);
    const filtered = workflow.store.heads.filter(row => row.app_id.toLowerCase().includes(query.toLowerCase()));
    const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 25) - 1));
    const close = React.useCallback(() => setEditing(null), []);
    const edit = (policy: AppPolicyRevision): void => {
        returnFocus.current = document.activeElement as HTMLElement | null;
        const app = apps.find(row => row.objectId === policy.app_object_id);
        // Identity-only fallback permits reversible disable/archive, not activation.
        const fallback: ContentObject = { objectId: policy.app_object_id, canonicalName: policy.app_id, name: policy.app_id, objectType: 'App', app: policy.app_id,
            owner: null, sharing: null, enabled: null, scheduled: null, updated: null, lastUsed: null, usageEvidence: null, healthStatus: 'unknown',
            abandonmentConfidence: null, removalImpact: null, inboundReferences: 0, outboundReferences: 0, protected: false, evidence: [], suggestedAction: 'Verify missing app identity.' };
        setEditing({ app: app ?? fallback, expected: policy });
    };
    const countLabel = workflow.store.verified ? `${workflow.store.heads.filter(row => row.state === 'active').length} active` : 'unavailable';
    return <Card aria-label="App-wide retention policies"><CardBody><CollapsiblePanel title={`App-wide retention policies (${countLabel})`}>
        <SmallText>Separate, reversible protection for current and future shared content in an exact app namespace. Never a bulk overwrite of Review Library decisions or proof of usage.</SmallText>
        {workflow.store.revisions.length >= 9000 ? <InlineNotice>The append-only policy journal is nearing its 10,000-revision capacity. Export and back up the full journal and plan administrator-led capacity/recovery work. Do not prune individual revisions.</InlineNotice> : null}
        <ButtonRow>
            {workflow.refresh ? <StyledButton disabled={workflow.loading} onClick={() => workflow.refresh!().catch(() => undefined)}>Refresh policies</StyledButton> : null}
            <ExportMenu label="Export policy history" disabled={!workflow.store.verified || !workflow.store.revisions.length} items={[
                { label: 'Policy history JSON', onClick: () => downloadJson('content-hygiene-app-policies.json', { exportedAt: new Date().toISOString(), ...workflow.store, limitations: 'Exact logical namespace, not a physical installation identifier. Same-name recreation may be indistinguishable. No activity or dependency-completeness claim.' }) },
                { label: 'Policy history CSV', onClick: () => downloadCsv('content-hygiene-app-policies.csv', ['App', 'App object ID', 'Revision', 'Revision ID', 'Parent revision', 'State', 'Scope', 'Reason', 'Preview scan', 'App fingerprint', 'Created', 'Updated', 'Operator'],
                    workflow.store.revisions.map(row => [row.app_id, row.app_object_id, row.revision_number, row._key, row.parent_revision, row.state, row.scope, row.note, row.scan_id, row.app_fingerprint, row.created_at, row.updated_at, row.updated_by])) },
            ]} />
        </ButtonRow>
        {workflow.canManage ? <ButtonRow><FilterField>App to retain<Select value={appId} onChange={event => setAppId(event.currentTarget.value)}>
            <option value="">Choose an exact app namespace</option>{apps.map(app => <option key={app.objectId} value={app.app}>{app.app} — {app.name}</option>)}
        </Select></FilterField><StyledButton disabled={!appId} onClick={() => {
            returnFocus.current = document.activeElement as HTMLElement | null;
            const app = apps.find(row => row.app === appId);
            if (app) { setEditing({ app, expected: workflow.store.heads.find(row => row.app_id === appId) ?? null }); }
        }}>Preview app policy</StyledButton></ButtonRow> : <SmallText>Only Content Hygiene operators can manage app-wide policies. Viewers and reviewers can inspect and export them.</SmallText>}
        <FilterField>Find policy by app namespace<Input value={query} onChange={event => { setQuery(event.currentTarget.value); setPage(0); }} /></FilterField>
        <TableScroller><Table><thead><tr><th>Exact app namespace</th><th>State</th><th>Revision / operator</th><th>Reason and scope</th><th>Action</th></tr></thead><tbody>
            {filtered.slice(currentPage * 25, currentPage * 25 + 25).map(policy => <tr key={policy._key}>
                <td>{policy.app_id}<SmallText>{policy.app_object_id}</SmallText></td><td>{policy.state}</td><td>{policy.revision_number} · {policy.updated_by}<SmallText>{policy.updated_at}</SmallText></td>
                <td>{policy.note || 'No reason recorded'}<SmallText>Current and future visible shared objects. No private-content or activity claim.</SmallText></td>
                <td>{workflow.canManage ? <StyledButton onClick={() => edit(policy)}>Review or change policy</StyledButton> : 'Read only'}
                    <CollapsiblePanel appearance="subtle" title={`History for ${policy.app_id}`}><PolicyHistory revisions={histories.get(policy.app_id) ?? []} /></CollapsiblePanel>
                </td>
            </tr>)}
            {!filtered.length ? <tr><td colSpan={5}>{workflow.store.verified ? 'No matching app-wide policies. Individual review decisions remain independent.' : 'Policy status is unavailable, not empty.'}</td></tr> : null}
        </tbody></Table></TableScroller>
        <ResultPagination total={filtered.length} page={currentPage} pageSize={25} onChange={setPage} />
        <InlineNotice>App configuration/ACL changes or missing identity require scope confirmation. Renamed app IDs do not inherit protection. Native metadata cannot always distinguish a same-name reinstall; review policy scope explicitly. Incomplete scans do not establish protection for unseen objects.</InlineNotice>
    </CollapsiblePanel>{editing ? <PolicyEditor key={editing.app.app} app={editing.app} expected={editing.expected} snapshot={snapshot} onClose={close} returnFocus={returnFocus} /> : null}</CardBody></Card>;
}

function PolicyHistory({ revisions }: { revisions: AppPolicyRevision[] }): React.ReactElement {
    const [page, setPage] = useState(0);
    const currentPage = Math.min(page, Math.max(0, Math.ceil(revisions.length / 25) - 1));
    return <><EvidenceList>{revisions.slice(currentPage * 25, currentPage * 25 + 25).map(row => <li key={row._key}>
        Revision {row.revision_number} · {row.state} · {row.updated_by} · {row.updated_at}<SmallText>{row.note}</SmallText>
    </li>)}</EvidenceList><ResultPagination total={revisions.length} page={currentPage} pageSize={25} onChange={setPage} /></>;
}
