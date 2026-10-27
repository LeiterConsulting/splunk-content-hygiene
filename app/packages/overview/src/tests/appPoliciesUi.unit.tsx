// Synthetic React/theme contracts; not native runtime or customer-data acceptance.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplunkThemeProvider } from '@splunk/themes';
import { AppPoliciesPanel } from '../components/AppPoliciesPanel';
import { AppPolicyContext, AppPolicyWorkflow, AppRetentionNotice } from '../components/AppPolicyContext';
import { ReviewNavigationProvider } from '../components/ReviewNavigationContext';
import { FieldLineagePanel, FieldProvenanceDetails } from '../components/FieldLineagePanel';
import { appPolicyStore, buildPolicyProtection } from '../services/appPolicies';
import { downloadJson } from '../utils/downloadJson';
import { appPolicyFixture } from './appPolicyFixtures';
import { fieldInvestigationFixture } from './fieldFixtures';
import { now } from './milestoneFixtures';

jest.mock('../utils/downloadCsv', () => ({ downloadCsv: jest.fn() }));
jest.mock('../utils/downloadJson', () => ({ downloadJson: jest.fn() }));
function fixture(active = false, manage = true) {
    const source = appPolicyFixture();
    const store = appPolicyStore(active ? [source.policy] : []);
    const workflow: AppPolicyWorkflow = { store, protection: buildPolicyProtection(source.data, store, [source.saved]),
        canManage: manage, loading: false, reviews: [source.saved], reviewsVerified: true,
        save: jest.fn().mockResolvedValue(undefined), refresh: jest.fn().mockResolvedValue(undefined) };
    return { ...source, workflow };
}
const frame = (children: React.ReactNode, workflow: AppPolicyWorkflow, scheme: 'light' | 'dark') =>
    <SplunkThemeProvider family="enterprise" colorScheme={scheme}><ReviewNavigationProvider>
        <AppPolicyContext.Provider value={workflow}>{children}</AppPolicyContext.Provider>
    </ReviewNavigationProvider></SplunkThemeProvider>;
beforeEach(() => { jest.clearAllMocks(); window.history.replaceState(null, '', '/'); jest.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => jest.restoreAllMocks());

test.each(['light', 'dark'] as const)('exact-app preview requires explicit current/future confirmation in %s', async scheme => {
    const { data, app, saved, workflow } = fixture(); const bytes = JSON.stringify(saved); const user = userEvent.setup();
    render(frame(<AppPoliciesPanel snapshot={data} />, workflow, scheme));
    await user.click(screen.getByRole('button', { name: 'App-wide retention policies (0 active)' }));
    await user.click(screen.getByRole('combobox', { name: 'App to retain' }));
    await user.click(screen.getByRole('option', { name: 'example — example' }));
    const trigger = screen.getByRole('button', { name: 'Preview app policy' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Exact-app retention policy' });
    expect(within(dialog).getByText(/1 visible saved Confirmed eligible decisions would conflict/)).toBeVisible();
    const submit = within(dialog).getByRole('button', { name: 'Confirm policy revision' });
    expect(submit).toBeDisabled(); expect(within(dialog).getByText(app.objectId, { exact: true })).toBeVisible();
    await user.click(within(dialog).getByRole('checkbox', { name: /I confirm retention of current and future shared objects in exactly example/ }));
    expect(submit).toBeEnabled();
    await user.type(within(dialog).getByRole('textbox', { name: 'Policy reason' }), 'Accountable retention rationale');
    expect(submit).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox', { name: /I confirm retention/ }));
    await user.click(submit);
    expect(workflow.save).toHaveBeenCalledWith(expect.objectContaining({ state: 'active', app, expected: null, note: 'Accountable retention rationale' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(JSON.stringify(saved)).toBe(bytes);
});

test.each(['light', 'dark'] as const)('viewer can inspect/export policy history but cannot manage it in %s', async scheme => {
    const { data, policy, first, workflow } = fixture(true, false); const user = userEvent.setup();
    render(frame(<><AppPoliciesPanel snapshot={data} /><AppRetentionNotice object={first} /></>, workflow, scheme));
    await user.click(screen.getByRole('button', { name: 'App-wide retention policies (1 active)' }));
    expect(screen.queryByRole('button', { name: 'Review or change policy' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'App to retain' })).not.toBeInTheDocument();
    expect(screen.getByText(/Confirmed eligible decision is preserved but conflicts/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Export policy history' }));
    await user.click(screen.getByRole('menuitem', { name: 'Policy history JSON' }));
    expect(downloadJson).toHaveBeenCalledWith('content-hygiene-app-policies.json', expect.objectContaining({ revisions: [policy] }));
    expect(workflow.save).not.toHaveBeenCalled();
});

test('stale save retains the policy draft and requires reload, comparison and renewed confirmation', async () => {
    const { data, workflow } = fixture(true); const user = userEvent.setup();
    jest.mocked(workflow.save!).mockRejectedValue(new Error('Another operator saved first. Your draft is preserved.'));
    render(frame(<AppPoliciesPanel snapshot={data} />, workflow, 'light'));
    await user.click(screen.getByRole('button', { name: 'App-wide retention policies (1 active)' }));
    await user.click(screen.getByRole('button', { name: 'Review or change policy' }));
    await user.type(screen.getByRole('textbox', { name: 'Policy reason' }), ' Keep this draft');
    await user.click(screen.getByRole('checkbox', { name: /I confirm retention/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm policy revision' }));
    expect(screen.getByRole('textbox', { name: 'Policy reason' })).toHaveValue('Retain this exact namespace Keep this draft');
    expect(screen.getByRole('button', { name: 'Confirm policy revision' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Reload saved policy for comparison' }));
    expect(workflow.refresh).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Use this revision as the draft base' }));
    expect(screen.getByRole('button', { name: 'Confirm policy revision' })).toBeDisabled();
    expect(workflow.save).toHaveBeenCalledTimes(1);
});

test.each(['light', 'dark'] as const)('context evidence and lookup output semantics are accessible without hover in %s', async scheme => {
    const { data } = await fieldInvestigationFixture(); const proof = data.edges.find(row => row.fieldProvenance)?.fieldProvenance;
    const { workflow, first } = fixture(); const user = userEvent.setup();
    const lookup = { ...first, fieldLineage: { version: 1 as const, operation: 'lookup' as const, stanza: 'events', attribute: 'LOOKUP-owner',
        scope: { field: 'sourcetype' as const, value: 'events', exact: true }, enabled: true, inputs: ['actor'], outputs: ['owner_name'], aliases: [], transforms: [],
        syntax: 'declared' as const, sourceLocation: 'props.conf', limitations: [], lookupMapping: { version: 1 as const, outputMode: 'OUTPUTNEW' as const,
            inputs: [{ lookupField: 'key', eventField: 'actor', position: 1 }], outputs: [{ lookupField: 'owner', eventField: 'owner_name', position: 1 }] } } };
    render(frame(<><FieldProvenanceDetails provenance={proof} /><FieldLineagePanel object={lookup} /></>, workflow, scheme));
    await user.click(screen.getByRole('button', { name: /Possible configuration contexts/ }));
    expect(screen.getByRole('list', { name: 'Possible configuration contexts' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Configured lookup field mappings' }));
    expect(screen.getByRole('list', { name: 'Configured lookup field mappings' })).toHaveTextContent('OUTPUTNEW 1: lookup column owner → event field owner_name');
    expect(screen.getByText('OUTPUTNEW preserves each existing event output field.')).toBeVisible();
});
