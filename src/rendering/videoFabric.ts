// SPDX-License-Identifier: AGPL-3.0-only
import type { Track } from '../state/contracts';
export type GarmentTone = [number, number, number];

/** Video uses compact, temporally stable garment tones, not an RGBA image per frame.
 * Only eroded, unambiguously owned clothing can supply color. No extra model.
 */
export class VideoGarmentPalette {
  private colors = new Map<string, { rgb: GarmentTone; light:[number,number,number,number]; sampledAt: number; seenAt: number }>();
  lighting(id:string):[number,number,number,number]|undefined{return this.colors.get(id)?.light;}
  update(rgba: Uint8Array, categories: Uint8Array, tracks: Track[], side: number, now: number): Map<string, GarmentTone> {
    const active = new Set(tracks.map(track => track.id));
    for (const id of this.colors.keys()) if (!active.has(id)) this.colors.delete(id);
    const valid = rgba.length === side * side * 4 && categories.length === side * side;
    const result = new Map<string, GarmentTone>();
    for (const track of tracks) {
      let prior = this.colors.get(track.id);
      if (valid && (!prior || now - prior.sampledAt >= 250)) {
        const bins = new Float64Array(256), sides=new Float64Array(64*8);
        const step = Math.max(2, Math.floor(side / 32));
        const x0 = Math.max(2, Math.floor(track.box.x * side)), x1 = Math.min(side - 2, Math.ceil((track.box.x + track.box.width) * side));
        const y0 = Math.max(2, Math.floor(track.box.y * side)), y1 = Math.min(side - 2, Math.ceil((track.box.y + track.box.height * .7) * side));
        for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
          const p = y * side + x;
          if (categories[p] !== 4 || track.mask[p] < .8 || tracks.some(other => other !== track && other.mask[p] >= track.mask[p] - .15)) continue;
          let safe = true;
          for (let dy = -2; dy <= 2 && safe; dy++) for (let dx = -2; dx <= 2; dx++) {
            const q = p + dy * side + dx;
            if (categories[q] !== 4 || track.mask[q] < .8 || tracks.some(other => other !== track && other.mask[q] >= track.mask[q] - .15)) { safe = false; break; }
          }
          if (!safe) continue;
          const i = p * 4, bin = ((rgba[i] >> 6) * 16 + (rgba[i + 1] >> 6) * 4 + (rgba[i + 2] >> 6)) * 4;
          bins[bin]++; bins[bin + 1] += rgba[i]; bins[bin + 2] += rgba[i + 1]; bins[bin + 3] += rgba[i + 2];
          const bucket=bin*2,luminance=(rgba[i]+rgba[i+1]+rgba[i+2])/3;
          const horizontal=x/side<track.box.x+track.box.width/2?0:2,vertical=y/side<track.box.y+track.box.height*.35?4:6;
          sides[bucket+horizontal]+=luminance;sides[bucket+horizontal+1]++;sides[bucket+vertical]+=luminance;sides[bucket+vertical+1]++;
        }
        let best = 0;
        for (let b = 4; b < bins.length; b += 4) if (bins[b] > bins[best]) best = b;
        if (bins[best] >= 2) {
          const rgb: GarmentTone = [bins[best + 1] / bins[best], bins[best + 2] / bins[best], bins[best + 3] / bins[best]];
          const center=(rgb[0]+rgb[1]+rgb[2])/3,light:[number,number,number,number]=[0,0,0,0];
          for(let c=0;c<4;c++){const j=best*2+c*2;light[c]=sides[j+1]?Math.max(-12,Math.min(12,(sides[j]/sides[j+1]-center)*1.5)):0;}
          if (prior) {for (let c = 0; c < 3; c++) rgb[c] = prior.rgb[c] * .65 + rgb[c] * .35;for(let c=0;c<4;c++)light[c]=prior.light[c]*.65+light[c]*.35;}
          prior = { rgb, light, sampledAt: now, seenAt: now }; this.colors.set(track.id, prior);
        } else if (prior) prior.sampledAt = now;
      }
      if (prior && now - prior.seenAt <= 1000) result.set(track.id, prior.rgb);
    }
    return result;
  }
}
export function applyGarmentTone(pixels: Uint8ClampedArray, color: GarmentTone): void {
  for (let p = 0; p < pixels.length; p += 4) { pixels[p] = color[0]; pixels[p + 1] = color[1]; pixels[p + 2] = color[2]; }
}
