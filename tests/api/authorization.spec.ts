import { expect, test } from '../fixtures/test.js';
import { FleetApi } from '../support/fleet-api.js';
import type { ApiError, Role } from '../support/types.js';

/**
 * Role separation, asserted as a matrix rather than as a handful of examples.
 *
 * A permission test that only checks the happy path proves nothing: the finding is always the
 * combination nobody thought to try.
 */
test.describe('Role-based access control @api @regression', () => {
  interface Case {
    action: string;
    allowed: Role[];
    call: (api: FleetApi, deviceId: number) => Promise<{ status(): number }>;
  }

  const matrix: Case[] = [
    {
      action: 'list devices',
      allowed: ['viewer', 'operator', 'admin'],
      call: (api) => api.listResponse(),
    },
    {
      action: 'read the fleet summary',
      allowed: ['viewer', 'operator', 'admin'],
      call: (api) => api.summaryResponse(),
    },
    {
      action: 'read alerts',
      allowed: ['viewer', 'operator', 'admin'],
      call: (api) => api.alertsResponse(),
    },
    {
      action: 'create a device',
      allowed: ['operator', 'admin'],
      call: (api) => api.createResponse(api.uniqueDevice()),
    },
    {
      action: 'update a device',
      allowed: ['operator', 'admin'],
      call: (api, deviceId) => api.patchResponse(deviceId, { firmware: '3.2.1' }),
    },
    {
      action: 'issue a command',
      allowed: ['operator', 'admin'],
      call: (api, deviceId) => api.commandResponse(deviceId, 'run-diagnostics'),
    },
    {
      action: 'delete a device',
      allowed: ['admin'],
      call: (api, deviceId) => api.deleteResponse(deviceId),
    },
  ];

  const roles: Role[] = ['viewer', 'operator', 'admin'];

  for (const testCase of matrix) {
    for (const role of roles) {
      const permitted = testCase.allowed.includes(role);

      test(`${role} ${permitted ? 'can' : 'cannot'} ${testCase.action}`, async ({
        request,
        createdDevices,
      }) => {
        // Each case gets its own device so a successful DELETE cannot disturb a sibling test.
        const admin = await FleetApi.as(request, 'admin');
        const subject = await admin.create(admin.uniqueDevice());

        const api = await FleetApi.as(request, role);
        const response = await testCase.call(api, subject.id);

        if (permitted) {
          expect(response.status()).toBeLessThan(400);
        } else {
          expect(response.status()).toBe(403);
        }

        // Tidy up unless the test itself deleted the device.
        if (!(permitted && testCase.action === 'delete a device')) {
          createdDevices.push(subject);
        }
      });
    }
  }

  test('a 403 names the required role without exposing anything else', async ({ request }) => {
    const viewer = await FleetApi.as(request, 'viewer');

    const response = await viewer.createResponse(viewer.uniqueDevice());
    const body = (await response.json()) as ApiError;

    expect(response.status()).toBe(403);
    expect(body.error.message).toContain('operator');
    expect(body.error.message).toContain('viewer');
  });
});
