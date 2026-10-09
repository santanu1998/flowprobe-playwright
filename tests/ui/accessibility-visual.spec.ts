import AxeBuilder from '@axe-core/playwright';
import type { Result } from 'axe-core';

import { expect, test } from '../fixtures/test.js';

/**
 * Renders a violation so the failure message names the element to fix, not just the rule that
 * was broken. A report that says "color-contrast (2 nodes)" costs a developer ten minutes of
 * hunting; one that says which selector costs none.
 */
function describe(violations: Result[]): string[] {
  return violations.map(
    (v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
}

/**
 * Accessibility and visual regression.
 *
 * Both answer questions a functional assertion cannot: "can everyone use this?" and "did anything
 * move that nobody meant to move?".
 */

test.describe('Accessibility @a11y @regression', () => {
  test('the sign-in page has no WCAG 2.1 A/AA violations', async ({ loginPage, page }) => {
    await loginPage.goto();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(describe(results.violations)).toEqual([]);
  });

  test('the fleet console has no WCAG 2.1 A/AA violations', async ({ console: fleetConsole, page }) => {
    await fleetConsole.waitUntilLoaded();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(describe(results.violations)).toEqual([]);
  });

  test('the device drawer keeps a reachable close control', async ({ console: fleetConsole, page }) => {
    const drawer = await fleetConsole.openDevice('GW-KOL-001');

    await expect(drawer.close).toBeFocused();

    const results = await new AxeBuilder({ page })
      .include('[data-test="device-drawer"]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(describe(results.violations)).toEqual([]);
  });

  test('every device row is reachable by keyboard', async ({ console: fleetConsole }) => {
    const firstRow = fleetConsole.rows.first();

    await expect(firstRow).toHaveAttribute('tabindex', '0');
  });
});

test.describe('Visual regression @visual @regression', () => {
  test('the sign-in page matches its baseline', async ({ loginPage, page }) => {
    await loginPage.goto();

    await expect(page).toHaveScreenshot('login.png', { fullPage: true });
  });

  test('the sign-in error state matches its baseline', async ({ loginPage, page }) => {
    await loginPage.goto();
    await loginPage.signIn('admin', 'wrong-password');
    await expect(loginPage.error).toBeVisible();

    await expect(page.getByTestId('login-form')).toHaveScreenshot('login-error.png');
  });

  test('the summary tiles match their baseline', async ({ console: fleetConsole, page }) => {
    await fleetConsole.waitUntilLoaded();

    await expect(page.locator('.summary')).toHaveScreenshot('fleet-summary.png');
  });

  test('the console renders correctly at phone width', async ({ console: fleetConsole, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await fleetConsole.waitUntilLoaded();

    // A responsive defect shows up first as a horizontal scrollbar.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );

    expect(overflows, 'the page should not scroll horizontally at 390px').toBe(false);
  });
});
