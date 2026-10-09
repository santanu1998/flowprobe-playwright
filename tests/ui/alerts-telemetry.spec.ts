import { expect, test } from '../fixtures/test.js';
import { FleetApi } from '../support/fleet-api.js';

/**
 * End-to-end IoT journey: a device publishes a breaching reading, the ingest pipeline raises an
 * alert, the console shows it, and an operator acknowledges it — asserted across UI, API and the
 * live telemetry stream in one test.
 */
test.describe('Alerts and live telemetry @ui @iot', () => {
  test('a threshold breach reaches the console and can be acknowledged there @smoke @regression', async ({
    console: fleetConsole,
    request,
    createdDevices,
    page,
  }) => {
    const api = await FleetApi.as(request, 'operator');
    const device = await api.create(api.uniqueDevice());
    createdDevices.push(device);

    await api.injectReading(device.id, { temperatureC: 47.5 });

    await page.reload();
    await fleetConsole.waitUntilLoaded();
    await fleetConsole.openAlertsTab();

    const row = fleetConsole.alertRowFor(device.name);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('alert-code')).toHaveText('HIGH_TEMPERATURE');
    await expect(row.getByTestId('alert-severity')).toHaveText('critical');

    const before = await fleetConsole.openAlertCount();
    await row.getByRole('button', { name: 'Acknowledge' }).click();

    await expect(row).toBeHidden();
    await expect
      .poll(() => fleetConsole.openAlertCount(), { timeout: 7_000 })
      .toBe(before - 1);
  });

  test('the open-alert badge matches the alerts listed @regression', async ({
    console: fleetConsole,
  }) => {
    await fleetConsole.openAlertsTab();

    const listed = await fleetConsole.alertRows.count();

    expect(await fleetConsole.openAlertCount()).toBe(listed);
  });

  test('the alerts tab and the fleet tab are mutually exclusive @regression', async ({
    console: fleetConsole,
    page,
  }) => {
    await fleetConsole.openAlertsTab();
    await expect(page.getByTestId('fleet-panel')).toBeHidden();

    await fleetConsole.openFleetTab();
    await expect(page.getByTestId('alerts-panel')).toBeHidden();
  });

  test('a new reading pushed over SSE updates the open drawer without a reload @iot @regression', async ({
    console: fleetConsole,
    request,
    createdDevices,
    page,
  }) => {
    const api = await FleetApi.as(request, 'operator');
    const device = await api.create(api.uniqueDevice());
    createdDevices.push(device);
    await api.injectReading(device.id, { temperatureC: 21 });

    await page.reload();
    await fleetConsole.waitUntilLoaded();
    await fleetConsole.filterBySearch(device.name);
    const drawer = await fleetConsole.openDevice(device.name);

    expect(await drawer.latestTemperature()).toBe(21);

    // Publish from "the device" while the operator is watching the panel.
    await api.injectReading(device.id, { temperatureC: 33.7 });

    // The stream drives the update; polling the assertion is honest, a fixed sleep is not.
    await expect.poll(() => drawer.latestTemperature(), { timeout: 10_000 }).toBe(33.7);
  });

  test('the telemetry stream requires authentication @iot @regression', async ({ request }) => {
    const response = await request.get('/api/telemetry/stream');

    expect(response.status()).toBe(401);
  });
});
