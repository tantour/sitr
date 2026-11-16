// SPDX-License-Identifier: AGPL-3.0-only
export function smallImage(width?:number,height?:number):boolean{
  return !!width&&!!height&&width>0&&height>0&&Math.max(width,height)<=160&&width*height>=256;
}
/** Upscaling must not make a three-pixel face appear reliably large. */
export function nativeFaceWidth(faceWidth:number,captureSide:number,width?:number,height?:number):number{
  return faceWidth*Math.min(captureSide,width&&height?Math.max(width,height):captureSide);
}
export function thumbnailNeedsFallback(categories:Uint8Array,mask:Float32Array):boolean{
  let owned=0,recognized=0;
  for(let p=0;p<categories.length;p++)if(mask[p]>=.5){owned++;if(categories[p]>=1&&categories[p]<=5)recognized++;}
  return owned>=16&&recognized/owned<.05;
}
