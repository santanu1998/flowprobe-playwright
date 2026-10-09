import { expect, test } from '../fixtures/test.js';
import { FleetApi } from '../support/fleet-api.js';
import type { Alert, ApiError } from '../support/types.js';

/**
 * IoT ingest and alerting.
 *
 * Readings are injected through the test-mode hook that stands in for an MQTT publish, so the
 * threshold rules can be verified deterministically rather than by waiting for a device to
 * misbehave on its own.
 */
test.describe('Telemetry and alerting @api @iot', () => {
  test('a reading above the temperature ceiling raises a critical alert @smoke', async ({
    request,
    createdDevices,
  }) => {
    const api = await FleetApi.as(request, 'operator');
    const device = await api.create(api.uniqueDevice());
    createdDevices.push(device);

    const response = await api.injectReading(device.id, { temperatureC: 46.2 });

    expect(response.status()).toBe(201);
    const { alerts } = (await response.json()) as { alerts: Alert[] };
    const raised = alerts.find((a) => a.code === 'HIGH_TEMPERATURE');

    expect(raised, 'a HIGH_TEMPERATURE alert should have been raised').toBeDefined();
    expect(raised?.severity).toBe('critical');
    expect(raised?.message).toContain('46.2');
    expect(raised?.acknowledged).toBe(false);
  });

  test('a reading at the boundary does not raise an alert @regression', async ({
    request,
    createdDevices,
  }) => {
    const api = await FleetApi.as(request, 'operator');
    const device = await api.create(api.uniqueDevice());
    createdDevices.push(device);

    // The rule is "above 40", so exactly 40 must stay quiet. Off-by-one at a threshold is the
    // defect this test exists for.
    const response = await api.injectReading(device.id, { temperatureC: 40 });

    const { alerts } = (await response.json()) as { alerts: Alert[] };
    expect(alerts).toHaveLength(0);
  });

  test('a weak signal raises a warning, not a critical @regression', async ({
    request,
    createdDevices,
  }) => {
    const api = await FleetApi.as(request, 'operator');
    const device = await api.create(api.uniqueDevice());
    createdDevices.push(device);

    const response = await api.injectReading(device.id, { signalDbm: -94 });

    const { alerts } = (await response.json()) as { alerts: Alert[] };
    expect(alerts[0]?.code).toBe('WEAK_SIGNAL');
    expect(alerts[0]?.severity).toBe('warning');
  });

  test('an open alert is not duplicated by a second breach @regression', async ({
    request,
    createdDevices,
  }) => {
    const api = await FleetApi.as(request, 'operator');
    const device = await api.create(api.uniqueDevice());
    createdDevices.push(device);

    await api.injectReading(device.id, { temperatureC: 44 });
    const second = await api.injectReading(device.id, { temperatureC: 47 });

    const { alerts } = (await second.json()) as { alerts: Alert[] };
    expect(alerts, 'a second breach must not stack a duplicate alert').toHaveLength(0);

    const open = await api.alerts({ acknowledged: 'false' });
    expect(open.filter((a) => a.deviceId === device.id && a.code === 'HIGH_TEMPERATURE')).toHaveLength(1);
  });

  test('readings accumulate on the device timeline in order @regression', async ({
    request,
    createdDevices,
  }) => {
    const api = await FleetApi.as(request, 'operator');
    const device = await api.create(api.uniqueDevice());
    createdDevices.push(device);

    for (const temperatureC of [21.1, 22.2, 23.3]) {
      await api.injectReading(device.id, { temperatureC });
    }

    const readings = await api.telemetry(device.id);

    expect(readings).toHaveLength(3);
    expect(readings.map((r) => r.temperatureC)).toEqual([21.1, 22.2, 23.3]);
    const timestamps = readings.map((r) => new Date(r.at).getTime());
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  test('acknowledging an alert removes it from the open list and records who did it @regression', async ({
    request,
    createdDevices,
  }) => {
    const api = await FleetApi.as(request, 'operator');
    const device = await api.create(api.uniqueDevice());
    createdDevices.push(device);
    await api.injectReading(device.id, { temperatureC: 45 });

    const open = (await api.alerts({ acknowledged: 'false' })).filter((a) => a.deviceId === device.id);
    expect(open).toHaveLength(1);

    const response = await api.acknowledgeResponse(open[0]!.id);
    expect(response.status()).toBe(200);

    const acknowledged = (await response.json()) as Alert;
    expect(acknowledged.acknowledged).toBe(true);
    expect(acknowledged.acknowledgedBy).toBe('operator');

    const stillOpen = await api.alerts({ acknowledged: 'false' });
    expect(stillOpen.some((a) => a.id === open[0]!.id)).toBe(false);
  });

  test('a viewer cannot acknowledge an alert @regression', async ({ request, createdDevices }) => {
    const operator = await FleetApi.as(request, 'operator');
    const device = await operator.create(operator.uniqueDevice());
    createdDevices.push(device);
    await operator.injectReading(device.id, { temperatureC: 45 });

    const open = (await operator.alerts({ acknowledged: 'false' })).filter((a) => a.deviceId === device.id);
    const viewer = await FleetApi.as(request, 'viewer');

    expect((await viewer.acknowledgeResponse(open[0]!.id)).status()).toBe(403);
  });

  test('alerts can be filtered by severity @regression', async ({ request }) => {
    const api = await FleetApi.as(request, 'viewer');

    const critical = await api.alerts({ severity: 'critical' });

    expect(critical.length).toBeGreaterThan(0);
    expect(critical.every((a) => a.severity === 'critical')).toBe(true);
  });

  test('a command to an offline device is refused with a conflict @regression', async ({
    request,
    createdDevices,
  }) => {
    const api = await FleetApi.as(request, 'operator');
    const device = await api.create(api.uniqueDevice({ status: 'offline' }));
    createdDevices.push(device);

    const response = await api.commandResponse(device.id, 'reboot');

    expect(response.status()).toBe(409);
    expect(((await response.json()) as ApiError).error.message).toContain('offline');
  });

  test('an unsupported command is rejected before it is queued @regression', async ({
    request,
    createdDevices,
  }) => {
    const api = await FleetApi.as(request, 'operator');
    const device = await api.create(api.uniqueDevice());
    createdDevices.push(device);

    const response = await api.commandResponse(device.id, 'self-destruct');

    expect(response.status()).toBe(422);
    const body = (await response.json()) as ApiError;
    expect(body.error.errors?.[0]?.field).toBe('command');
  });

  test('a valid command is accepted and queued with an audit trail @smoke', async ({
    request,
    createdDevices,
  }) => {
    const api = await FleetApi.as(request, 'operator');
    const device = await api.create(api.uniqueDevice());
    createdDevices.push(device);

    const response = await api.commandResponse(device.id, 'reboot');

    expect(response.status()).toBe(202);
    expect(await response.json()).toMatchObject({
      deviceId: device.id,
      command: 'reboot',
      issuedBy: 'operator',
      status: 'queued',
    });
  });
});
