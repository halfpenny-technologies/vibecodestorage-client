#!/usr/bin/env node
import { readFile, mkdir, open, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { VibeCodeStorage, validateEndpoint } from './sdk.js';

const { version: packageVersion } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const help = `VibeCodeStorage ${packageVersion} — encrypted app storage

  vibecodestorage init [--endpoint URL] [--profile NAME] [--json]
  vibecodestorage info
  vibecodestorage set KEY JSON [--version NUMBER]
  vibecodestorage set KEY --file FILE    (or '-' to read JSON from stdin)
  vibecodestorage get KEY
  vibecodestorage list
  vibecodestorage delete KEY [--version NUMBER]
  vibecodestorage export --out FILE     (plaintext; keep it private)
  vibecodestorage recovery --out FILE   (secret credentials; keep it private)
  vibecodestorage restore --file FILE   (restore credentials on this device)
  vibecodestorage destroy --yes         (delete store and local credentials)

All commands produce JSON. --json is accepted for agent scripts.
Default endpoint: https://api.vibecodestorage.com (free pilot).
For a local API, use init --endpoint http://127.0.0.1:8787.
Credentials are kept outside your project, under ~/.config/vibecodestorage.
Default profile follows your working directory. --profile NAME selects a named profile.
New stores need a successful write within four hours. Billing is disabled.
`;

function emit(value) { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); }
async function writePrivate(path, value) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); }
  finally { await file.close(); }
}
async function stdin() {
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error('Input exceeds 2 MB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    endpoint: { type: 'string' }, profile: { type: 'string' }, json: { type: 'boolean' },
    file: { type: 'string' }, out: { type: 'string' }, version: { type: 'string' },
    yes: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }
  } });
  const [command, key, value] = positionals;
  if (values.help || !command) { process.stdout.write(help); process.exit(0); }
  const commands = ['init', 'info', 'set', 'get', 'list', 'delete', 'export', 'recovery', 'restore', 'destroy'];
  if (!commands.includes(command)) throw new Error('Unknown command. Run vibecodestorage --help');
  const profile = values.profile || 'project-' + createHash('sha256').update(resolve(process.cwd())).digest('hex').slice(0, 24);
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(profile)) throw new Error('Profile must use 1–80 letters, numbers, underscores or hyphens');
  const root = process.env.VCS_CONFIG_HOME || join(homedir(), '.config', 'vibecodestorage');
  const configFile = join(root, `${profile}.json`);
  if (values.endpoint && command !== 'init') throw new Error('--endpoint is only accepted by init; existing credentials are bound to their saved endpoint');
  if (command === 'init' || command === 'restore') {
    await mkdir(root, { recursive: true, mode: 0o700 });
    // Reserve the filename before creating remote storage. Never overwrite a profile.
    const file = await open(configFile, 'wx', 0o600);
    let created;
    try {
      if (command === 'init') {
        const endpoint = validateEndpoint(values.endpoint || process.env.VCS_ENDPOINT || 'https://api.vibecodestorage.com');
        const pendingFile = configFile + '.pending';
        let creationRequest;
        try { creationRequest = JSON.parse(await readFile(pendingFile, 'utf8')); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          creationRequest = VibeCodeStorage.createRequest({ endpoint });
          await writePrivate(pendingFile, creationRequest);
        }
        created = await VibeCodeStorage.create({ endpoint, creationRequest });
      } else {
        if (!values.file) throw new Error('restore requires --file');
        const recovery = JSON.parse(await readFile(resolve(values.file), 'utf8'));
        if (recovery.format !== 'vibecodestorage/recovery-v1') throw new Error('Not a VibeCodeStorage recovery file');
        const store = new VibeCodeStorage(recovery.credentials);
        await store.keys;
        created = { store, metadata: await store.info() };
      }
      await file.writeFile(JSON.stringify(created.store.credentials, null, 2) + '\n');
      if(command === 'init') await unlink(configFile + '.pending').catch(() => {});
      emit({ profile, credentialsFile: configFile, ...created.metadata,
        next: 'Make a successful write within four hours to activate this new store. Use set/get/list. Create a recovery file before moving to another device. Credentials are secret; never bundle them into a public website.' });
    } catch (error) {
      if(command === 'init' && error.code === 'PROVISIONING_EXPIRED') await unlink(configFile + '.pending').catch(() => {});
      // Keep the pending request after other failures so init can safely resume.
      await unlink(configFile).catch(() => {});
      throw error;
    } finally { await file.close(); }
    process.exit(0);
  }
  let credentials;
  try { credentials = JSON.parse(await readFile(configFile, 'utf8')); }
  catch { throw new Error('No readable profile. Run init, restore, or select the right --profile'); }
  const store = new VibeCodeStorage(credentials);
  await store.keys;
  const version = values.version === undefined ? undefined : Number(values.version);
  if (version !== undefined && (!Number.isSafeInteger(version) || version < 0)) throw new Error('Version must be a nonnegative integer');
  if (command === 'info') emit(await store.info());
  else if (command === 'get') emit(await store.getEntry(key));
  else if (command === 'list') emit(await store.list());
  else if (command === 'set') {
    if (values.file && value !== undefined) throw new Error('Use either JSON argument or --file');
    const source = values.file ? (values.file === '-' ? await stdin() : await readFile(resolve(values.file), 'utf8')) : value;
    if (source === undefined) throw new Error('set needs KEY and JSON, or --file');
    emit(await store.set(key, JSON.parse(source), { version }));
  } else if (command === 'delete') emit(await store.delete(key, { version }));
  else if (command === 'export' || command === 'recovery') {
    if (!values.out) throw new Error(`${command} requires --out; an existing file will not be overwritten`);
    const result = command === 'export' ? await store.export() : { format: 'vibecodestorage/recovery-v1', credentials };
    const path = resolve(values.out);
    await writePrivate(path, result);
    emit({ saved: path, sensitive: true, kind: command });
  } else if (command === 'destroy') {
    if (!values.yes) throw new Error('destroy permanently removes the store; add --yes to confirm');
    try { await store.destroy(); } catch(error) { if(error.code !== "PROVISIONING_EXPIRED") throw error; }
    await unlink(configFile);
    emit({ deleted: true });
  }
} catch (error) {
  process.stderr.write(JSON.stringify({ error: { code: error.code || 'CLI_ERROR', message: error.message, ...(error.status ? { status: error.status } : {}) } }) + '\n');
  process.exitCode = 1;
}
