// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
/** Split CSS layers without splitting commas inside URLs, gradients or strings. */
export function backgroundLayers(value: string): string[] {
  const layers: string[] = [];
  let start = 0, depth = 0, quote = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '\\') { i++; continue; }
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { layers.push(value.slice(start, i).trim()); start = i + 1; }
  }
  layers.push(value.slice(start).trim());
  return layers;
}

export function backgroundUrl(layer: string): string | undefined {
  const match = /^url\(\s*([\s\S]*?)\s*\)$/i.exec(layer);
  if (!match) return;
  let value = match[1];
  if (value[0] === '"' || value[0] === "'") value = value.slice(1, -1);
  return value.replace(/\\([0-9a-f]{1,6}\s?|[\s\S])/gi, (_all, escape: string) => {
    if (/^[0-9a-f]/i.test(escape)) return String.fromCodePoint(Number.parseInt(escape.trim(), 16) || 0xfffd);
    return escape === '\n' ? '' : escape;
  });
}
