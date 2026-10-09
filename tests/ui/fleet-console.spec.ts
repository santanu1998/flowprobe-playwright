import { expect, test } from '../fixtures/test.js';
import { FleetApi } from '../support/fleet-api.js';

test.describe('Fleet console @ui', () => {
  test('the summary tiles are internally consistent @smoke', async ({ console: fleetConsole }) => {
    const [total, online, degraded, offline, alerts] = await Promise.all([
      fleetConsole.stat('total'),
      fleetConsole.stat('online'),
      fleetConsole.stat('degraded'),
      fleetConsole.stat('offline'),
      fleetConsole.stat('alerts'),
    ]);

    // Asserted as an invariant rather than against a second API call: sibling tests register and
    // retire devices in parallel, so any absolute count would be a race, not a defect detector.
    // The invariant holds no matter what else the fleet is doing.
    expect(online + degraded + offline).toBe(total);
    for (const value of [total, online, degraded, offline, alerts]) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
    expect(total).toBeGreaterThan(0);
  });

  test('the grid agrees with the API for a given site @smoke', async ({
    console: fleetConsole,
    request,
  }) => {
    // Kolkata-DC1 holds only seeded devices — no test registers into it — so this cross-layer
    // check is deterministic while the rest of the suite runs in parallel.
    const api = await FleetApi.as(request, 'viewer');
    const expected = await api.list({ site: 'Kolkata-DC1' });

    await fleetConsole.filterBySite('Kolkata-DC1');

    expect(await fleetConsole.deviceNames()).toEqual(expected.items.map((d) => d.name));
    expect(await fleetConsole.statuses()).toEqual(expected.items.map((d) => d.status));
  });

  test('the grid lists devices in name order @smoke', async ({ console: fleetConsole }) => {
    const names = await fleetConsole.deviceNames();

    expect(names.length).toBeGreaterThan(0);
    expect(names).toEqual([...names].sort());
  });

  test('filtering by status shows only that status @regression', async ({ console: fleetConsole }) => {
    await fleetConsole.filterByStatus('offline');

    const statuses = await fleetConsole.statuses();
    expect(statuses.length).toBeGreaterThan(0);
    expect(new Set(statuses)).toEqual(new Set(['offline']));
  });

  test('filtering by site narrows the grid and the count follows @regression', async ({
    console: fleetConsole,
    request,
  }) => {
    const api = await FleetApi.as(request, 'viewer');
    const expected = await api.list({ site: 'Kolkata-DC1' });

    await fleetConsole.filterBySite('Kolkata-DC1');

    expect(await fleetConsole.rowCount()).toBe(expected.total);
    await expect(fleetConsole.resultCount).toHaveText(`${expected.total} devices`);
  });

  test('search and status filters compose @regression', async ({ console: fleetConsole }) => {
    await fleetConsole.filterBySearch('SN-');
    await fleetConsole.filterByStatus('online');

    const names = await fleetConsole.deviceNames();
    const statuses = await fleetConsole.statuses();

    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n.startsWith('SN-'))).toBe(true);
    expect(new Set(statuses)).toEqual(new Set(['online']));
  });

  test('a search with no matches shows the empty state, not an empty table @regression', async ({
    console: fleetConsole,
  }) => {
    await fleetConsole.filterBySearch('no-such-device-anywhere');

    await expect(fleetConsole.emptyState).toBeVisible();
    expect(await fleetConsole.rowCount()).toBe(0);
    await expect(fleetConsole.resultCount).toHaveText('0 devices');
  });

  test('clearing the filters resets every control and widens the grid @regression', async ({
    console: fleetConsole,
  }) => {
    await fleetConsole.filterBySite('Kolkata-DC1');
    await fleetConsole.filterByStatus('offline');
    const narrowed = await fleetConsole.rowCount();

    await fleetConsole.resetFilters();

    await expect(fleetConsole.search).toHaveValue('');
    await expect(fleetConsole.siteFilter).toHaveValue('');
    await expect(fleetConsole.statusFilter).toHaveValue('');
    expect(await fleetConsole.rowCount()).toBeGreaterThan(narrowed);
  });

  test('a newly registered device appears in the grid after a refresh @regression', async ({
    console: fleetConsole,
    request,
    createdDevices,
    page,
  }) => {
    const api = await FleetApi.as(request, 'operator');
    const device = await api.create(api.uniqueDevice({ site: 'Pune-Edge' }));
    createdDevices.push(device);

    await page.reload();
    await fleetConsole.waitUntilLoaded();
    await fleetConsole.filterBySearch(device.name);

    await expect(fleetConsole.rowFor(device.name)).toBeVisible();
    await expect(fleetConsole.rowFor(device.name)).toContainText('Pune-Edge');
  });

  test('the grid survives a markup refactor via ranked selectors @regression', async ({
    console: fleetConsole,
    page,
  }) => {
    // Simulate the refactor that breaks most suites: the agreed test id is dropped.
    await page.evaluate(() => {
      document.querySelector('[data-test="device-table"]')?.removeAttribute('data-test');
    });

    const grid = await fleetConsole.resilientGrid();

    await expect(grid).toBeVisible();
  });
});

