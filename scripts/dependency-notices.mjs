// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root } from './models.mjs';

export async function dependencyNotices() {
  const packages = ['@mediapipe/tasks-vision', 'onnxruntime-web', 'onnxruntime-common', 'flatbuffers',
    'long', 'platform', 'protobufjs', 'fflate'];
  for (const name of await readdir(resolve(root, 'node_modules/@protobufjs'))) packages.push(`@protobufjs/${name}`);
  const fallback = { '@mediapipe/tasks-vision': 'Apache-2.0.txt', 'onnxruntime-web': 'ONNX-Runtime-MIT.txt',
    'onnxruntime-common': 'ONNX-Runtime-MIT.txt' };
  let output = 'Sitr dependency licenses\n\nfflate is used by source/release tooling only.\nOther entries are runtime dependencies or their dependency trees; a bundler may remove unused code.\n\n';
  for (const name of packages) {
    const directory = resolve(root, 'node_modules', name);
    const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
    const file = (await readdir(directory)).find(file => /^licen[cs]e(?:\.|$)/i.test(file));
    if (!file && !fallback[name]) throw new Error(`Missing license text for ${name}`);
    const body = await readFile(file ? resolve(directory, file) : resolve(root, 'LICENSES', fallback[name]), 'utf8');
    output += `${'='.repeat(72)}\n${name} ${pkg.version} (${pkg.license})\n${'='.repeat(72)}\n${body}\n\n`;
  }
  await writeFile(resolve(root, 'LICENSES/DEPENDENCIES.txt'), output);
}
