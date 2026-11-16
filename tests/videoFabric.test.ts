import { expect, it } from 'vitest';
import { VideoGarmentPalette, applyGarmentTone } from '../src/rendering/videoFabric';
import { ByteTracker } from '../src/vision/tracker';
function fixture(){const side=32,n=side*side,mask=new Float32Array(n).fill(1),rgba=new Uint8Array(n*4),categories=new Uint8Array(n).fill(4);for(let p=0;p<n;p++)rgba.set([234,236,238,255],p*4);const track=new ByteTracker('cloth').update([{box:{x:0,y:0,width:1,height:1},score:1,mask,maskWidth:side,maskHeight:side}],0,true)[0];return{side,rgba,categories,track};}
it('video color sampling uses owned clothing, never skin or background',()=>{const f=fixture(),palette=new VideoGarmentPalette();for(let y=20;y<32;y++)for(let x=0;x<32;x++){const p=y*32+x;f.categories[p]=2;f.rgba.set([255,0,0,255],p*4);}expect(palette.update(f.rgba,f.categories,[f.track],32,0).get(f.track.id)).toEqual([234,236,238]);f.categories.fill(0);expect(new VideoGarmentPalette().update(f.rgba,f.categories,[f.track],32,0).size).toBe(0);});
it('palette survives short missing clothing, expires, and cannot move to a new identity',()=>{const f=fixture(),palette=new VideoGarmentPalette();palette.update(f.rgba,f.categories,[f.track],32,0);f.categories.fill(2);expect(palette.update(f.rgba,f.categories,[f.track],32,500).has(f.track.id)).toBe(true);expect(palette.update(f.rgba,f.categories,[f.track],32,1100).size).toBe(0);expect(palette.update(f.rgba,f.categories,[{...f.track,id:'replacement'}],32,1200).size).toBe(0);});
it('ambiguous overlap cannot provide a clothing tone and RGB fill preserves alpha',()=>{const f=fixture();expect(new VideoGarmentPalette().update(f.rgba,f.categories,[f.track,{...f.track,id:'rival'}],32,0).size).toBe(0);const pixels=new Uint8ClampedArray([0,0,0,255,0,0,0,127,0,0,0,0]);applyGarmentTone(pixels,[230,232,234]);expect([...pixels]).toEqual([230,232,234,255,230,232,234,127,230,232,234,0]);});
it('video lighting follows only owned clothing and remains bounded',()=>{
 const f=fixture(),palette=new VideoGarmentPalette();
 for(let y=0;y<32;y++)for(let x=0;x<32;x++){
  const p=y*32+x,v=210+x;f.rgba.set([v,v,v,255],p*4);
  if(y>22){f.categories[p]=2;f.rgba.set([255,0,0,255],p*4);}
 }
 palette.update(f.rgba,f.categories,[f.track],32,0);const light=palette.lighting(f.track.id)!;
 expect(light[1]).toBeGreaterThan(light[0]);for(const value of light)expect(Math.abs(value)).toBeLessThanOrEqual(12);
 const before=[...light];for(let p=0;p<32*32;p++)if(f.categories[p]===2)f.rgba.set([0,255,0,255],p*4);
 palette.update(f.rgba,f.categories,[f.track],32,300);expect(palette.lighting(f.track.id)).toEqual(before);
});