test.describe('Device detail @ui', () => {
  test('opening a device shows its attributes and telemetry @smoke', async ({
    console: fleetConsole,
    request,
  }) => {
    const api = await FleetApi.as(request, 'viewer');
    const expected = (await api.list({ search: 'GW-KOL-001' })).items[0]!;

    const drawer = await fleetConsole.openDevice('GW-KOL-001');

    await expect(drawer.field('type')).toHaveText(expected.type);
    await expect(drawer.field('site')).toHaveText(expected.site);
    await expect(drawer.field('firmware')).toHaveText(expected.firmware);
    await expect(drawer.field('battery')).toHaveText(`${expected.batteryPct}%`);
    await expect(drawer.field('status')).toHaveText(expected.status);
    expect(await drawer.telemetryRowCount()).toBeGreaterThan(0);
  });

  test('the drawer closes with the button and with Escape @regression', async ({
    console: fleetConsole,
  }) => {
    const drawer = await fleetConsole.openDevice('GW-KOL-001');
    await drawer.dismiss();

    const reopened = await fleetConsole.openDevice('SN-KOL-101');
    await reopened.dismissWithEscape();
  });

  test('an operator can issue a command to an online device @regression', async ({
    console: fleetConsole,
    request,
    createdDevices,
    page,
  }) => {
    const api = await FleetApi.as(request, 'operator');
    const device = await api.create(api.uniqueDevice());
    createdDevices.push(device);

    await page.reload();
    await fleetConsole.waitUntilLoaded();
    await fleetConsole.filterBySearch(device.name);
    const drawer = await fleetConsole.openDevice(device.name);

    const message = await drawer.issue('reboot');

    expect(message).toContain("Command 'reboot' queued");
  });

  test('commanding an offline device surfaces the conflict to the user @regression', async ({
    console: fleetConsole,
    request,
    createdDevices,
    page,
  }) => {
    const api = await FleetApi.as(request, 'operator');
    const device = await api.create(api.uniqueDevice({ status: 'offline' }));
    createdDevices.push(device);

    await page.reload();
    await fleetConsole.waitUntilLoaded();
    await fleetConsole.filterBySearch(device.name);
    const drawer = await fleetConsole.openDevice(device.name);

    const message = await drawer.issue('reboot');

    expect(message).toContain('offline');
    await expect(drawer.commandResult).toHaveClass(/bad/);
  });

  test.describe('read-only role', () => {
    test.use({ role: 'viewer' });

    test('a viewer sees the fleet but cannot command a device @regression', async ({
      console: fleetConsole,
    }) => {
      const drawer = await fleetConsole.openDevice('GW-KOL-001');

      await expect(drawer.commandButton('reboot')).toBeDisabled();
      await expect(drawer.commandButton('sync-firmware')).toBeDisabled();
      await expect(drawer.commandButton('run-diagnostics')).toBeDisabled();
    });
  });
});
