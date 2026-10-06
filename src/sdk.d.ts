export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
export interface Credentials { endpoint: string; storeId: string; accessToken: string; encryptionKey: string }
export interface Entry<T = JSONValue> { key: string; value: T; version: number }
export interface Metadata { storeId: string; createdAt: string; freeUntil: string; plan: 'starter'; rows: number; bytes: number; limits: { rows: number; bytes: number; requestsPerMonth: number }; pricing: { currency: 'GBP'; starterAnnual: number; plusMonthly: number; billingEnabled: false } }
export class VibeCodeStorageError extends Error { status: number; code: string }
export class VibeCodeStorage {
  constructor(credentials: Credentials);
  credentials: Credentials;
  static create(options?: { endpoint?: string }): Promise<{ store: VibeCodeStorage; metadata: Metadata }>;
  info(): Promise<Metadata>;
  get<T = JSONValue>(key: string): Promise<T>;
  getEntry<T = JSONValue>(key: string): Promise<Entry<T>>;
  set(key: string, value: JSONValue, options?: { version?: number }): Promise<{ id: string; version: number }>;
  list(): Promise<Entry[]>;
  delete(key: string, options?: { version?: number }): Promise<{ deleted: true }>;
  export(): Promise<{ format: string; exportedAt: string; rows: Entry[] }>;
  destroy(): Promise<{ deleted: true }>;
}
