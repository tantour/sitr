// SPDX-License-Identifier: AGPL-3.0-only
export interface GifInfo { width: number; height: number; durations: number[]; repeats: number; type?:'image/gif'|'image/webp' }
/** Parse GIF structure, never search compressed payload bytes for frame markers. */
export function parseGif(bytes: Uint8Array): GifInfo {
  if (bytes.length < 14 || !['GIF87a','GIF89a'].includes(String.fromCharCode(...bytes.subarray(0,6)))) throw Error('Invalid GIF header');
  const word=(p:number)=>bytes[p]|bytes[p+1]<<8;
  const width=word(6),height=word(8);
  if (!width||!height||width>8192||height>8192||width*height>16_777_216) throw Error('GIF dimensions exceed decoder limits');
  let p=13+(bytes[10]&128?3*(1<<((bytes[10]&7)+1)):0),duration=100,repeats=0;
  const durations:number[]=[];
  const requireBytes=(n:number)=>{if(p+n>bytes.length)throw Error('Truncated GIF');};
  const blocks=()=>{while(true){requireBytes(1);const n=bytes[p++];if(!n)return;requireBytes(n);p+=n;}};
  while(p<bytes.length){
    const marker=bytes[p++];
    if(marker===0x3b){if(!durations.length)throw Error('GIF contains no frames');return{width,height,durations,repeats};}
    if(marker===0)continue;
    if(marker===0x21){requireBytes(1);const label=bytes[p++];
      if(label===0xf9){requireBytes(6);if(bytes[p]!==4||bytes[p+5]!==0)throw Error('Invalid GIF control block');const delay=word(p+2);duration=delay<2?100:delay*10;p+=6;}
      else if(label===0xff){requireBytes(1);const n=bytes[p++];requireBytes(n);const app=String.fromCharCode(...bytes.subarray(p,p+n));p+=n;
        if((app==='NETSCAPE2.0'||app==='ANIMEXTS1.0')&&p+4<=bytes.length&&bytes[p]===3&&bytes[p+1]===1){const loops=word(p+2);repeats=loops===0?Infinity:loops;}blocks();}
      else blocks();
    }else if(marker===0x2c){requireBytes(9);const packed=bytes[p+8];p+=9;if(packed&128)p+=3*(1<<((packed&7)+1));requireBytes(1);p++;blocks();durations.push(duration);duration=100;if(durations.length>10000)throw Error('GIF frame limit exceeded');}
    else throw Error('Invalid GIF block');
  }
  throw Error('GIF trailer missing');
}
const inspected=new WeakMap<Blob,Promise<GifInfo|undefined>>();
export function inspectGif(blob:Blob):Promise<GifInfo|undefined>{
  let value=inspected.get(blob);if(!value){value=(async()=>{const header=new Uint8Array(await blob.slice(0,6).arrayBuffer());if(String.fromCharCode(...header).startsWith('GIF8'))return parseGif(new Uint8Array(await blob.arrayBuffer()));if(blob.type.split(';')[0]==='image/gif')throw Error('Invalid GIF');return undefined;})();inspected.set(blob,value);}return value;
}
export class AnimatedGifSource extends Error { constructor(readonly blob:Blob,readonly info:GifInfo){super('Animated GIF');} }
export function gifPosition(info:GifInfo,elapsed:number):{index:number;nextMs:number;finished:boolean}{
  const total=info.durations.reduce((sum,n)=>sum+n,0),limit=total*(info.repeats+1);
  if(elapsed>=limit)return{index:info.durations.length-1,nextMs:Infinity,finished:true};
  let t=Math.max(0,elapsed)%total;
  for(let index=0;index<info.durations.length;index++){if(t<info.durations[index])return{index,nextMs:info.durations[index]-t,finished:false};t-=info.durations[index];}
  return{index:0,nextMs:info.durations[0],finished:false};
}
