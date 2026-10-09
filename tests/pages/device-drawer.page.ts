import { expect, type Locator, type Page } from '@playwright/test';

/** Device detail panel: attributes, live telemetry and remote commands. */
export class DeviceDrawer {
  readonly root: Locator;
  readonly title: Locator;
  readonly close: Locator;
  readonly telemetryRows: Locator;
  readonly commandResult: Locator;

  constructor(private readonly page: Page) {
    this.root = page.getByTestId('device-drawer');
    this.title = page.getByTestId('drawer-title');
    this.close = page.getByTestId('drawer-close');
    this.telemetryRows = page.getByTestId('telemetry-rows').locator('tr');
    this.commandResult = page.getByTestId('command-result');
  }

  async waitUntilOpen(deviceName: string): Promise<void> {
    await expect(this.root).toBeVisible();
    await expect(this.title).toHaveText(deviceName);
  }

  field(name: 'type' | 'site' | 'firmware' | 'battery' | 'status' | 'lastseen'): Locator {
    return this.page.getByTestId(`drawer-${name}`);
  }

  commandButton(command: 'reboot' | 'sync-firmware' | 'run-diagnostics'): Locator {
    const map = {
      reboot: 'cmd-reboot',
      'sync-firmware': 'cmd-sync',
      'run-diagnostics': 'cmd-diagnostics',
    } as const;
    return this.page.getByTestId(map[command]);
  }

  async issue(command: 'reboot' | 'sync-firmware' | 'run-diagnostics'): Promise<string> {
    await this.commandButton(command).click();
    await expect(this.commandResult).toBeVisible();
    return (await this.commandResult.textContent())?.trim() ?? '';
  }

  async telemetryRowCount(): Promise<number> {
    return this.telemetryRows.count();
  }

  async latestTemperature(): Promise<number> {
    const cell = this.telemetryRows.first().getByTestId('telemetry-temp');
    return Number((await cell.textContent())?.trim());
  }

  async dismiss(): Promise<void> {
    await this.close.click();
    await expect(this.root).toBeHidden();
  }

  async dismissWithEscape(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await expect(this.root).toBeHidden();
  }
}
