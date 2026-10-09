import { expect, test } from '../fixtures/test.js';

test.describe('Sign-in @ui @smoke', () => {
  test('a valid operator reaches the console', async ({ loginPage }) => {
    await loginPage.goto();

    const fleetConsole = await loginPage.signInAs('operator');

    await expect(fleetConsole.currentUser).toContainText('Shift Operator');
    await expect(fleetConsole.currentUser).toContainText('operator');
    expect(await fleetConsole.rowCount()).toBeGreaterThan(0);
  });

  test.describe('rejected credentials @regression', () => {
    const cases = [
      { label: 'wrong password', username: 'admin', password: 'nope', message: 'Invalid username or password' },
      { label: 'unknown user', username: 'ghost', password: 'Admin@123', message: 'Invalid username or password' },
      { label: 'locked account', username: 'locked', password: 'Locked@123', message: 'locked' },
      { label: 'empty password', username: 'admin', password: '', message: 'required' },
      { label: 'empty username', username: '', password: 'Admin@123', message: 'required' },
      { label: 'SQL-injection payload', username: "' OR '1'='1", password: "' OR '1'='1", message: 'Invalid username or password' },
    ];

    for (const { label, username, password, message } of cases) {
      test(`rejects ${label}`, async ({ loginPage }) => {
        await loginPage.goto();

        await loginPage.signIn(username, password);

        await loginPage.expectRejection(message);
      });
    }
  });

  test('the error is announced to assistive technology @regression @a11y', async ({ loginPage }) => {
    await loginPage.goto();

    await loginPage.signIn('admin', 'wrong');

    await expect(loginPage.error).toHaveAttribute('role', 'alert');
  });

  test('the password is never echoed back into the field after a failure @regression', async ({
    loginPage,
  }) => {
    await loginPage.goto();

    await loginPage.signIn('admin', 'wrong-password');
    await expect(loginPage.error).toBeVisible();

    await expect(loginPage.password).toHaveAttribute('type', 'password');
  });

  test('the form can be completed with the keyboard alone @regression @a11y', async ({
    page,
    loginPage,
  }) => {
    await loginPage.goto();

    await loginPage.username.focus();
    await page.keyboard.type('viewer');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Viewer@123');
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('console-view')).toBeVisible();
  });

  test('signing out returns to the login form and clears the session @regression', async ({
    console: fleetConsole,
    page,
  }) => {
    await fleetConsole.signOut.click();

    await expect(page.getByTestId('login-view')).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('fp.token'))).toBeNull();

    // Reloading must not resurrect the session.
    await page.reload();
    await expect(page.getByTestId('login-view')).toBeVisible();
  });
});
