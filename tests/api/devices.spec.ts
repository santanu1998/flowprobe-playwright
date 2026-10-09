import { expect, test } from '../fixtures/test.js';
import { FleetApi } from '../support/fleet-api.js';
import type { ApiError, Device } from '../support/types.js';

test.describe('Device lifecycle @api', () => {
  test('a device created over the API is readable with every field intact @smoke', async ({
    request,
    createdDevices,
  }) => {
    const api = await FleetApi.as(request, 'operator');
    const payload = api.uniqueDevice({ type: 'gateway', site: 'Chennai-DC2', batteryPct: 77 });

    const created = await api.create(payload);
    createdDevices.push(created);

    expect(created.id).toBeGreaterThan(0);
    expect(created).toMatchObject({
      name: payload.name,
      type: 'gateway',
      site: 'Chennai-DC2',
      batteryPct: 77,
      status: 'online',
    });

    const read = await api.getResponse(created.id);
    expect(read.status()).toBe(200);
    expect(await read.json()).toMatchObject({ id: created.id, name: payload.name });
  });

  test('a partial update changes only the fields it names @regression', async ({
    request,
    createdDevices,
  }) => {
    const api = await FleetApi.as(request, 'operator');
    const created = await api.create(api.uniqueDevice({ firmware: '3.2.0', batteryPct: 80 }));
    createdDevices.push(created);

    const response = await api.patchResponse(created.id, { firmware: '4.0.0-rc1' });

    expect(response.status()).toBe(200);
    const updated = (await response.json()) as Device;
    expect(updated.firmware).toBe('4.0.0-rc1');
    expect(updated.name).toBe(created.name);
    expect(updated.batteryPct).toBe(80);
    expect(updated.site).toBe(created.site);
  });

  test('deleting a device removes it and its alerts together @regression', async ({ request }) => {
    const operator = await FleetApi.as(request, 'operator');
    const admin = await FleetApi.as(request, 'admin');

    const created = await operator.create(operator.uniqueDevice({ batteryPct: 90 }));
    // Drop the battery below the threshold so the device owns an open alert.
    await operator.patchResponse(created.id, { batteryPct: 5 });
    const raised = await admin.alerts({ acknowledged: 'false' });
    expect(raised.some((a) => a.deviceId === created.id)).toBe(true);

    expect((await admin.deleteResponse(created.id)).status()).toBe(204);

    expect((await admin.getResponse(created.id)).status()).toBe(404);
    const remaining = await admin.alerts({ acknowledged: 'false' });
    expect(remaining.some((a) => a.deviceId === created.id)).toBe(false);
  });

  test('an unknown device id returns 404 with a useful message @regression', async ({ request }) => {
    const api = await FleetApi.as(request, 'viewer');

    const response = await api.getResponse(999_999);

    expect(response.status()).toBe(404);
    expect(((await response.json()) as ApiError).error.message).toContain('999999');
  });

  test.describe('validation @regression', () => {
    const invalidPayloads: Array<{ label: string; payload: Record<string, unknown>; field: string }> = [
      { label: 'name shorter than three characters', payload: { name: 'ab', type: 'sensor', site: 'Pune-Edge' }, field: 'name' },
      { label: 'unknown device type', payload: { name: 'VALID-NAME', type: 'toaster', site: 'Pune-Edge' }, field: 'type' },
      { label: 'unknown site', payload: { name: 'VALID-NAME-2', type: 'sensor', site: 'Mars-Base' }, field: 'site' },
      { label: 'battery above 100', payload: { name: 'VALID-NAME-3', type: 'sensor', site: 'Pune-Edge', batteryPct: 140 }, field: 'batteryPct' },
      { label: 'battery below zero', payload: { name: 'VALID-NAME-4', type: 'sensor', site: 'Pune-Edge', batteryPct: -1 }, field: 'batteryPct' },
      { label: 'unknown status', payload: { name: 'VALID-NAME-5', type: 'sensor', site: 'Pune-Edge', status: 'exploded' }, field: 'status' },
    ];

    for (const { label, payload, field } of invalidPayloads) {
      test(`rejects ${label} and names the offending field`, async ({ request }) => {
        const api = await FleetApi.as(request, 'operator');

        const response = await api.createResponse(payload as Partial<Device>);

        expect(response.status()).toBe(422);
        const body = (await response.json()) as ApiError;
        expect(body.error.errors?.map((e) => e.field)).toContain(field);
      });
    }

    test('rejects a duplicate device name', async ({ request, createdDevices }) => {
      const api = await FleetApi.as(request, 'operator');
      const created = await api.create(api.uniqueDevice());
      createdDevices.push(created);

      const response = await api.createResponse({ ...api.uniqueDevice(), name: created.name });

      expect(response.status()).toBe(422);
      const body = (await response.json()) as ApiError;
      expect(body.error.errors?.[0]?.message).toContain('unique');
    });

    test('rejects a malformed JSON body as a bad request', async ({ request }) => {
      const api = await FleetApi.as(request, 'operator');
      // Sent as a Buffer: a string passed to `data` would be JSON-encoded by the client and the
      // server would receive perfectly valid JSON, which is not what this test is about.
      const response = await request.post('/api/devices', {
        headers: {
          Authorization: `Bearer ${api.sessionToken}`,
          'Content-Type': 'application/json',
        },
        data: Buffer.from('{ this is not json', 'utf8'),
      });

      expect(response.status()).toBe(400);
    });

    test('rejects a JSON body that is not an object', async ({ request }) => {
      const api = await FleetApi.as(request, 'operator');
      const response = await request.post('/api/devices', {
        headers: {
          Authorization: `Bearer ${api.sessionToken}`,
          'Content-Type': 'application/json',
        },
        data: Buffer.from('"just a string"', 'utf8'),
      });

      expect(response.status()).toBe(400);
    });
  });

  test.describe('filtering and pagination @regression', () => {
    test('filters by status', async ({ request }) => {
      const api = await FleetApi.as(request, 'viewer');

      const result = await api.list({ status: 'offline' });

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.every((d) => d.status === 'offline')).toBe(true);
    });

    test('filters by site and type together', async ({ request }) => {
      const api = await FleetApi.as(request, 'viewer');

      const result = await api.list({ site: 'Kolkata-DC1', type: 'gateway' });

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.every((d) => d.site === 'Kolkata-DC1' && d.type === 'gateway')).toBe(true);
    });

    test('search is a case-insensitive substring match', async ({ request }) => {
      const api = await FleetApi.as(request, 'viewer');

      const lower = await api.list({ search: 'gw-kol' });
      const upper = await api.list({ search: 'GW-KOL' });

      expect(lower.total).toBe(upper.total);
      expect(lower.total).toBeGreaterThan(0);
    });

    test('returns results sorted by name', async ({ request }) => {
      const api = await FleetApi.as(request, 'viewer');

      const names = (await api.list({ site: 'Kolkata-DC1' })).items.map((d) => d.name);

      expect(names).toEqual([...names].sort());
    });

    test('honours the page size and caps it at 100', async ({ request }) => {
      const api = await FleetApi.as(request, 'viewer');

      const small = await api.list({ pageSize: 3 });
      expect(small.items).toHaveLength(3);
      expect(small.pageSize).toBe(3);

      const oversized = await api.list({ pageSize: 5000 });
      expect(oversized.pageSize).toBe(100);
    });

    test('a non-existent filter value yields an empty page, not an error', async ({ request }) => {
      const api = await FleetApi.as(request, 'viewer');

      const result = await api.list({ search: 'no-device-is-named-this' });

      expect(result.total).toBe(0);
      expect(result.items).toEqual([]);
    });

    test('rejects a page index below one', async ({ request }) => {
      const api = await FleetApi.as(request, 'viewer');

      expect((await api.listResponse({ page: 0 })).status()).toBe(400);
    });
  });
});
