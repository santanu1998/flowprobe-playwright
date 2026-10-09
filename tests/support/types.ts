/** Shared domain types. Keeping them in one place means a contract change breaks compilation,
 *  not a test at 2 a.m. */

export type Role = 'viewer' | 'operator' | 'admin';

export type DeviceStatus = 'online' | 'offline' | 'degraded';

export type DeviceType = 'gateway' | 'sensor' | 'controller' | 'camera';

export interface Device {
  id: number;
  name: string;
  type: DeviceType;
  site: string;
  firmware: string;
  status: DeviceStatus;
  batteryPct: number;
  tags: string[];
  lastSeen: string;
  createdAt: string;
}

export interface DevicePage {
  total: number;
  page: number;
  pageSize: number;
  items: Device[];
}

export interface Alert {
  id: number;
  deviceId: number;
  deviceName: string;
  severity: 'critical' | 'warning';
  code: 'LOW_BATTERY' | 'DEVICE_UNREACHABLE' | 'HIGH_TEMPERATURE' | 'WEAK_SIGNAL';
  message: string;
  raisedAt: string;
  acknowledged: boolean;
  acknowledgedBy?: string;
}

export interface FleetSummary {
  total: number;
  online: number;
  degraded: number;
  offline: number;
  openAlerts: number;
  criticalAlerts: number;
  sites: string[];
  types: string[];
}

export interface Reading {
  deviceId: number;
  deviceName: string;
  at: string;
  temperatureC: number;
  humidityPct: number;
  signalDbm: number;
  batteryPct: number;
}

export interface LoginResult {
  token: string;
  expiresAt: string;
  user: { username: string; role: Role; displayName: string };
}

export interface ApiError {
  error: {
    status: number;
    message: string;
    errors?: Array<{ field: string; message: string }>;
  };
}

export const CREDENTIALS: Record<Role, { username: string; password: string }> = {
  admin: { username: 'admin', password: 'Admin@123' },
  operator: { username: 'operator', password: 'Operator@123' },
  viewer: { username: 'viewer', password: 'Viewer@123' },
};
