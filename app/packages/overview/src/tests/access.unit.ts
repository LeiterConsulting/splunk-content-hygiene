import { getHygieneAccess } from '../services/access';
import { splunkRequest } from '../services/rest';

jest.mock('../services/rest', () => ({ splunkRequest: jest.fn() }));
jest.mock('@splunk/splunk-utils/url', () => ({ createRESTURL: (path: string) => path }));

test.each([
    ['user', false, false],
    ['content_hygiene_viewer', false, false],
    ['content_hygiene_reviewer', false, true],
    ['content_hygiene_operator', true, true],
    ['admin', true, true],
])('%s exposes only its permitted app-local actions', async (role, canCollect, canReview) => {
    (splunkRequest as jest.Mock).mockResolvedValue({ entry: [{ content: { roles: [role] } }] });
    await expect(getHygieneAccess()).resolves.toEqual({ canCollect, canReview });
});
