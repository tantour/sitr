// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest';
import {parseWebP,inspectWebP} from '../src/media/webp';
import {inspectAnimation} from '../src/media/animatedImage';
import {sourceIsStatic} from '../src/media/capture';
const u24=(value:number)=>[value&255,value>>8&255,value>>16&255];
const chunk=(name:string,data:number[])=>[...[...name].map(c=>c.charCodeAt(0)),data.length&255,data.length>>8&255,0,0,...data,...(data.length%2?[0]:[])];
const fixture=(name:string)=>{
 const animated=name!=='single';
 const parts=[...chunk('VP8X',[animated?2:0,0,0,0,...u24(31),...u24(31)])];
 if(animated){parts.push(...chunk('ANIM',[0,0,0,0,0,0]));for(let i=0;i<(name==='transparent'?2:3);i++)parts.push(...chunk('ANMF',[...u24(0),...u24(0),...u24(31),...u24(31),...u24(200),2,...chunk('VP8L',[47,31,192,7,0])]));}
 else parts.push(...chunk('VP8L',[47,31,192,7,0]));
 const body=[87,69,66,80,...parts],length=body.length;
 return Uint8Array.from([82,73,70,70,length&255,length>>8&255,length>>16&255,length>>24&255,...body]);
};
it('recognizes static WebP without relying on ImageDecoder in the page world',async()=>{
 const bytes=fixture('single'),info=parseWebP(bytes),blob=new Blob([bytes],{type:'image/webp'});
 expect(info.width).toBeGreaterThan(0);expect(info.durations).toEqual([100]);expect(await sourceIsStatic(blob)).toBe(true);
 expect((await inspectAnimation(blob))?.type).toBe('image/webp');
});
it('parses animated and transparent WebP frame boundaries and loops',async()=>{
 const info=parseWebP(fixture('animated'));expect(info.durations).toEqual([200,200,200]);expect(info.repeats).toBe(Infinity);
 expect(parseWebP(fixture('transparent')).durations).toHaveLength(2);
 expect(await sourceIsStatic(new Blob([fixture('animated')],{type:'image/webp'}))).toBe(false);
 expect(await inspectWebP(new Blob(['not webp']))).toBeUndefined();
});
it('rejects truncated RIFF chunks, missing frames and invalid frame bounds',()=>{
 const bytes=fixture('animated');expect(()=>parseWebP(bytes.slice(0,-10))).toThrow('Truncated');
 const broken=bytes.slice(),at=new TextDecoder('latin1').decode(broken).indexOf('ANMF');
 broken[at+8+6]=255;broken[at+8+7]=255;broken[at+8+8]=127;expect(()=>parseWebP(broken)).toThrow('exceeds canvas');
 const chunk=bytes.slice();new DataView(chunk.buffer).setUint32(16,0xfffffff0,true);expect(()=>parseWebP(chunk)).toThrow('Truncated');
});
