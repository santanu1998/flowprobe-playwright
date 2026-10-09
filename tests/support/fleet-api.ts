import type { APIRequestContext, APIResponse } from '@playwright/test';

import type {
  Alert,
  Device,
  DevicePage,
  FleetSummary,
  LoginResult,
  Reading,
  Role,
} from './types.js';
import { CREDENTIALS } from './types.js';

/**
 * Typed client for the fleet API.
 *
 * Tests assert; the client transports. Every method returns the raw {@link APIResponse} where the
 * status code is part of what is being verified, and a typed helper where it is not — so a negative
 * test can inspect a 422 body without the client throwing it away.
 */
export class FleetApi {
  constructor(private readonly request: APIRequestContext, private token?: string) {}

  /** Authenticates and returns a client bound to that session. */
  static async as(request: APIRequestContext, role: Role): Promise<FleetApi> {
    const api = new FleetApi(request);
    const { token } = await api.loginAs(role);
    return new FleetApi(request, token);
  }

  private headers(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  get sessionToken(): string | undefined {
    return this.token;
  }

  // ----------------------------------------------------------------- auth

  login(username: string, password: string): Promise<APIResponse> {
    return this.request.post('/api/auth/login', { data: { username, password } });
  }

  async loginAs(role: Role): Promise<LoginResult> {
    const credentials = CREDENTIALS[role];
    const response = await this.login(credentials.username, credentials.password);
    if (!response.ok()) {
      throw new Error(`Could not authenticate as '${role}': HTTP ${response.status()}`);
    }
    return (await response.json()) as LoginResult;
  }

  me(): Promise<APIResponse> {
    return this.request.get('/api/auth/me', { headers: this.headers() });
  }

  logout(): Promise<APIResponse> {
    return this.request.post('/api/auth/logout', { headers: this.headers() });
  }

  // ----------------------------------------------------------------- fleet

  health(): Promise<APIResponse> {
    return this.request.get('/api/health');
  }

  summaryResponse(): Promise<APIResponse> {
    return this.request.get('/api/fleet/summary', { headers: this.headers() });
  }

  async summary(): Promise<FleetSummary> {
    return (await (await this.summaryResponse()).json()) as FleetSummary;
  }

  listResponse(params: Record<string, string | number> = {}): Promise<APIResponse> {
    return this.request.get('/api/devices', { headers: this.headers(), params });
  }

  async list(params: Record<string, string | number> = {}): Promise<DevicePage> {
    return (await (await this.listResponse(params)).json()) as DevicePage;
  }

  getResponse(id: number): Promise<APIResponse> {
    return this.request.get(`/api/devices/${id}`, { headers: this.headers() });
  }

  createResponse(payload: Partial<Device>): Promise<APIResponse> {
    return this.request.post('/api/devices', { headers: this.headers(), data: payload });
  }

  async create(payload: Partial<Device>): Promise<Device> {
    const response = await this.createResponse(payload);
    if (response.status() !== 201) {
      throw new Error(`Device creation failed: HTTP ${response.status()} ${await response.text()}`);
    }
    return (await response.json()) as Device;
  }

  patchResponse(id: number, changes: Partial<Device>): Promise<APIResponse> {
    return this.request.patch(`/api/devices/${id}`, { headers: this.headers(), data: changes });
  }

  deleteResponse(id: number): Promise<APIResponse> {
    return this.request.delete(`/api/devices/${id}`, { headers: this.headers() });
  }

  commandResponse(id: number, command: string): Promise<APIResponse> {
    return this.request.post(`/api/devices/${id}/commands`, {
      headers: this.headers(),
      data: { command },
    });
  }

  // ------------------------------------------------------------- telemetry

  telemetryResponse(id: number, limit = 50): Promise<APIResponse> {
    return this.request.get(`/api/devices/${id}/telemetry`, {
      headers: this.headers(),
      params: { limit },
    });
  }

  async telemetry(id: number, limit = 50): Promise<Reading[]> {
    const body = (await (await this.telemetryResponse(id, limit)).json()) as { readings: Reading[] };
    return body.readings;
  }

  /** Test-mode hook that stands in for an MQTT publish from a real device. */
  injectReading(deviceId: number, reading: Partial<Reading>): Promise<APIResponse> {
    return this.request.post('/api/test/telemetry', { data: { deviceId, reading } });
  }

  // ---------------------------------------------------------------- alerts

  alertsResponse(params: Record<string, string> = {}): Promise<APIResponse> {
    return this.request.get('/api/alerts', { headers: this.headers(), params });
  }

  async alerts(params: Record<string, string> = {}): Promise<Alert[]> {
    const body = (await (await this.alertsResponse(params)).json()) as { items: Alert[] };
    return body.items;
  }

  acknowledgeResponse(alertId: number): Promise<APIResponse> {
    return this.request.post(`/api/alerts/${alertId}/acknowledge`, { headers: this.headers() });
  }

  // ------------------------------------------------------------- test data

  /**
   * Creates a device whose name is unique to this run.
   *
   * Parallel workers share one application instance, so isolation comes from each test owning its
   * own data rather than from resetting global state and hoping no one else is mid-assertion.
   */
  uniqueDevice(overrides: Partial<Device> = {}): Partial<Device> {
    const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    return {
      name: `QA-${stamp}`.toUpperCase(),
      type: 'sensor',
      site: 'Pune-Edge',
      firmware: '3.2.1',
      status: 'online',
      batteryPct: 90,
      ...overrides,
    };
  }
}
