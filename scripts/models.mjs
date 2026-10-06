// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function manifest() {
  const data = JSON.parse(await readFile(resolve(root, 'models/artifacts.json'), 'utf8'));
  for (const entry of [...data.artifacts, data.sourceWeights, data.detectionWeights, data.referenceExport, ...data.sourceArtifacts]) {
    if (!/^[a-f0-9]{64}$/.test(entry.sha256) || !/^[a-zA-Z0-9_.-]+$/.test(entry.name))
      throw new Error(`Invalid model manifest entry: ${entry.name}`);
  }
  return data;
}
export async function verifyModels(directory = resolve(root, 'models')) {
  for (const artifact of (await manifest()).artifacts) {
    let bytes;
    try { bytes = await readFile(resolve(directory, artifact.name)); }
    catch { throw new Error(`Missing ${artifact.name}. Install the release model bundle: npm run models -- --archive path/to/sitr-models.zip (see models/README.md).`); }
    if (sha256(bytes) !== artifact.sha256) throw new Error(`Model SHA-256 mismatch: ${artifact.name}`);
  }
}
export function validatedArchive(bytes, artifacts) {
  if (bytes.length > 250_000_000) throw new Error('Model archive exceeds 250 MB');
  const names = new Set(artifacts.map(artifact => artifact.archivePath ?? `models/${artifact.name}`));
  const files = unzipSync(bytes, { filter: entry => names.has(entry.name) && entry.originalSize <= 30_000_000 });
  // Validate the complete bundle before replacing any installed model.
  for (const artifact of artifacts) {
    const value = files[artifact.archivePath ?? `models/${artifact.name}`];
    if (!value || sha256(value) !== artifact.sha256) throw new Error(`Archive is missing or has an invalid ${artifact.name}`);
  }
  return files;
}
export async function installArchive(bytes, directory = resolve(root, 'models')) {
  const data = await manifest();
  const artifacts = [...data.artifacts,
    ...[data.sourceWeights, data.detectionWeights].map(input => ({ ...input, archivePath: `model-sources/${input.name}` })),
    ...data.sourceArtifacts.map(input => ({ ...input, archivePath: `model-sources/${input.name}`, subdirectory: 'sources' }))];
  const files = validatedArchive(bytes, artifacts);
  await mkdir(directory, { recursive: true });
  for (const artifact of artifacts) {
    const target = resolve(directory, artifact.subdirectory ?? '', artifact.name);
    await mkdir(resolve(directory, artifact.subdirectory ?? ''), { recursive: true });
    const staged = `${target}.download`;
    try { await writeFile(staged, files[artifact.archivePath ?? `models/${artifact.name}`]); await rename(staged, target); }
    finally { await rm(staged, { force: true }); }
  }
}
async function download(url) {
  if (new URL(url).protocol !== 'https:') throw new Error('Downloads require HTTPS');
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  if (Number(response.headers.get('content-length')) > 250_000_000) throw new Error('Download exceeds 250 MB');
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 250_000_000) throw new Error('Download exceeds 250 MB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === '--verify') {
    if (args.length > 1) throw new Error('Unexpected arguments');
    await verifyModels(); console.log('All 13 model hashes verified.'); return;
  }
  if (args[0] === '--archive' && args.length === 2) {
    await installArchive(await readFile(resolve(args[1])));
    console.log('Installed and verified all 13 models.'); return;
  }
  if (args[0] === '--url' && args[2] === '--sha256' && args.length === 4) {
    if (!/^[a-f0-9]{64}$/i.test(args[3])) throw new Error('Expected a SHA-256 hex digest');
    const bytes = await download(args[1]);
    if (sha256(bytes) !== args[3].toLowerCase()) throw new Error('Model archive SHA-256 mismatch');
    await installArchive(bytes); console.log('Installed and verified all 13 models.'); return;
  }
  if (args[0] === '--sources' && args.length === 1) {
    const data = await manifest();
    const direct = data.artifacts.filter(artifact => /^https:/.test(artifact.source))
      .map(artifact => ({ name: artifact.name, sha256: artifact.sha256, url: artifact.source }));
    const sources = [data.sourceWeights, data.detectionWeights, data.referenceExport, ...data.sourceArtifacts];
    for (const entry of [...direct, ...sources]) {
      const folder = direct.includes(entry) || sources.indexOf(entry) < 3 ? 'models' : 'models/sources';
      const target = resolve(root, folder, entry.name);
      try { if (sha256(await readFile(target)) === entry.sha256) { console.log(`Verified ${entry.name}`); continue; } } catch {}
      const bytes = await download(entry.url);
      if (sha256(bytes) !== entry.sha256) throw new Error(`Source SHA-256 mismatch: ${entry.name}`);
      await mkdir(resolve(root, folder), { recursive: true });
      await writeFile(`${target}.download`, bytes);
      await rename(`${target}.download`, target);
      console.log(`Downloaded and verified ${entry.name}`);
    }
    console.log('Source inputs verified. Next: export the ONNX graphs (models/README.md).'); return;
  }
  throw new Error('Usage: npm run models -- [--verify | --archive FILE | --url HTTPS_URL --sha256 HASH | --sources]');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
