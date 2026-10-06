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
The published npm package is version 0.1.2. This repository contains the same
client implementation, now under the MIT licence. The existing npm 0.1.2 archive
predates this licensing change; no replacement npm release has been made yet.

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

This is version 0.1.2, a prototype without an independent security audit.
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
