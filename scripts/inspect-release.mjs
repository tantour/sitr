// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { unzipSync } from 'fflate';
import { root, sha256, installArchive, verifyModels } from './models.mjs';
const directory = resolve(root, '.cache/release-validation');
await mkdir(directory, { recursive: true });
const lines = (await readFile(resolve(root, 'release/SHA256SUMS.txt'), 'utf8')).trim().split('\n');
for (const line of lines) {
  const [hash, name] = line.split(/\s+/);
  const bytes = await readFile(resolve(root, 'release', name));
  assert.equal(sha256(bytes), hash, `Archive checksum mismatch: ${name}`);
  if (name.endsWith('-models.zip')) {
    await installArchive(bytes, resolve(directory, 'installed-models'));
    await verifyModels(resolve(directory, 'installed-models'));
    console.log('PASS: model ZIP installs into an empty directory and all model/source hashes match.');
  } else {
    const files = unzipSync(bytes);
    assert(!Object.keys(files).some(name => /(^|\/)(\.git|\.cache|\.venv|node_modules|\.env)(\/|\.|$)/.test(name)));
    assert(!Object.keys(files).some(name => /lena\.jpg$/.test(name)));
    if (name.endsWith('-chrome.zip')) {
      assert(files['manifest.json'] && files['LICENSE'] && files['NOTICE.md']);
      assert(!Object.keys(files).some(name => /\.(pt|tar|bin|pdmodel|pdiparams)$/.test(name)));
      console.log('PASS: extension ZIP resources and distribution boundaries.');
    } else {
      assert(files['package-lock.json'] && files['src/content/index.ts'] && files['scripts/build.mjs']);
      const source = resolve(directory, 'source');
      await mkdir(source, { recursive: true });
      for (const [entry, content] of Object.entries(files)) {
        const path = resolve(source, entry);
        assert(path.startsWith(source + sep), `Source ZIP path traversal: ${entry}`);
        if (entry.endsWith('/')) { await mkdir(path, { recursive: true }); continue; }
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content);
      }
      console.log(`PASS: complete source ZIP extracted to ${source}`);
    }
  }
}
console.log('PASS: every release SHA-256 checksum verified.');
