import { expect, test } from 'vitest';
import { applyFabric } from '../src/rendering/fabric';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/config/settings';
import { imageAnalysisKey } from '../src/config/imageAnalysis';
test('fabric preserves alpha and never depends on original RGB', () => {
 const a = new Uint8ClampedArray(4096), b = new Uint8ClampedArray(4096);
 for (let p=0;p<a.length;p+=4) { a[p]=255; b[p+1]=255; a[p+3]=b[p+3]=(p/4)%256; }
 const alpha = a.filter((_,i)=>i%4===3);
 applyFabric(a,32,32); applyFabric(b,32,32);
 expect(a).toEqual(b); expect(a.filter((_,i)=>i%4===3)).toEqual(alpha);
 applyFabric(new Uint8ClampedArray(64*64*4),64,64); applyFabric(b,32,32); expect(a).toEqual(b);
});
test('fabric defaults off and switching refreshes cached clothing sources', () => {
 expect(normalizeSettings({}).fabricFill).toBe(false);
 expect(normalizeSettings({fabricFill:'true'}).fabricFill).toBe(false);
 expect(normalizeSettings({fabricFill:true}).fabricFill).toBe(true);
 expect(imageAnalysisKey({...DEFAULT_SETTINGS,fabricFill:true})).not.toBe(imageAnalysisKey(DEFAULT_SETTINGS));
});
import { clothingFabric, applyClothing } from '../src/rendering/fabric';
test('extends a white shirt down over a waist without borrowing background or skin', () => {
 const side=40,n=side*side, rgba=new Uint8Array(n*4), categories=new Uint8Array(n), mask=new Float32Array(n).fill(1);
 for(let y=0;y<side;y++) for(let x=0;x<side;x++) {
  const p=y*side+x;
  const c=y<14?4:y<25?2:4; categories[p]=c;
  rgba.set(y<14?[230,231,234,255]:y<25?[200,140,110,255]:[25,80,150,255],p*4);
 }
 const output=clothingFabric(rgba,categories,[{mask}],side)!;
 expect([...output.slice((18*side+20)*4,(18*side+20)*4+3)]).toEqual([230,231,234]);
 const a=new Uint8ClampedArray(n*4); a.fill(255); applyClothing(a,output);
 expect(a[(18*side+20)*4+3]).toBe(255);
});
test('background and another person can never donate garment colors', () => {
 const side=32,n=side*side, rgba=new Uint8Array(n*4).fill(255), categories=new Uint8Array(n), a=new Float32Array(n), b=new Float32Array(n);
 for(let y=0;y<side;y++) for(let x=0;x<side;x++) {const p=y*side+x; if(x<16) {a[p]=1;categories[p]=2;} else {b[p]=1;categories[p]=4;}}
 const output=clothingFabric(rgba,categories,[{mask:a},{mask:b}],side)!;
 expect(output[(16*side+12)*4]).toBeLessThan(90);
 categories.fill(0);
 const background=clothingFabric(rgba,categories,[{mask:a}],side)!;
 expect(background[(16*side+12)*4]).toBeLessThan(90);
});
test('isolated mislabeled clothing pixels do not qualify as donors',()=>{
 const side=32,n=side*side,rgba=new Uint8Array(n*4).fill(255),categories=new Uint8Array(n).fill(2),mask=new Float32Array(n).fill(1);
 categories[16*side+16]=4;
 const output=clothingFabric(rgba,categories,[{mask}],side)!;
 expect(output[(16*side+16)*4]).toBeLessThan(90);
});
import { softenFabricEdges } from '../src/rendering/fabric';
test('edge smoothing only adds a narrow fringe and never exposes covered pixels', () => {
 const side=12,pixels=new Uint8ClampedArray(side*side*4);
 for(let y=4;y<8;y++) for(let x=4;x<8;x++) pixels.set([230,232,235,255],(y*side+x)*4);
 pixels.set([230,232,235,128],(3*side+4)*4);
 const before=pixels.slice(); softenFabricEdges(pixels,side,side);
 for(let p=0;p<side*side;p++) expect(pixels[p*4+3]).toBeGreaterThanOrEqual(before[p*4+3]);
 expect(pixels[(5*side+3)*4+3]).toBeGreaterThan(0);
 expect(pixels[(5*side+3)*4]).toBe(230);
 expect(pixels[(5*side+1)*4+3]).toBe(0);
});
test('long clothing extensions suppress repeated high-contrast source patterns',()=>{
 const side=64,n=side*side,rgba=new Uint8Array(n*4),categories=new Uint8Array(n).fill(2),mask=new Float32Array(n).fill(1);
 for(let y=0;y<side;y++) for(let x=0;x<side;x++) {
  const p=y*side+x; if(y<26) categories[p]=4;
  rgba.set(y<26?[180+(y%4)*15,190+(y%4)*15,200+(y%4)*15,255]:[255,0,0,255],p*4);
 }
 const out=clothingFabric(rgba,categories,[{mask}],side)!;
 const reds=Array.from({length:12},(_,i)=>out[((26+i)*side+32)*4]);
 expect(Math.max(...reds)-Math.min(...reds)).toBeLessThanOrEqual(3);
 for(let y=26;y<38;y++) expect(out[(y*side+32)*4+1]).toBeGreaterThan(out[(y*side+32)*4]);
});
test('low-confidence and distant sleeve edges keep same-person garment color instead of slate islands',()=>{
 const side=80,n=side*side,rgba=new Uint8Array(n*4),categories=new Uint8Array(n).fill(2),mask=new Float32Array(n).fill(.15);
 for(let y=0;y<25;y++)for(let x=25;x<55;x++){
  const p=y*side+x; categories[p]=4;mask[p]=1;rgba.set([238,240,242,255],p*4);
 }
 const out=clothingFabric(rgba,categories,[{mask}],side)!;
 for(const p of [70*side+5,70*side+75,40*side+5,40*side+75]){
  expect(out[p*4]).toBeGreaterThan(230);expect(out[p*4+2]).toBeGreaterThan(230);
 }
});
test('source logos do not get mirrored onto distant arms',()=>{
 const side=80,n=side*side,rgba=new Uint8Array(n*4).fill(255),categories=new Uint8Array(n).fill(2),mask=new Float32Array(n).fill(1);
 for(let y=0;y<30;y++)for(let x=0;x<side;x++){
  const p=y*side+x;categories[p]=4;rgba.set(x>35&&x<40?[20,20,20,255]:[235,237,239,255],p*4);
 }
 const out=clothingFabric(rgba,categories,[{mask}],side)!;
 for(let y=45;y<75;y++)expect(out[(y*side+37)*4]).toBeGreaterThan(225);
});
import {joinClothing,shadeFabricRuns} from '../src/rendering/fabric';
test('cloth lighting continues spatial garment gradients without reading skin or background RGB',()=>{
 const side=64,n=side*side,a=new Uint8Array(n*4),b=new Uint8Array(n*4),categories=new Uint8Array(n).fill(2),mask=new Float32Array(n).fill(1);
 for(let y=0;y<side;y++)for(let x=0;x<side;x++){
  const p=y*side+x;if(y<24){categories[p]=4;const v=210+Math.round(x/side*28);a.set([v,v+1,v+2,255],p*4);b.set([v,v+1,v+2,255],p*4);}else{a.set([250,0,0,255],p*4);b.set([0,250,0,255],p*4);}
 }
 const first=clothingFabric(a,categories,[{mask}],side)!,second=clothingFabric(b,categories,[{mask}],side)!;
 expect(first).toEqual(second);expect(first[(45*side+50)*4]-first[(45*side+10)*4]).toBeGreaterThan(10);
 for(let x=10;x<50;x++)expect(Math.abs(first[(45*side+x+1)*4]-first[(45*side+x)*4])).toBeLessThanOrEqual(3);
});
test('the clothing connection band preserves skin opacity and never blends across faces, hair or background',()=>{
 const side=12,n=side*side,alpha=new Uint8Array(n),categories=new Uint8Array(n).fill(4),mask=new Float32Array(n).fill(1),p=5*side+5;alpha[p]=255;categories[p]=2;categories[p-1]=3;categories[p-side]=1;categories[p+side]=0;
 const joined=joinClothing(alpha,categories,[{mask}],side,3);expect(joined[p]).toBe(255);expect(joined[p+1]).toBeGreaterThan(0);expect(joined[p+1]).toBeLessThan(255);expect(joined[p-1]).toBe(0);expect(joined[p-side]).toBe(0);expect(joined[p+side]).toBe(0);
 for(let i=0;i<n;i++)expect(joined[i]).toBeGreaterThanOrEqual(alpha[i]);
});
test('gentle cloth volume changes RGB without changing any coverage alpha',()=>{
 const width=20,pixels=new Uint8ClampedArray(width*4);for(let x=0;x<width;x++)pixels.set([230,232,234,255],x*4);shadeFabricRuns(pixels,width,1);
 expect(pixels[10*4]).toBeGreaterThan(pixels[0]);for(let x=0;x<width;x++)expect(pixels[x*4+3]).toBe(255);
});

