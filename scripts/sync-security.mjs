import {mkdir, copyFile} from 'node:fs/promises';
await mkdir('extension/security', {recursive: true});
await copyFile('packages/security/catalog.mjs', 'extension/security/catalog.mjs');
