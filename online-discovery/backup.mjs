import {resolve, dirname} from 'node:path';
import {statSync, existsSync, mkdirSync, chmodSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {DiscoveryStore} from './store.mjs';

/** Snapshot through SQLite; copying a live WAL database file is not a backup. */
export function backupDiscoveryDatabase(source, destination) {
  const input = resolve(source), output = resolve(destination);
  if (input === output || !statSync(input).isFile()) throw new Error('Choose an existing database and a distinct new backup file.');
  if (existsSync(output)) throw new Error('The backup destination already exists.');
  mkdirSync(dirname(output), {recursive: true, mode: 0o700});
  const store = new DiscoveryStore({path: input});
  try {
    if (!store.health()) throw new Error('Database integrity check failed.');
    store.backup(output); chmodSync(output, 0o600);
    const restored = new DiscoveryStore({path: output});
    try {if (!restored.health()) throw new Error('Backup integrity check failed.');} finally {restored.close();}
    return output;
  } finally {store.close();}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) {console.error('Usage: node online-discovery/backup.mjs SOURCE.sqlite NEW-BACKUP.sqlite'); process.exitCode = 2;}
  else {
    try {console.log('Created verified private SQLite snapshot: ' + backupDiscoveryDatabase(process.argv[2], process.argv[3]));}
    catch {console.error('Discovery backup failed. Check source integrity, schema, permissions and a new destination.'); process.exitCode = 1;}
  }
}
