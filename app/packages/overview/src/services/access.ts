import { createRESTURL } from '@splunk/splunk-utils/url';
import { splunkRequest } from './rest';

export interface HygieneAccess {
    canCollect: boolean;
    canReview: boolean;
}
export async function getHygieneAccess(): Promise<HygieneAccess> {
    const response = await splunkRequest<{ entry?: Array<{ content?: { roles?: string[] } }> }>(
        `${createRESTURL('authentication/current-context')}?output_mode=json`,
    );
    const roles = new Set(response.entry?.[0]?.content?.roles ?? []);
    const operator = ['admin', 'sc_admin', 'content_hygiene_operator'].some((role) =>
        roles.has(role),
    );
    return { canCollect: operator, canReview: operator || roles.has('content_hygiene_reviewer') };
}
