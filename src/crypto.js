const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function encode64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(out).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decode64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url');
  const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  if (encode64(bytes) !== value) throw new Error('Non-canonical base64url');
  return bytes;
}

export function newSecret() { return encode64(crypto.getRandomValues(new Uint8Array(32))); }

export async function keysFromSecret(secret) {
  const raw = decode64(secret);
  if (raw.length !== 32) throw new Error('Encryption key must contain 32 random bytes');
  const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  const derive = (info, algorithm, usage) => crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('vibecodestorage/v1'), info: encoder.encode(info) },
    base, algorithm, false, usage);
  return {
    encryption: await derive('records', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']),
    lookup: await derive('lookup', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign'])
  };
}

export async function rowId(keys, label) {
  if (typeof label !== 'string' || !label.length || encoder.encode(label).length > 256) throw new Error('Row key must be 1–256 UTF-8 bytes');
  return encode64(new Uint8Array(await crypto.subtle.sign('HMAC', keys.lookup, encoder.encode(label))));
}

export async function encryptRow(keys, storeId, id, label, value) {
  // JSON round-trip deliberately rejects values that would silently change on storage.
  const plain = JSON.stringify({ key: label, value }, (_key, item) => {
    if (['undefined', 'function', 'symbol', 'bigint'].includes(typeof item) || (typeof item === 'number' && !Number.isFinite(item))) throw new Error('Value must contain only JSON data');
    return item;
  });
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce,
    additionalData: encoder.encode(`vibecodestorage/v1/${storeId}/${id}`), tagLength: 128 }, keys.encryption, encoder.encode(plain));
  return { v: 1, alg: 'A256GCM', nonce: encode64(nonce), ciphertext: encode64(new Uint8Array(encrypted)) };
}

export async function decryptRow(keys, storeId, row) {
  const e = row.envelope;
  if (e.v !== 1 || e.alg !== 'A256GCM') throw new Error('Unsupported encrypted record');
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode64(e.nonce),
      additionalData: encoder.encode(`vibecodestorage/v1/${storeId}/${row.id}`), tagLength: 128 }, keys.encryption, decode64(e.ciphertext));
  } catch { throw new Error('Record authentication failed: wrong key or modified data'); }
  const result = JSON.parse(decoder.decode(plain));
  if (await rowId(keys, result.key) !== row.id) throw new Error('Record identity mismatch');
  return { ...result, version: row.version };
}
