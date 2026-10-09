import { expect, test } from '../fixtures/test.js';
import type { ApiError, LoginResult } from '../support/types.js';

test.describe('Authentication @api @smoke', () => {
  test('the service reports itself healthy', async ({ api }) => {
    const response = await api.health();

    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'UP', version: '1.0.0' });
  });

  test('valid credentials issue a scoped, expiring token', async ({ api }) => {
    const response = await api.login('admin', 'Admin@123');

    expect(response.status()).toBe(200);
    const body = (await response.json()) as LoginResult;

    expect(body.token).toMatch(/^[\w-]+\.[a-f0-9]{64}$/);
    expect(body.user).toEqual({ username: 'admin', role: 'admin', displayName: 'Fleet Admin' });
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  test('an invalid password is refused without leaking which field was wrong', async ({ api }) => {
    const response = await api.login('admin', 'wrong-password');

    expect(response.status()).toBe(401);
    const body = (await response.json()) as ApiError;
    expect(body.error.message).toBe('Invalid username or password');
    expect(JSON.stringify(body)).not.toContain('token');
  });

  test('an unknown user is refused with the same message as a wrong password @regression', async ({ api }) => {
    const unknown = await api.login('no-such-user', 'anything');
    const wrongPassword = await api.login('admin', 'anything');

    const unknownBody = (await unknown.json()) as ApiError;
    const wrongBody = (await wrongPassword.json()) as ApiError;

    // Identical responses: user enumeration is a real finding, not a nitpick.
    expect(unknown.status()).toBe(wrongPassword.status());
    expect(unknownBody.error.message).toBe(wrongBody.error.message);
  });

  test('a locked account is refused with 423 and an actionable message @regression', async ({ api }) => {
    const response = await api.login('locked', 'Locked@123');

    expect(response.status()).toBe(423);
    expect(((await response.json()) as ApiError).error.message).toContain('locked');
  });

  test('a missing field is rejected as a bad request, not as bad credentials @regression', async ({ api }) => {
    const response = await api.login('admin', '');

    expect(response.status()).toBe(400);
    expect(((await response.json()) as ApiError).error.message).toContain('required');
  });

  test('a protected route is refused without a token @regression', async ({ api }) => {
    expect((await api.summaryResponse()).status()).toBe(401);
    expect((await api.listResponse()).status()).toBe(401);
  });

  test('a tampered token is rejected @regression', async ({ request, api }) => {
    const { token } = await api.loginAs('admin');
    const tampered = `${token.slice(0, -4)}dead`;

    const response = await request.get('/api/fleet/summary', {
      headers: { Authorization: `Bearer ${tampered}` },
    });

    expect(response.status()).toBe(401);
  });

  test('signing out invalidates the token immediately @regression', async ({ request }) => {
    const { FleetApi } = await import('../support/fleet-api.js');
    const session = await FleetApi.as(request, 'viewer');

    expect((await session.me()).status()).toBe(200);
    expect((await session.logout()).status()).toBe(204);
    expect((await session.me()).status()).toBe(401);
  });
});
