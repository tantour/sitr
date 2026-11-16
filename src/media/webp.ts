// SPDX-License-Identifier: AGPL-3.0-only
import type {GifInfo} from './gif';
/** Read RIFF chunk boundaries; frame-like bytes inside compressed data are not frames. */
export function parseWebP(bytes:Uint8Array):GifInfo{
  const ascii=(p:number)=>String.fromCharCode(...bytes.subarray(p,p+4));
  if(bytes.length<20||ascii(0)!=='RIFF'||ascii(8)!=='WEBP')throw Error('Invalid WebP header');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),end=view.getUint32(4,true)+8;
  const uint24=(p:number)=>bytes[p]|bytes[p+1]<<8|bytes[p+2]<<16;
  if(end>bytes.length||end<20)throw Error('Truncated WebP');
  let width=0,height=0,animated=false,animationControl=false,repeats=0,image=false;
  const durations:number[]=[];
  for(let p=12;p<end;){
    if(p+8>end)throw Error('Truncated WebP chunk');
    const kind=ascii(p),length=view.getUint32(p+4,true),data=p+8,next=data+length+(length&1);
    if(next>end)throw Error('Truncated WebP chunk');
    if(kind==='VP8X'){
      if(length!==10)throw Error('Invalid WebP canvas');
      animated=!!(bytes[data]&2);width=uint24(data+4)+1;height=uint24(data+7)+1;
    }else if(kind==='ANIM'){
      if(length!==6)throw Error('Invalid WebP animation');
      animationControl=true;const loops=view.getUint16(data+4,true);repeats=loops===0?Infinity:loops-1;
    }else if(kind==='ANMF'){
      if(length<16||!animated)throw Error('Invalid WebP frame');
      const x=uint24(data)*2,y=uint24(data+3)*2,w=uint24(data+6)+1,h=uint24(data+9)+1;
      if(x+w>width||y+h>height)throw Error('WebP frame exceeds canvas');
      const duration=uint24(data+12);durations.push(duration<10?100:duration);
      if(durations.length>10000)throw Error('WebP frame limit exceeded');
    }else if(kind==='VP8 '||kind==='VP8L'){
      image=true;
      if(!width){
        if(kind==='VP8L'){
          if(length<5||bytes[data]!==47)throw Error('Invalid lossless WebP');
          const bits=view.getUint32(data+1,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;
        }else{
          if(length<10||bytes[data+3]!==157||bytes[data+4]!==1||bytes[data+5]!==42)throw Error('Invalid lossy WebP');
          width=view.getUint16(data+6,true)&16383;height=view.getUint16(data+8,true)&16383;
        }
      }
    }
    p=next;
  }
  if(!width||!height||width>8192||height>8192||width*height>16777216)throw Error('WebP dimensions exceed decoder limits');
  if(animated?(!animationControl||!durations.length):!image)throw Error('WebP image data missing');
  return{width,height,durations:animated?durations:[100],repeats,type:'image/webp'};
}
const cache=new WeakMap<Blob,Promise<GifInfo|undefined>>();
export function inspectWebP(blob:Blob):Promise<GifInfo|undefined>{
  let pending=cache.get(blob);
  if(!pending){pending=(async()=>{
    const header=new Uint8Array(await blob.slice(0,12).arrayBuffer());
    if(String.fromCharCode(...header.subarray(0,4))==='RIFF'&&String.fromCharCode(...header.subarray(8,12))==='WEBP')return parseWebP(new Uint8Array(await blob.arrayBuffer()));
    if(blob.type.split(';')[0]==='image/webp')throw Error('Invalid WebP');
  })();cache.set(blob,pending);}
  return pending;
}
