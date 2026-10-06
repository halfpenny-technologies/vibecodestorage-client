# VibeCodeStorage client

JavaScript SDK and CLI for encrypted storage. Requires Node.js 24 or newer
and connects to the free pilot API at https://api.vibecodestorage.com by default.
This repository contains the client only. The hosted API implementation remains private.

```sh
npm install vibecodestorage
# Or install the CLI:
npm install --global vibecodestorage
vibecodestorage init --json
vibecodestorage set settings '{"theme":"dark"}'
vibecodestorage get settings
```

For a local server, use `--endpoint http://127.0.0.1:8787`.
Source: [halfpenny-technologies/vibecodestorage-client](https://github.com/halfpenny-technologies/vibecodestorage-client).
The SDK, CLI and encryption helpers are MIT licensed; see LICENSE.

```js
import { VibeCodeStorage } from 'vibecodestorage';
const { store } = await VibeCodeStorage.create();
// Save store.credentials privately on a trusted backend; create a store once.
await store.set('settings', { theme: 'dark' });
console.log(await store.get('settings'));
```

The client generates a random encryption key locally; labels and values are
encrypted with AES-256-GCM before transmission. The API receives a separate
bearer token but never the encryption key. Anyone with both credentials can
read the store. Never embed shared credentials in a public browser bundle.
Browser compatibility has not yet been validated.

`vibecodestorage --help` lists commands. `export --out FILE` writes plaintext;
`recovery --out FILE` writes credentials. Keep these files private and out of Git.
Lost encryption keys cannot be recovered by the service.

This is version 0.1.4, a prototype without an independent security audit.
Pilot hosting is available; billing is disabled. Service limits and expiry depend on the
API deployment; inspect `vibecodestorage info`. Handle conflicts and quotas
explicitly. The client code in this repository is MIT licensed; see LICENSE.
Hosted service use is covered separately by the [pilot terms](https://vibecodestorage.com/terms.html).

## Inspect and test the encryption

- `src/crypto.js`: Web Crypto HKDF-SHA-256 key derivation, HMAC row IDs and AES-256-GCM envelopes.
- `src/sdk.js`: HTTP requests, token handling and client-side encryption/decryption.
- `src/cli.js`: local credential files, recovery and plaintext exports.

Run `npm test` with Node.js 24+. Tests use synthetic data and a mocked transport;
they do not connect to the hosted service or require credentials.

The root secret derives separate encryption and lookup keys. Each encrypted row
uses a random 96-bit nonce and authenticates its store and row identifiers as
additional data. The service still sees record sizes, opaque IDs and access
patterns. A bearer token permits ciphertext access and deletion. These tests
do not constitute an independent audit or establish rollback protection.

[Working example](https://github.com/pauldodd123/vibecodestorage-example) ·
[Getting started](https://vibecodestorage.com/start.html) ·
[Report a security concern privately](https://vibecodestorage.com/contact.html?topic=security)

## Safe provisioning

New stores must receive a successful write within four hours. `metadata.status`
is `provisional` until then and `metadata.activationDeadline` gives the deadline.
Reads and failed writes do not extend it. Existing stores are preserved. The pilot
allows 200 active stores and 20 provisional stores; activation requires available
active capacity. Global creation budgets are 10/hour and 40/day.

`create()` automatically retries one uncertain failure with the same request.
To resume across process restarts, call `VibeCodeStorage.createRequest()`, persist
the returned object privately **before** networking, then pass it as
`VibeCodeStorage.create({ creationRequest })`. It includes the encryption key and
a secret request identifier; never log it or expose it to browsers. Reuse it only
for that creation operation. Do not use a project name or public UUID as the identifier.

The server returns the same store and access token for the same Idempotency-Key
for seven days, without consuming another creation slot. Expired/deleted requests
return 410 during that window. After seven days, do not replay an old request.
The CLI persists a private `.pending` request and reuses it when `init` is retried.
If a provisional profile expires, explicitly remove it with `destroy --yes`
(the expired-store response is handled locally) and initialise a fresh profile.
The original encryption key stays on the client; it is not an idempotency header.
