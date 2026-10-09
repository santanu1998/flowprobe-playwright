import { expect, type Locator, type Page } from '@playwright/test';

import type { Role } from '../support/types.js';
import { CREDENTIALS } from '../support/types.js';
import { FleetConsolePage } from './fleet-console.page.js';

/** Sign-in screen. */
export class LoginPage {
  readonly username: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  readonly error: Locator;
  readonly form: Locator;

  constructor(private readonly page: Page) {
    this.form = page.getByTestId('login-form');
    this.username = page.getByTestId('username');
    this.password = page.getByTestId('password');
    this.submit = page.getByTestId('login-submit');
    this.error = page.getByTestId('login-error');
  }

  async goto(): Promise<this> {
    await this.page.goto('/');
    await expect(this.form).toBeVisible();
    return this;
  }

  async signIn(username: string, password: string): Promise<void> {
    await this.username.fill(username);
    await this.password.fill(password);
    await this.submit.click();
  }

  /** Signs in and returns the console, asserting the transition actually happened. */
  async signInAs(role: Role): Promise<FleetConsolePage> {
    const credentials = CREDENTIALS[role];
    await this.signIn(credentials.username, credentials.password);
    const console_ = new FleetConsolePage(this.page);
    await console_.waitUntilLoaded();
    return console_;
  }

  async expectRejection(message: string | RegExp): Promise<void> {
    await expect(this.error).toBeVisible();
    await expect(this.error).toContainText(message);
    await expect(this.page.getByTestId('console-view')).toBeHidden();
  }
}
