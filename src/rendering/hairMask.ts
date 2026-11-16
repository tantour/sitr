// SPDX-License-Identifier: AGPL-3.0-only
import {dilate} from './compositor';
/** Match the hair's own expansion, clip to existing coverage, never add a hide. */
export function hairBlackMask(categories:Uint8Array,coverage:Uint8Array,side:number,radius:number,owner?:Float32Array):Uint8Array|undefined{
  if(categories.length!==side*side||coverage.length!==side*side)return;
  let left=side,top=side,right=-1,bottom=-1;
  for(let p=0;p<coverage.length;p++)if(coverage[p]&&categories[p]===1&&(!owner||owner[p]>=.5)){
    const x=p%side,y=Math.floor(p/side);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  if(right<0)return;
  left=Math.max(0,left-radius);right=Math.min(side-1,right+radius);top=Math.max(0,top-radius);bottom=Math.min(side-1,bottom+radius);
  const width=right-left+1,height=bottom-top+1,crop=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=(top+y)*side+left+x;if(coverage[p]&&categories[p]===1&&(!owner||owner[p]>=.5))crop[y*width+x]=255;}
  const expanded=dilate(crop,width,height,radius),out=new Uint8Array(coverage.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=(top+y)*side+left+x;if(expanded[y*width+x]&&categories[p]!==3)out[p]=coverage[p];}
  return out;
}
export function applyBlackPixels(pixels:Uint8ClampedArray,alpha:Uint8Array):void{
  for(let p=0;p<alpha.length;p++)if(alpha[p]){const at=p*4,factor=1-Math.min(1,alpha[p]/Math.max(1,pixels[at+3]));for(let c=0;c<3;c++)pixels[at+c]*=factor;}
}

/** Approximate a Gaussian with three sliding-window box passes on the hair ROI.
 * Fixed work per pixel, independent of the smoothing radius. */
function roundEnvelope(source:Uint8Array,width:number,height:number,radius:number):Float32Array{
  let field=Float32Array.from(source,value=>value/255);
  const temp=new Float32Array(source.length),out=new Float32Array(source.length),diameter=radius*2+1;
  for(let pass=0;pass<3;pass++){
    for(let y=0;y<height;y++){
      const row=y*width;let sum=0;
      for(let x=-radius;x<=radius;x++)sum+=field[row+Math.max(0,Math.min(width-1,x))];
      for(let x=0;x<width;x++){
        temp[row+x]=sum/diameter;
        sum+=field[row+Math.min(width-1,x+radius+1)]-field[row+Math.max(0,x-radius)];
      }
    }
    for(let x=0;x<width;x++){
      let sum=0;for(let y=-radius;y<=radius;y++)sum+=temp[Math.max(0,Math.min(height-1,y))*width+x];
      for(let y=0;y<height;y++){
        out[y*width+x]=sum/diameter;
        sum+=temp[Math.min(height-1,y+radius+1)*width+x]-temp[Math.max(0,y-radius)*width+x];
      }
    }
    field.set(out);
  }
  return field;
}

/** Close fine strand gaps, add an opaque rounded envelope, then feather only
 * outside that envelope. Never soften or erase the original protected hair. */
export function smoothHairMask(alpha:Uint8Array,side:number,bodySize?:number,categories?:Uint8Array):Uint8Array{
  let left=side,right=-1,top=side,bottom=-1;
  for(let p=0;p<alpha.length;p++)if(alpha[p]){const x=p%side,y=Math.floor(p/side);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  if(right<0)return alpha;
  const span=Math.max(right-left+1,bottom-top+1),radius=Math.max(1,Math.round(Math.min(span*.06,Math.min(side,bodySize??span*3)*.018)));
  const halo=Math.max(1,Math.round(radius*.2)),feather=Math.max(3,Math.ceil(radius*.75)),blurRadius=Math.max(1,Math.round(radius*.4)),padding=2*radius+3*blurRadius+halo+feather+2;
  left=Math.max(0,left-padding);right=Math.min(side-1,right+padding);top=Math.max(0,top-padding);bottom=Math.min(side-1,bottom+padding);
  const width=right-left+1,height=bottom-top+1,source=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(alpha[(top+y)*side+left+x])source[y*width+x]=255;
  const grown=dilate(source,width,height,radius),inverse=Uint8Array.from(grown,value=>value?0:255),eroded=dilate(inverse,width,height,radius);
  const closed=Uint8Array.from(eroded,(value,p)=>source[p]||!value?255:0);
  const rounded=roundEnvelope(closed,width,height,blurRadius);
  // Choose an enclosing contour: every original hair pixel is inside it,
  // with isolated wisps retained explicitly rather than expanding the whole contour.
  const contour=.35; // Isolated wisps must not lower the contour for the entire head.
  const distance=new Uint16Array(source.length).fill(65535);
  for(let p=0;p<distance.length;p++)if(source[p]||rounded[p]>=contour)distance[p]=0;
  // A bounded 3/4 chamfer approximates round dilation in two linear passes.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*width+x;let d=distance[p];if(x)d=Math.min(d,distance[p-1]+3);if(y){d=Math.min(d,distance[p-width]+3);if(x)d=Math.min(d,distance[p-width-1]+4);if(x+1<width)d=Math.min(d,distance[p-width+1]+4);}distance[p]=d;
  }
  for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--){
    const p=y*width+x;let d=distance[p];if(x+1<width)d=Math.min(d,distance[p+1]+3);if(y+1<height){d=Math.min(d,distance[p+width]+3);if(x)d=Math.min(d,distance[p+width-1]+4);if(x+1<width)d=Math.min(d,distance[p+width+1]+4);}distance[p]=d;
  }
  const out=alpha.slice();
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*width+x,d=distance[p]/3;if(d>=halo+feather)continue;
    const t=Math.max(0,Math.min(1,(d-halo)/feather)),value=Math.round(255*(1-t*t*(3-2*t))),q=(top+y)*side+left+x;
    if(!categories||categories[q]!==3||alpha[q])out[q]=Math.max(out[q],value);
  }
  return out;
}
