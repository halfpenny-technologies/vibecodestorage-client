import test from 'node:test';
import assert from 'node:assert/strict';
import { newSecret, keysFromSecret, rowId, encryptRow, decryptRow, decode64, encode64 } from '../src/crypto.js';
import { VibeCodeStorage, validateEndpoint } from '../src/sdk.js';

test('encrypted records round-trip; tampering, wrong keys and cross-store substitution fail', async () => {
  const keys = await keysFromSecret(newSecret());
  const id = await rowId(keys, 'settings');
  const envelope = await encryptRow(keys, 'synthetic-store', id, 'settings', { theme: 'forest' });
  const row = { id, envelope, version: 1 };
  assert.deepEqual(await decryptRow(keys, 'synthetic-store', row), { key: 'settings', value: { theme: 'forest' }, version: 1 });
  await assert.rejects(decryptRow(await keysFromSecret(newSecret()), 'synthetic-store', row), /authentication failed/);
  await assert.rejects(decryptRow(keys, 'different-store', row), /authentication failed/);
  await assert.rejects(decryptRow(keys, 'synthetic-store', { ...row, id: await rowId(keys, 'different-row') }), /authentication failed/);
  const damaged = decode64(envelope.ciphertext); damaged[0] ^= 1;
  await assert.rejects(decryptRow(keys, 'synthetic-store', { ...row, envelope: { ...envelope, ciphertext: encode64(damaged) } }), /authentication failed/);
  const next = await encryptRow(keys, 'synthetic-store', id, 'settings', { theme: 'forest' });
  assert.notEqual(next.nonce, envelope.nonce);
  await assert.rejects(encryptRow(keys, 'synthetic-store', id, 'settings', { value: Infinity }), /JSON data/);
});

test('SDK transport sends ciphertext and bearer token, never the encryption key or plaintext', async t => {
  const calls = []; let saved;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options });
    if (options.method === 'POST') return Response.json({ storeId: 'a'.repeat(24), accessToken: 'synthetic-token', metadata: {} });
    if (options.method === 'PUT') { saved = { id: url.split('/').at(-1), envelope: JSON.parse(options.body), version: 1 }; return Response.json({ version: 1 }); }
    return Response.json(saved);
  });
  const { store } = await VibeCodeStorage.create({ endpoint: 'https://example.invalid' });
  await store.set('private-label', { message: 'private-message' }, { version: 0 });
  assert.deepEqual(await store.get('private-label'), { message: 'private-message' });
  const wire = JSON.stringify(calls);
  for (const secret of [store.credentials.encryptionKey, 'private-label', 'private-message']) assert.ok(!wire.includes(secret));
  assert.equal(calls[1].headers.Authorization, 'Bearer synthetic-token');
  assert.equal(calls[1].headers['If-Match'], '"0"');
  assert.equal(calls[1].redirect, 'error');
});

test('remote endpoints require HTTPS and reject credentials or query strings', () => {
  assert.equal(validateEndpoint('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  for (const endpoint of ['http://example.com', 'https://user:secret@example.com', 'https://example.com?token=secret']) assert.throws(() => validateEndpoint(endpoint));
});

test('uncertain creation response retries the same request; caller can persist and reuse secrets', async t => {
  const calls=[];t.mock.method(globalThis,'fetch',async (_url,options)=>{calls.push(options);if(calls.length===1)throw new TypeError('Connection lost');return Response.json({storeId:'b'.repeat(24),accessToken:'synthetic-token',metadata:{}});});
  const pending=VibeCodeStorage.createRequest({endpoint:'https://example.invalid'});
  const first=await VibeCodeStorage.create({creationRequest:pending});
  const resumed=await VibeCodeStorage.create({creationRequest:pending});
  assert.equal(calls.length,3);for(const call of calls){assert.equal(call.headers['Idempotency-Key'],pending.requestId);assert.ok(!call.body.includes(pending.encryptionKey));}
  assert.deepEqual(first.store.credentials,resumed.store.credentials);
});

test('rate-limit details survive SDK errors and do not trigger creation retries',async t=>{
 let calls=0; const retryAt='2026-10-07T00:00:00.000Z';
 t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:{code:'PROVISIONING_RATE_LIMIT',message:'Wait',retryAfterSeconds:600,retryAt}},{status:429,headers:{'Retry-After':'600'}});});
 await assert.rejects(VibeCodeStorage.create(),error=>error.status===429&&error.code==='PROVISIONING_RATE_LIMIT'&&error.retryAfterSeconds===600&&error.retryAt===retryAt);
 assert.equal(calls,1);
});
