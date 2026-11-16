// SPDX-License-Identifier: AGPL-3.0-only
import {parseGif} from './gif';
import {parseWebP} from './webp';
type Decoder={tracks:{ready:Promise<void>};decode(options:{frameIndex:number;completeFramesOnly:boolean}):Promise<{image:VideoFrame}>;close():void};
let decoder:Decoder|undefined,port:MessagePort|undefined,busy=false;
window.addEventListener('message',event=>{
  if(event.source!==parent||event.data?.type!=='gif-connect'||!event.ports[0]||port)return;
  port=event.ports[0];port.onmessage=async incoming=>{
    const m=incoming.data;if(!m||!Number.isInteger(m.id))return;
    if(busy){port?.postMessage({id:m.id,error:'GIF decoder busy'});return;}busy=true;
    try{
      if(m.type==='init'){
        if(!(m.data instanceof ArrayBuffer)||m.data.byteLength>20_000_000)throw Error('Invalid GIF payload');
        const mime=m.mime??'image/gif';
        if(mime==='image/gif')parseGif(new Uint8Array(m.data));else if(mime==='image/webp')parseWebP(new Uint8Array(m.data));else throw Error('Unsupported animation type');
        decoder?.close();
        const Native=(globalThis as unknown as {ImageDecoder?:new(options:{data:ArrayBuffer;type:string;preferAnimation:boolean})=>Decoder}).ImageDecoder;
        if(!Native)throw Error('GIF decoder is unavailable');decoder=new Native({data:m.data,type:mime,preferAnimation:true});await decoder.tracks.ready;port?.postMessage({id:m.id,ready:true});
      }else if(m.type==='frame'){
        if(!decoder||!Number.isInteger(m.index)||m.index<0||m.index>=10000)throw Error('Invalid GIF frame');
        const {image}=await decoder.decode({frameIndex:m.index,completeFramesOnly:true});
        try{const bitmap=await createImageBitmap(image);port?.postMessage({id:m.id,bitmap},[bitmap]);}finally{image.close();}
      }else throw Error('Unknown GIF decoder request');
    }catch(error){port?.postMessage({id:m.id,error:String(error)});}finally{busy=false;}
  };port.start();port.postMessage({connected:true});
});
window.addEventListener('pagehide',()=>decoder?.close());
