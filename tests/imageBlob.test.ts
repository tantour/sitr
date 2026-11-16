import {expect,it} from 'vitest';
import {verifiedImageBlob} from '../src/media/imageBlob';
it('recognizes CDN image bytes when content type is generic or incorrect',async()=>{
 const jpeg=new Blob([new Uint8Array([255,216,255,224,0,0])],{type:'application/octet-stream'});
 expect((await verifiedImageBlob(jpeg)).type).toBe('image/jpeg');
 const webp=new Blob(['RIFF1234WEBPVP8 '],{type:'binary/octet-stream'});expect((await verifiedImageBlob(webp)).type).toBe('image/webp');
 expect((await verifiedImageBlob(new Blob(['GIF89a0000000']))).type).toBe('image/gif');
 const correct=jpeg.slice(0,jpeg.size,'image/jpeg');expect(await verifiedImageBlob(correct)).toBe(correct);
});
it('does not trust an image MIME label on HTML or an error response',async()=>{
 await expect(verifiedImageBlob(new Blob(['<!doctype html><title>403</title>'],{type:'image/jpeg'}))).rejects.toThrow('Unsupported image response');
 await expect(verifiedImageBlob(new Blob(['not an image']))).rejects.toThrow();
});
