import { newSecret, keysFromSecret, rowId, encryptRow, decryptRow } from './crypto.js';

export class VibeCodeStorageError extends Error {
  constructor(message, status, code) { super(message); this.name = 'VibeCodeStorageError'; this.status = status; this.code = code; }
}

export function validateEndpoint(value) {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('Endpoint must be a plain origin');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) {
    throw new Error('HTTPS is required except on loopback');
  }
  return u.origin;
}

export async function request(endpoint, path, { token, method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${validateEndpoint(endpoint)}${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new VibeCodeStorageError(data.error?.message || 'API request failed', res.status, data.error?.code);
  return data;
}

export class VibeCodeStorage {
  constructor(credentials) {
    this.credentials = { ...credentials, endpoint: validateEndpoint(credentials.endpoint) };
    if (!/^[A-Za-z0-9_-]{24}$/.test(credentials.storeId)) throw new Error('Invalid store ID');
    this.keys = keysFromSecret(credentials.encryptionKey);
  }
  static async create({ endpoint = 'https://api.vibecodestorage.com' } = {}) {
    const encryptionKey = newSecret(); // Never transmitted.
    const created = await request(endpoint, '/v1/stores', { method: 'POST', body: {} });
    return { store: new VibeCodeStorage({ endpoint, storeId: created.storeId, accessToken: created.accessToken, encryptionKey }), metadata: created.metadata };
  }
  get path() { return `/v1/stores/${this.credentials.storeId}`; }
  call(path, options = {}) { return request(this.credentials.endpoint, this.path + path, { ...options, token: this.credentials.accessToken }); }
  async info() { return this.call(''); }
  async getEntry(key) {
    const keys = await this.keys;
    const row = await this.call(`/rows/${await rowId(keys, key)}`);
    return decryptRow(keys, this.credentials.storeId, row);
  }
  async get(key) { return (await this.getEntry(key)).value; }
  async set(key, value, { version } = {}) {
    const keys = await this.keys;
    const id = await rowId(keys, key);
    // Explicit version 0 means create only. Otherwise read current version before writing.
    if (version === undefined) {
      try { version = (await this.call(`/rows/${id}`)).version; }
      catch (e) { if (e.status !== 404) throw e; version = 0; }
    }
    return this.call(`/rows/${id}`, { method: 'PUT', headers: { 'If-Match': `"${version}"` },
      body: await encryptRow(keys, this.credentials.storeId, id, key, value) });
  }
  async list() {
    const keys = await this.keys;
    const { rows } = await this.call('/rows');
    return Promise.all(rows.map(row => decryptRow(keys, this.credentials.storeId, row)));
  }
  async delete(key, { version } = {}) {
    const keys = await this.keys;
    const id = await rowId(keys, key);
    if (version === undefined) version = (await this.call(`/rows/${id}`)).version;
    return this.call(`/rows/${id}`, { method: 'DELETE', headers: { 'If-Match': `"${version}"` } });
  }
  async export() {
    const keys = await this.keys;
    const { rows } = await this.call('/export');
    return { format: 'vibecodestorage/plaintext-v1', exportedAt: new Date().toISOString(),
      rows: await Promise.all(rows.map(row => decryptRow(keys, this.credentials.storeId, row))) };
  }
  async destroy() { return this.call('', { method: 'DELETE' }); }
}
