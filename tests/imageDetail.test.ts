import {expect,it} from 'vitest';
import {smallImage,nativeFaceWidth,thumbnailNeedsFallback} from '../src/vision/imageDetail';
import {normalizeSettings} from '../src/config/settings';
it('covers a range of tiny native dimensions rather than one exact thumbnail size',()=>{
 for(const [w,h]of [[64,40],[65,50],[96,64],[128,96],[160,100]])expect(smallImage(w,h)).toBe(true);
 expect(smallImage(512,380)).toBe(false);expect(smallImage()).toBe(false);expect(smallImage(1,1)).toBe(false);
 expect(nativeFaceWidth(.1,640,64,40)).toBeCloseTo(6.4);expect(nativeFaceWidth(.1,640,960,640)).toBe(64);
});
it('uses the fallback only for owned people with almost no recognized anatomy',()=>{
 const mask=new Float32Array(100).fill(.9),categories=new Uint8Array(100);
 expect(thumbnailNeedsFallback(categories,mask)).toBe(true);categories.fill(4);expect(thumbnailNeedsFallback(categories,mask)).toBe(false);
 categories.fill(0);categories.fill(2,0,5);expect(thumbnailNeedsFallback(categories,mask)).toBe(false);
 mask.fill(.1);expect(thumbnailNeedsFallback(categories,mask)).toBe(false);
 expect(normalizeSettings({}).thumbnailFallback).toBe(true);expect(normalizeSettings({thumbnailFallback:false}).thumbnailFallback).toBe(false);
});
