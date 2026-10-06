// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { root } from './models.mjs';
const files = ['README.md', 'NOTICE.md', 'SOURCE.md', 'PRIVACY.md', 'SECURITY.md', 'CONTRIBUTING.md',
  'CHANGELOG.md', 'models/README.md', 'tests/fixtures/README.md'];
for (const name of await readdir(resolve(root, 'docs'))) if (name.endsWith('.md')) files.push(`docs/${name}`);
let checked = 0;
for (const file of files) {
  const body = await readFile(resolve(root, file), 'utf8');
  const targets = [...body.matchAll(/\[[^\]]*\]\(([^\s)]+)\)|(?:src|href)="([^"]+)"/g)]
    .map(match => match[1] ?? match[2]);
  for (const target of targets) {
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const path = resolve(root, dirname(file), decodeURIComponent(target.split('#')[0]));
    try { await stat(path); } catch { throw new Error(`Broken documentation link in ${file}: ${target}`); }
    checked++;
  }
}
console.log(`PASS: ${checked} local documentation links and images.`);
