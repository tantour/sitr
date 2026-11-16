// SPDX-License-Identifier: AGPL-3.0-only
/// <reference lib="webworker" />
import {reconstructPictures,type PdfRect} from './regions';
self.onmessage=(event:MessageEvent<{id:number;rgba:ArrayBuffer;width:number;height:number;embedded:PdfRect[];pageWidth:number;pageHeight:number;scanned:boolean}>)=>{
 const {id,rgba,width,height,embedded,pageWidth,pageHeight,scanned}=event.data;
 try{if(width*height>2_000_000||rgba.byteLength!==width*height*4)throw Error('Invalid layout sample');const start=performance.now();const regions=reconstructPictures({data:new Uint8ClampedArray(rgba),width,height},embedded,pageWidth,pageHeight,scanned);postMessage({id,regions,ms:performance.now()-start});}
 catch(error){postMessage({id,error:String(error)});}
};
