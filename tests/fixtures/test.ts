import { test as base, expect, type Page } from '@playwright/test';

import { FleetApi } from '../support/fleet-api.js';
import { describeHeals, healEvents } from '../support/smart-locator.js';
import { FleetConsolePage } from '../pages/fleet-console.page.js';
import { LoginPage } from '../pages/login.page.js';
import type { Device, Role } from '../support/types.js';
import { CREDENTIALS } from '../support/types.js';

/**
 * Shared fixtures.
 *
 * Three jobs:
 *  1. hand every test a typed API client and page objects, so no test builds its own plumbing;
 *  2. sign in through the API and seed the session, so UI tests about the catalogue are not
 *     re-testing the login form forty times;
 *  3. clean up data the test created and attach evidence when it fails.
 */

interface Fixtures {
  /** Role the `console` fixture signs in as. Override per file or per test. */
  role: Role;
  api: FleetApi;
  loginPage: LoginPage;
  console: FleetConsolePage;
  /** Devices registered here are removed after the test, pass or fail. */
  createdDevices: Device[];
}

export const test = base.extend<Fixtures>({
  role: ['operator', { option: true }],

  api: async ({ request }, use) => {
    await use(new FleetApi(request));
  },

  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  createdDevices: async ({ request }, use) => {
    const devices: Device[] = [];
    await use(devices);

    if (devices.length > 0) {
      // Admin, because deletion is admin-only — and cleanup must not depend on the role the
      // test happened to run as.
      const admin = await FleetApi.as(request, 'admin');
      for (const device of devices) {
        await admin.deleteResponse(device.id);
      }
    }
  },

  /**
   * A signed-in console. Authentication happens over the API and the session is injected before
   * the first script runs, which removes ~1.5 s and one whole class of flakiness from every UI
   * test that is not itself about signing in.
   */
  console: async ({ page, request, role }, use) => {
    const api = new FleetApi(request);
    const { token, user } = await api.loginAs(role);
    await seedSession(page, token, user);

    await page.goto('/');
    const fleetConsole = new FleetConsolePage(page);
    await fleetConsole.waitUntilLoaded();
    await use(fleetConsole);
  },
});

/** The console keeps its session in sessionStorage, so it is seeded before any page script runs. */
async function seedSession(
  page: Page,
  token: string,
  user: { username: string; role: Role; displayName: string },
): Promise<void> {
  await page.addInitScript(
    ([t, u]) => {
      sessionStorage.setItem('fp.token', t as string);
      sessionStorage.setItem('fp.user', u as string);
    },
    [token, JSON.stringify(user)] as const,
  );
}

/* Attach any locator repairs to the report — a self-healed run is a passing run that still needs
   a follow-up, and that fact must not be lost. */
test.afterEach(async ({}, testInfo) => {
  if (healEvents().length > 0) {
    await testInfo.attach('locator-repairs', {
      body: describeHeals(),
      contentType: 'text/plain',
    });
  }
});

export { expect, CREDENTIALS };
export type { Role };