test('skin-colored pixels mislabeled as clothing cannot tint the fabric',()=>{
 const side=40,n=side*side,rgba=new Uint8Array(n*4),categories=new Uint8Array(n).fill(4),mask=new Float32Array(n).fill(1);
 for(let y=0;y<side;y++)for(let x=0;x<side;x++)rgba.set(y<20?[230,232,235,255]:[205,145,115,255],(y*side+x)*4);
 const out=clothingFabric(rgba,categories,[{mask}],side)!;
 for(let y=22;y<38;y++)expect(out[(y*side+20)*4+2]).toBeGreaterThanOrEqual(out[(y*side+20)*4]);
});

test('a shaded blue garment keeps one blue fabric family instead of gray shadow patches',()=>{
 const side=80,n=side*side,rgba=new Uint8Array(n*4),categories=new Uint8Array(n).fill(2),mask=new Float32Array(n).fill(1);
 for(let y=0;y<side;y++)for(let x=0;x<side;x++){
  const p=y*side+x;if(y<30){categories[p]=4;const c=x<52?[93,91,103]:x<65?[108,113,154]:[156,165,205];rgba.set([...c,255],p*4);}else rgba.set([200,140,110,255],p*4);
 }
 const out=clothingFabric(rgba,categories,[{mask}],side)!;
 for(const x of [15,40,65]){const p=(60*side+x)*4;expect(out[p+2]-out[p]).toBeGreaterThan(20);expect(out[p]).toBeGreaterThan(110);}
});
