// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { spawnSync } from 'node:child_process';
import { root } from './models.mjs';
// Run serially: concurrent GPU startup distorts latency and can trigger timeouts.
const checks = ['popup-ux-check', 'smoke', 'cross-origin-probe', 'responsive-image-probe',
  'visibility-recovery-probe', 'overlay-stacking-probe', 'background-image-probe',
  'duplicate-image-probe', 'overlay-reuse-probe', 'skin-threshold-render-probe',
  'video-compatibility-probe', 'face-probe', 'gender-probe'];
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(SMOKE_|FACE_PROBE_)/.test(key)));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--from' || !checks.includes(args[1])))
  throw new Error('Usage: node scripts/browser-checks.mjs [--from CHECK_NAME]');
const selected = args.length ? checks.slice(checks.indexOf(args[1])) : checks;
for (const check of selected) {
  console.log(`\nBrowser check: ${check}`);
  const result = spawnSync(process.execPath, [`scripts/${check}.mjs`], { cwd: root, env, stdio: 'inherit' });
  if (result.error || result.status !== 0) { console.error(result.error ?? `Failed: ${check}`); process.exit(result.status || 1); }
}
console.log(`PASS: all ${selected.length} selected browser checks.`);
