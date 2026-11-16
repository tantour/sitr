import {describe,it,expect} from 'vitest';
import {parseGif,gifPosition} from '../src/media/gif';
import {sourceIsStatic} from '../src/media/capture';
// Small real GIF, with block-sized image payload; frame marker bytes in data are not frames.
const single=Uint8Array.from([71,73,70,56,57,97,1,0,1,0,128,0,0,0,0,0,255,255,255,33,249,4,0,10,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,59]);
const frame=single.slice(19,-1);
const multi=Uint8Array.from([...single.slice(0,19),33,255,11,...[...'NETSCAPE2.0'].map(c=>c.charCodeAt(0)),3,1,0,0,0,...frame,...frame,59]);
describe('GIF structural inspection and playback clock',()=>{
 it('routes one real frame as an image and multiple real frames as animation',async()=>{
  expect(parseGif(single).durations).toEqual([100]);expect(parseGif(multi).durations).toEqual([100,100]);
  expect(await sourceIsStatic(new Blob([single],{type:'image/gif'}))).toBe(true);expect(await sourceIsStatic(new Blob([multi],{type:'image/gif'}))).toBe(false);
 });
 it('does not mistake compressed payload marker bytes for image descriptors',()=>{
  const fake=single.slice();fake[40]=44;expect(parseGif(fake).durations.length).toBe(1);
 });
 it('rejects truncated or invalid files and excessive canvas sizes',()=>{
  expect(()=>parseGif(single.slice(0,-2))).toThrow();expect(()=>parseGif(new Uint8Array(20))).toThrow();const huge=single.slice();huge[6]=255;huge[7]=255;expect(()=>parseGif(huge)).toThrow('dimensions');
 });
 it('skips to the current frame, repeats correctly, and stops finite animations on the final frame',()=>{
  const info={width:1,height:1,durations:[100,200,100],repeats:Infinity};
  expect(gifPosition(info,150)).toEqual({index:1,nextMs:150,finished:false});expect(gifPosition(info,950).index).toBe(1);
  expect(gifPosition({...info,repeats:0},500)).toEqual({index:2,nextMs:Infinity,finished:true});
  expect(gifPosition({...info,repeats:1},450).index).toBe(0);expect(gifPosition({...info,repeats:1},800).finished).toBe(true);
 });
});
