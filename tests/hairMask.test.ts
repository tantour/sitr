import {expect,it} from 'vitest';
import {hairBlackMask,applyBlackPixels,smoothHairMask} from '../src/rendering/hairMask';
it('expands hair black within existing coverage and respects another person',()=>{
 const side=16,n=side*side,categories=new Uint8Array(n).fill(4),coverage=new Uint8Array(n).fill(255),owner=new Float32Array(n);
 for(let p=0;p<n;p++)if(p%side<8)owner[p]=1;
 categories[5*side+4]=1;categories[5*side+12]=1;coverage[4*side+4]=0;
 const hair=hairBlackMask(categories,coverage,side,2,owner)!;
 expect(hair[5*side+4]).toBe(255);expect(hair[5*side+6]).toBe(255);expect(hair[5*side+12]).toBe(0);expect(hair[4*side+4]).toBe(0);
 expect(hairBlackMask(new Uint8Array(n).fill(4),coverage,side,2)).toBeUndefined();
});
it('changes hair RGB only while keeping fabric and all alpha values',()=>{
 const pixels=new Uint8ClampedArray([230,232,234,255,230,232,234,128,230,232,234,255]);
 applyBlackPixels(pixels,new Uint8Array([255,128,0]));expect([...pixels]).toEqual([0,0,0,255,0,0,0,128,230,232,234,255]);
});
it('hides fine strand gaps with an opaque envelope and feathers only outside the hair',()=>{
 const side=80,alpha=new Uint8Array(side*side);
 for(let y=20;y<55;y++)for(let x=20;x<60;x++)alpha[y*side+x]=255;
 for(let x=24;x<=56;x+=4)for(let y=16;y<20;y++)alpha[y*side+x]=255;
 const before=alpha.slice(),smooth=smoothHairMask(alpha,side,80);
 expect(alpha).toEqual(before);
 for(let p=0;p<alpha.length;p++)expect(smooth[p]).toBeGreaterThanOrEqual(alpha[p]);
 expect(smooth[18*side+26]).toBe(255); // No longer a strand-shaped notch.
 expect(smooth[35*side+19]).toBe(255); // Opaque margin around real hair.
 expect([...smooth].some(value=>value>0&&value<255)).toBe(true);
 expect(smooth[0]).toBe(0);
});
it('preserves coverage at image boundaries and does no work for an empty mask',()=>{
 const side=24,alpha=new Uint8Array(side*side);expect(smoothHairMask(alpha,side)).toBe(alpha);
 alpha[0]=255;alpha[1]=128;const result=smoothHairMask(alpha,side,24);
 expect(result[0]).toBe(255);expect(result[1]).toBe(255);expect(result[side+1]).toBe(255);expect(result[result.length-1]).toBe(0);
});

it('rounds the contour without enlarging the whole head around an isolated wisp',()=>{
 const side=160,alpha=new Uint8Array(side*side);
 for(let y=45;y<110;y++)for(let x=45;x<110;x++)alpha[y*side+x]=255;
 for(let y=33;y<45;y++)alpha[y*side+76]=255;
 const smooth=smoothHairMask(alpha,side,160);
 for(let p=0;p<alpha.length;p++)if(alpha[p])expect(smooth[p]).toBe(255);
 // The wisp stays fully covered; its surroundings receive a narrow feather.
 expect(smooth[40*side+74]).toBeGreaterThan(0);
 expect(smooth[40*side+70]).toBe(0);
 // Several opacity steps outside the opaque contour, rather than a one-pixel fringe.
 const levels=new Set<number>();
 for(let x=0;x<45;x++)if(smooth[80*side+x]>0&&smooth[80*side+x]<255)levels.add(smooth[80*side+x]);
 expect(levels.size).toBeGreaterThanOrEqual(2);
 expect(smooth[80*side+20]).toBe(0);
});

it('does not grow hair smoothing into a segmented face',()=>{
 const side=80,alpha=new Uint8Array(side*side),categories=new Uint8Array(side*side);
 for(let y=15;y<35;y++)for(let x=20;x<60;x++){alpha[y*side+x]=255;categories[y*side+x]=1;}
 for(let y=35;y<60;y++)for(let x=20;x<60;x++)categories[y*side+x]=3;
 const smooth=smoothHairMask(alpha,side,80,categories);
 for(let p=0;p<alpha.length;p++){if(categories[p]===3)expect(smooth[p]).toBe(0);if(alpha[p])expect(smooth[p]).toBe(255);}
});
