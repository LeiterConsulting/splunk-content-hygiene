import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { ContentObject, InventorySnapshot, ReviewRecord } from '../types';
import { AppPolicyInput, AppPolicyStore, PolicyProtection, appPolicyStore, buildPolicyProtection } from '../services/appPolicies';
import { EMPTY_POLICY_STORE, listAppPolicies, saveAppPolicy } from '../services/appPolicyClient';
import { InlineNotice } from '../AppStyles';

export interface AppPolicyWorkflow {
    store: AppPolicyStore;
    protection: ReadonlyMap<string, PolicyProtection>;
    canManage: boolean;
    loading: boolean;
    reviews: ReviewRecord[];
    reviewsVerified: boolean;
    refresh?: () => Promise<void>;
    save?: (input: AppPolicyInput) => Promise<void>;
}
export const AppPolicyContext = createContext<AppPolicyWorkflow>({ store: EMPTY_POLICY_STORE, protection: new Map(), canManage: false, loading: false, reviews: [], reviewsVerified: true });
const unverified = (message: string): AppPolicyStore => ({ ...appPolicyStore([]), verified: false, error: message });

export function AppPolicyProvider({ enabled, canManage, snapshot, reviews, reviewsVerified, children }: {
    enabled: boolean; canManage: boolean; snapshot: InventorySnapshot | null; reviews: ReviewRecord[]; reviewsVerified: boolean; children: React.ReactNode;
}): React.ReactElement {
    const [store, setStore] = useState<AppPolicyStore>(() => enabled ? unverified('App retention policies are loading.') : EMPTY_POLICY_STORE);
    const [loading, setLoading] = useState(enabled);
    const refresh = useCallback(async () => {
        setLoading(true);
        try { setStore(await listAppPolicies()); }
        catch (failure) { setStore(unverified(failure instanceof Error ? failure.message : 'App retention policies could not be verified.')); throw failure; }
        finally { setLoading(false); }
    }, []);
    useEffect(() => {
        if (!enabled) { return undefined; }
        let current = true;
        listAppPolicies().then(result => { if (current) { setStore(result); } })
            .catch(failure => { if (current) { setStore(unverified(failure instanceof Error ? failure.message : 'App retention policies could not be verified.')); } })
            .finally(() => { if (current) { setLoading(false); } });
        return () => { current = false; };
    }, [enabled]);
    const save = useCallback(async (input: AppPolicyInput) => {
        if (!canManage || !store.verified) { throw new Error('Verified policy history and operator access are required.'); }
        setStore(await saveAppPolicy(input));
    }, [canManage, store.verified]);
    const protection = useMemo(() => buildPolicyProtection(snapshot, store, reviews), [snapshot, store, reviews]);
    const value = useMemo(() => ({ store, protection, canManage: canManage && !loading && store.verified, loading, reviews, reviewsVerified,
        ...(enabled ? { refresh, save } : {}) }), [store, protection, canManage, loading, enabled, refresh, save, reviews, reviewsVerified]);
    return <AppPolicyContext.Provider value={value}>
        {enabled && !store.verified ? <InlineNotice role={loading ? 'status' : 'alert'}>
            {store.error} Policy status is unknown, not “unprotected.” Individual reviews are unchanged.
        </InlineNotice> : null}
        {children}
    </AppPolicyContext.Provider>;
}

export function AppRetentionNotice({ object }: { object: ContentObject }): React.ReactElement | null {
    const { protection } = React.useContext(AppPolicyContext);
    const reason = protection.get(object.objectId);
    if (!reason?.blocksCleanup) { return null; }
    return <InlineNotice aria-label="App retention policy protection">
        <strong>{reason.status === 'retained' ? 'Retained by app policy.' : 'Policy protection needs verification.'}</strong> {reason.detail}
        {reason.policy ? <span> Policy revision {reason.policy.revision_number} · {reason.policy.updated_by} · {reason.policy.updated_at}.</span> : null}
    </InlineNotice>;
}

export function AppRetentionLabel({ objectId }: { objectId: string }): React.ReactElement | null {
    const reason = React.useContext(AppPolicyContext).protection.get(objectId);
    if (!reason?.blocksCleanup) { return null; }
    return <span>{reason.status === 'retained' ? 'Retained by app policy' : 'Policy scope unverified'}{reason.conflict ? ' · individual decision conflict' : ''}</span>;
}
