// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
// Maintainer tool: retain upstream copyright and license texts verbatim.
import { mkdir, writeFile } from 'node:fs/promises';
const licenses = {
  'AGPL-3.0.txt': 'https://raw.githubusercontent.com/ultralytics/ultralytics/v8.4.38/LICENSE',
  'Apache-2.0.txt': 'https://raw.githubusercontent.com/google-ai-edge/mediapipe/v0.10.26/LICENSE',
  'ONNX-Runtime-MIT.txt': 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.22.0/LICENSE',
  'ONNX-Runtime-ThirdPartyNotices.txt': 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.22.0/ThirdPartyNotices.txt',
  'YuNet-MIT.txt': 'https://raw.githubusercontent.com/opencv/opencv_zoo/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet/LICENSE',
  'FastFace-Apache-2.0.txt': 'https://raw.githubusercontent.com/iFurySt/fastface/main/LICENSE',
  'Open-Model-Zoo-Apache-2.0.txt': 'https://raw.githubusercontent.com/openvinotoolkit/open_model_zoo/2023.0.0/LICENSE',
  'PaddleClas-Apache-2.0.txt': 'https://raw.githubusercontent.com/PaddlePaddle/PaddleClas/release/2.6/LICENSE',
  'CC-BY-2.0.html': 'https://creativecommons.org/licenses/by/2.0/legalcode',
};
await mkdir('LICENSES', { recursive: true });
for (const [name, url] of Object.entries(licenses)) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const body = await response.text();
  if (body.length < 500 || (!name.endsWith('.html') && /^\s*<!doctype html/i.test(body))) throw new Error(`Invalid license: ${name}`);
  await writeFile(`LICENSES/${name}`, body);
  if (name === 'AGPL-3.0.txt') await writeFile('LICENSE', body);
  console.log(`Saved ${name}`);
}
