// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { zipSync } from 'fflate';
import { root, manifest, sha256 } from './models.mjs';
import { verifyRelease } from './verify-release.mjs';

await verifyRelease();
const version = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
const output = resolve(root, 'release');
await mkdir(output, { recursive: true });
let checksums = '';
async function archive(name, files) {
  const entries = {};
  for (const [name, path] of files) entries[name] = [new Uint8Array(await readFile(path)), { mtime: new Date('2026-01-01T00:00:00Z') }];
  const bytes = zipSync(entries, { level: 6 });
  await writeFile(resolve(output, name), bytes);
  checksums += `${sha256(bytes)}  ${name}\n`;
  console.log(`${name}: ${(bytes.length / 1e6).toFixed(1)} MB`);
}
async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path));
    else if (entry.isFile()) files.push([relative(resolve(root, 'dist'), path).replaceAll('\\', '/'), path]);
  }
  return files;
}
const prefix = `sitr-${version}`;
await archive(`${prefix}-chrome.zip`, await filesIn(resolve(root, 'dist')));
const artifacts = await manifest();
const models = artifacts.artifacts.map(artifact => [`models/${artifact.name}`, resolve(root, 'models', artifact.name)]);
// Retain original YOLO weights as well as derived graphs for modification.
for (const input of [artifacts.sourceWeights, artifacts.detectionWeights]) {
  const path = resolve(root, 'models', input.name);
  if (sha256(await readFile(path)) !== input.sha256) throw new Error(`Source weight SHA-256 mismatch: ${input.name}`);
  models.push([`model-sources/${input.name}`, path]);
}
for (const input of artifacts.sourceArtifacts) {
  const path = resolve(root, 'models/sources', input.name);
  if (sha256(await readFile(path)) !== input.sha256) throw new Error(`Model input SHA-256 mismatch: ${input.name}`);
  models.push([`model-sources/${input.name}`, path]);
}
models.push(['models/artifacts.json', resolve(root, 'models/artifacts.json')], ['models/README.md', resolve(root, 'models/README.md')],
  ['LICENSE', resolve(root, 'LICENSE')], ['NOTICE.md', resolve(root, 'NOTICE.md')], ['SOURCE.md', resolve(root, 'SOURCE.md')]);
for (const name of await readdir(resolve(root, 'LICENSES'))) models.push([`LICENSES/${name}`, resolve(root, 'LICENSES', name)]);
await archive(`${prefix}-models.zip`, models);

// Include both existing tracked work and new release files without changing Git.
// The exact source snapshot therefore matches the working tree used by build.
const candidates = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
const source = [];
for (const name of new Set(candidates)) {
  if (/^(\.git\/|\.cache\/|\.venv\/|node_modules\/|dist\/|release\/|\.impeccable\/)/.test(name) ||
      /^experiments\/ssd-prototype\/Ultralytics\//.test(name) ||
      /(^|\/)\.env(?:\.|$)/.test(name) || /\.(log|onnx|tflite|pt|bin|tar|pdmodel|pdiparams)$/i.test(name)) continue;
  let info;
  try { info = await stat(resolve(root, name)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  if (!info.isFile()) continue;
  if (info.size > 30_000_000) throw new Error(`Unexpected large source file: ${name}`);
  source.push([name, resolve(root, name)]);
}
await archive(`${prefix}-source.zip`, source);
await writeFile(resolve(output, 'SHA256SUMS.txt'), checksums);
console.log('Publish all three ZIP files and SHA256SUMS.txt together. See docs/RELEASING.md.');
