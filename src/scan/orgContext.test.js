import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canUseScan,
  scanLinkForSession,
  scanOrgSlugFromPlatform,
  resolveScanOrgForSession
} from './orgContext.js';

describe('scan orgContext', () => {
  it('usa el slug de la org de plataforma', () => {
    assert.equal(scanOrgSlugFromPlatform({ slug: 'remax-urbano' }), 'remax-urbano');
    assert.equal(scanOrgSlugFromPlatform({ id: 'abc-def-12' }), 'org-abcdef12');
  });

  it('SCAN habilitado o admin puede entrar', () => {
    assert.equal(canUseScan({ user: { id: '1' }, enabledProducts: ['SCAN'] }), true);
    assert.equal(canUseScan({ user: { id: '1', isPlatformAdmin: true }, enabledProducts: [] }), true);
    assert.equal(canUseScan({ user: { id: '1' }, enabledProducts: ['INOUT'] }), false);
    assert.equal(canUseScan(null), false);
  });

  it('prioriza el ScanOrg del LegacyIdentityLink', async () => {
    const linked = { id: 'scan-org-1', slug: 'scan-demo', status: 'ACTIVE' };
    const prisma = {
      scanOrg: {
        findUnique: async ({ where }) => (where.id === 'scan-org-1' ? linked : null)
      }
    };
    const session = {
      organization: { id: 'plat-1', slug: 'otra-cosa', name: 'Otra' },
      links: [{ product: 'SCAN', organizationId: 'plat-1', legacyTenantId: 'scan-org-1' }]
    };
    const org = await resolveScanOrgForSession(prisma, session);
    assert.equal(org.id, 'scan-org-1');
    assert.equal(scanLinkForSession(session).legacyTenantId, 'scan-org-1');
  });
});
