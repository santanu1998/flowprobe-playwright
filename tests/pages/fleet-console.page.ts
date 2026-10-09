import { expect, type Locator, type Page } from '@playwright/test';

import { smartLocator } from '../support/smart-locator.js';
import { DeviceDrawer } from './device-drawer.page.js';

/** The signed-in console: summary tiles, device grid, filters and the alerts tab. */
export class FleetConsolePage {
  readonly root: Locator;
  readonly search: Locator;
  readonly siteFilter: Locator;
  readonly statusFilter: Locator;
  readonly clearFilters: Locator;
  readonly rows: Locator;
  readonly emptyState: Locator;
  readonly resultCount: Locator;
  readonly currentUser: Locator;
  readonly signOut: Locator;
  readonly alertBadge: Locator;
  readonly alertRows: Locator;

  constructor(readonly page: Page) {
    this.root = page.getByTestId('console-view');
    this.search = page.getByTestId('filter-search');
    this.siteFilter = page.getByTestId('filter-site');
    this.statusFilter = page.getByTestId('filter-status');
    this.clearFilters = page.getByTestId('filter-clear');
    this.rows = page.getByTestId('device-rows').locator('tr');
    this.emptyState = page.getByTestId('no-devices');
    this.resultCount = page.getByTestId('result-count');
    this.currentUser = page.getByTestId('current-user');
    this.signOut = page.getByTestId('logout');
    this.alertBadge = page.getByTestId('alert-count');
    this.alertRows = page.getByTestId('alert-rows').locator('tr');
  }

  async waitUntilLoaded(): Promise<void> {
    await expect(this.root).toBeVisible();
    // The grid is populated by three concurrent fetches; waiting for the first row is the
    // honest signal that the view is usable, and it removes any need for a fixed delay.
    await expect(this.rows.first()).toBeVisible();
  }

  // ------------------------------------------------------------- summary

  async stat(name: 'total' | 'online' | 'degraded' | 'offline' | 'alerts'): Promise<number> {
    const tile = this.page.getByTestId(`stat-${name}`).locator('.n');
    await expect(tile).not.toHaveText('–');
    return Number((await tile.textContent())?.trim());
  }

  // --------------------------------------------------------------- grid

  rowFor(deviceName: string): Locator {
    return this.page.getByTestId('device-rows').locator('tr', { hasText: deviceName });
  }

  async deviceNames(): Promise<string[]> {
    return this.rows.locator('[data-test="device-name"]').allInnerTexts();
  }

  async statuses(): Promise<string[]> {
    return this.rows.locator('[data-test="device-status"]').allInnerTexts();
  }

  async rowCount(): Promise<number> {
    return this.rows.count();
  }

  // ------------------------------------------------------------ filters

  async filterBySearch(term: string): Promise<void> {
    await this.withGridRefresh(() => this.search.fill(term));
  }

  async filterBySite(site: string): Promise<void> {
    await this.withGridRefresh(() => this.siteFilter.selectOption(site));
  }

  async filterByStatus(status: 'online' | 'degraded' | 'offline' | ''): Promise<void> {
    await this.withGridRefresh(() => this.statusFilter.selectOption(status));
  }

  async resetFilters(): Promise<void> {
    await this.withGridRefresh(() => this.clearFilters.click());
  }

  /**
   * Runs an action that refetches the grid and waits for that fetch.
   *
   * The waiter is armed *before* the action: the Clear button fires its request synchronously, so
   * a wait registered afterwards can miss a response that has already arrived. That ordering is the
   * difference between a reliable step and an intermittent 10-second timeout.
   */
  private async withGridRefresh(action: () => Promise<unknown>): Promise<void> {
    const settled = this.page.waitForResponse(
      (r) => r.url().includes('/api/devices') && r.request().method() === 'GET',
      { timeout: 10_000 },
    );
    await action();
    await settled;
    await expect(this.resultCount).toContainText('device');
  }

  // --------------------------------------------------------------- tabs

  async openAlertsTab(): Promise<void> {
    await this.page.getByTestId('tab-alerts').click();
    await expect(this.page.getByTestId('alerts-panel')).toBeVisible();
  }

  async openFleetTab(): Promise<void> {
    await this.page.getByTestId('tab-fleet').click();
    await expect(this.page.getByTestId('fleet-panel')).toBeVisible();
  }

  alertRowFor(code: string): Locator {
    return this.page.getByTestId('alert-rows').locator('tr', { hasText: code });
  }

  async openAlertCount(): Promise<number> {
    return Number((await this.alertBadge.textContent())?.trim());
  }

  // -------------------------------------------------------------- drawer

  async openDevice(deviceName: string): Promise<DeviceDrawer> {
    await this.rowFor(deviceName).click();
    const drawer = new DeviceDrawer(this.page);
    await drawer.waitUntilOpen(deviceName);
    return drawer;
  }

  /**
   * Resolves the device grid through ranked candidates, so a markup refactor that renames the
   * table does not take the whole suite down with it.
   */
  async resilientGrid(): Promise<Locator> {
    return smartLocator(this.page, 'Device grid', [
      '[data-test="device-table"]',
      'table.grid',
      'main table',
      'table',
    ]);
  }
}
