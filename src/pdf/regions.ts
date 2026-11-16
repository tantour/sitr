// SPDX-License-Identifier: AGPL-3.0-only
export type PdfRect={x:number;y:number;width:number;height:number};
export type PdfRegion=PdfRect&{kind:'embedded'|'detected'|'manual';id:string};
type Matrix=number[];
export const multiply=(a:Matrix,b:Matrix):Matrix=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
export function clampRect(rect:PdfRect):PdfRect|undefined{
 const x=Math.max(0,rect.x),y=Math.max(0,rect.y),right=Math.min(1,rect.x+rect.width),bottom=Math.min(1,rect.y+rect.height);
 return right>x&&bottom>y?{x,y,width:right-x,height:bottom-y}:undefined;
}
function transformed(matrix:Matrix,width:number,height:number):PdfRect|undefined{
 const points=[[0,0],[1,0],[0,1],[1,1]].map(([x,y])=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]]);
 const xs=points.map(p=>p[0]/width),ys=points.map(p=>p[1]/height),x=Math.min(...xs),y=Math.min(...ys);
 return clampRect({x,y,width:Math.max(...xs)-x,height:Math.max(...ys)-y});
}
/** Exact image placement from PDF drawing transforms; no learned layout model. */
export function embeddedRegions(list:{fnArray:number[];argsArray:any[]},ops:Record<string,number>,viewport:{width:number;height:number;transform:number[]}):PdfRegion[]{
 let matrix=[1,0,0,1,0,0];const stack:Matrix[]=[],rects:PdfRect[]=[];
 const add=(m=matrix)=>{const rect=transformed(multiply(viewport.transform,m),viewport.width,viewport.height);if(rect&&rect.width*viewport.width>=12&&rect.height*viewport.height>=12)rects.push(rect);};
 for(let i=0;i<list.fnArray.length;i++){
  const op=list.fnArray[i],args=list.argsArray[i]??[];
  if(op===ops.save)stack.push(matrix.slice());
  else if(op===ops.restore)matrix=stack.pop()??[1,0,0,1,0,0];
  else if(op===ops.transform)matrix=multiply(matrix,Array.from(args));
  else if(op===ops.paintFormXObjectBegin){stack.push(matrix.slice());if(args[0])matrix=multiply(matrix,Array.from(args[0]));}
  else if(op===ops.paintFormXObjectEnd)matrix=stack.pop()??[1,0,0,1,0,0];
  else if(op===ops.paintImageXObject||op===ops.paintInlineImageXObject)add();
  else if(op===ops.paintImageXObjectRepeat){const [,sx,sy,positions]=args;for(let p=0;p<positions.length;p+=2)add(multiply(matrix,[sx,0,0,sy,positions[p],positions[p+1]]));}
  else if(op===ops.paintInlineImageXObjectGroup){for(const entry of args[1]??[])add(multiply(matrix,Array.from(entry.transform)));}
 }
 return deduplicate(rects).map((r,i)=>({...r,id:'embedded-'+i,kind:'embedded'}));
}
function overlap(a:PdfRect,b:PdfRect):number{return Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));}
export function deduplicate(rects:PdfRect[]):PdfRect[]{
 const out:PdfRect[]=[];
 for(const rect of rects.sort((a,b)=>b.width*b.height-a.width*a.height))if(!out.some(r=>overlap(r,rect)/Math.min(r.width*r.height,rect.width*rect.height)>.9))out.push(rect);
 return out;
}
/** Reconstruct PDF photographs that an exporter split into touching raster tiles.
 * A spatial sweep + union-find joins shared edges, rather than treating every
 * paint operation as a semantic image. Real white gutters remain separators. */
export function joinImageTiles(rectangles:PdfRect[],pageWidth:number,pageHeight:number,image?:{data:Uint8ClampedArray;width:number;height:number}):PdfRect[]{
 const rects=deduplicate(rectangles).slice().sort((a,b)=>a.x-b.x),parent=rects.map((_,i)=>i),epsX=1/pageWidth,epsY=1/pageHeight;
 const find=(n:number):number=>{while(parent[n]!==n){parent[n]=parent[parent[n]];n=parent[n];}return n;};
 const gutter=(a:PdfRect,b:PdfRect,vertical:boolean)=>{
  if(!image)return false;
  const {data,width,height}=image;
  const seam=vertical?(a.x+a.width+b.x)/2:(a.y+a.height+b.y)/2;
  const lo=vertical?Math.max(a.y,b.y):Math.max(a.x,b.x),hi=vertical?Math.min(a.y+a.height,b.y+b.height):Math.min(a.x+a.width,b.x+b.width);
  const along=vertical?height:width,across=vertical?width:height,center=Math.round(seam*across);let blank=0;
  for(let line=center-1;line<=center+1;line++){
   if(line<0||line>=across)continue;let white=0,total=0;
   for(let q=Math.ceil(lo*along)+1;q<Math.floor(hi*along)-1;q++){
    const x=vertical?line:q,y=vertical?q:line,p=(y*width+x)*4;
    if(data[p]>244&&data[p+1]>244&&data[p+2]>244)white++;total++;
   }
   if(total&&white/total>.94)blank++;
  }
  return blank>=2;
 };
 for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
  const a=rects[i],b=rects[j];if(b.x>a.x+a.width+epsX)break;
  const oy=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y),ox=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x);
  let touching=false;
  if(Math.abs(a.x+a.width-b.x)<=epsX&&oy>=Math.min(a.height,b.height)*.85)touching=!gutter(a,b,true);
  const [upper,lower]=a.y<b.y?[a,b]:[b,a];
  if(Math.abs(upper.y+upper.height-lower.y)<=epsY&&ox>=Math.min(a.width,b.width)*.85)touching ||= !gutter(upper,lower,false);
  if(touching){const ai=find(i),bi=find(j);if(ai!==bi)parent[bi]=ai;}
 }
 const groups=new Map<number,PdfRect>();
 for(let i=0;i<rects.length;i++){
  const id=find(i),r=rects[i],old=groups.get(id);
  if(!old)groups.set(id,{...r});else{const right=Math.max(old.x+old.width,r.x+r.width),bottom=Math.max(old.y+old.height,r.y+r.height);old.x=Math.min(old.x,r.x);old.y=Math.min(old.y,r.y);old.width=right-old.x;old.height=bottom-old.y;}
 }
 return deduplicate([...groups.values()]);
}
/** Cheap continuous-tone statistics distinguish pictures from small line icons
 * and recurring flat-color page furniture. This is not a learned classifier. */
export function pictureStatistics(image:{data:Uint8ClampedArray;width:number;height:number},r:PdfRect){
 const {data,width,height}=image,x0=Math.max(0,Math.floor(r.x*width)),y0=Math.max(0,Math.floor(r.y*height)),x1=Math.min(width,Math.ceil((r.x+r.width)*width)),y1=Math.min(height,Math.ceil((r.y+r.height)*height));
 const step=Math.max(1,Math.floor(Math.max(x1-x0,y1-y0)/128)),tones=new Uint32Array(32),palette=new Uint32Array(64);let count=0,white=0,mid=0;
 for(let y=y0;y<y1;y+=step)for(let x=x0;x<x1;x+=step){const p=(y*width+x)*4,red=data[p],green=data[p+1],blue=data[p+2],v=(red*77+green*150+blue*29)>>8;
  count++;if(red>238&&green>238&&blue>238)white++;if(v>35&&v<225)mid++;tones[v>>3]++;palette[(red>>6)*16+(green>>6)*4+(blue>>6)]++;
 }
 return{white:white/Math.max(1,count),mid:mid/Math.max(1,count),dominant:Math.max(...palette)/Math.max(1,count),tones:tones.filter(n=>n>count*.003).length};
}
/** QR finder patterns are geometry, not photographs. Require three separated
 * 1:1:3:1:1 patterns with matching horizontal/vertical centers in an L shape. */
export function hasQrFinders(image:{data:Uint8ClampedArray;width:number;height:number},r:PdfRect):boolean{
 const {data,width,height}=image,x0=Math.max(0,Math.floor(r.x*width)),y0=Math.max(0,Math.floor(r.y*height)),w=Math.min(width-x0,Math.ceil(r.width*width)),h=Math.min(height-y0,Math.ceil(r.height*height));
 if(w<21||h<21||w/h<.65||w/h>1.5)return false;
 const dark=(x:number,y:number)=>{if(x<0||x>=w||y<0||y>=h)return false;const p=((y+y0)*width+x+x0)*4;return data[p]*77+data[p+1]*150+data[p+2]*29<145*256;};
 const ratio=(runs:number[])=>{const module=runs.reduce((a,b)=>a+b,0)/7;return module>=.65&&runs.every((v,i)=>Math.abs(v-module*(i===2?3:1))<module*(i===2?1.25:.8));};
 const centers:Array<{x:number;y:number;module:number}>=[];
 for(let y=1;y<h-1;y++){
  const lengths:number[]=[],starts:number[]=[],colors:boolean[]=[];let previous=dark(0,y),start=0;
  for(let x=1;x<=w;x++){
   const color=x<w?dark(x,y):!previous;if(color===previous)continue;
   lengths.push(x-start);starts.push(start);colors.push(previous);previous=color;start=x;
   const n=lengths.length;if(n<5||!colors[n-5]||!ratio(lengths.slice(n-5)))continue;
   const ix=Math.round(starts[n-3]+lengths[n-3]/2),runs=[0,0,0,0,0];
   let yy=y;while(yy>=0&&dark(ix,yy)){runs[2]++;yy--;}
   while(yy>=0&&!dark(ix,yy)){runs[1]++;yy--;}
   while(yy>=0&&dark(ix,yy)){runs[0]++;yy--;}
   yy=y+1;while(yy<h&&dark(ix,yy)){runs[2]++;yy++;}const bottom=yy;
   while(yy<h&&!dark(ix,yy)){runs[3]++;yy++;}
   while(yy<h&&dark(ix,yy)){runs[4]++;yy++;}
   if(!ratio(runs))continue;const cy=bottom-runs[2]/2,cx=starts[n-3]+lengths[n-3]/2;
   const horizontal=lengths.slice(n-5).reduce((a,b)=>a+b,0)/7,vertical=runs.reduce((a,b)=>a+b,0)/7;
   if(Math.abs(horizontal-vertical)>Math.min(horizontal,vertical)*.3)continue;
   const module=(horizontal+vertical)/2;let matches=0;
   // A crossing pair of striped scan lines also occurs in photos and text.
   // Require the complete nested-square finder, not merely its center lines.
   for(let gy=-3;gy<=3;gy++)for(let gx=-3;gx<=3;gx++){
    const xx=Math.floor(cx+gx*module),yy=Math.floor(cy+gy*module);
    if(xx<0||yy<0||xx>=w||yy>=h)continue;
    const expected=Math.max(Math.abs(gx),Math.abs(gy))===3||Math.max(Math.abs(gx),Math.abs(gy))<=1;
    if(dark(xx,yy)===expected)matches++;
   }
   if(matches<44)continue;
   if(!centers.some(c=>Math.abs(c.x-cx)<3&&Math.abs(c.y-cy)<3))centers.push({x:cx,y:cy,module});
   if(centers.length>32)break;
  }
 }
 for(const p of centers)for(const q of centers)for(const s of centers)if(p!==q&&p!==s&&q!==s&&Math.max(p.module,q.module,s.module)<Math.min(p.module,q.module,s.module)*1.35&&Math.abs(p.x-q.x)<w*.16&&Math.abs(p.y-s.y)<h*.16&&Math.abs(p.y-q.y)>h*.35&&Math.abs(p.x-s.x)>w*.35)return true;
 return false;
}
export function reconstructPictures(image:{data:Uint8ClampedArray;width:number;height:number},embedded:PdfRect[],pageWidth:number,pageHeight:number,scanned=false):PdfRegion[]{
 const joined=joinImageTiles(embedded.filter(r=>r.width*r.height<=.65),pageWidth,pageHeight,image),candidates:PdfRect[]=joined.slice();
 if(scanned||!embedded.length)candidates.push(...detectScannedPictures(image.data,image.width,image.height));
 return deduplicate(candidates).filter(r=>{
  const s=pictureStatistics(image,r),area=r.width*r.height;
  const flatPageFurniture=(r.y<.025||r.y+r.height>.975)&&r.height<.13&&(s.dominant>.6||(r.width/r.height>2&&s.tones<10));
  const smallLineIcon=area<.018&&s.white>.7&&s.mid<.14;
  return !flatPageFurniture&&!smallLineIcon&&!hasQrFinders(image,r);
 }).map((r,i)=>({...r,id:'picture-'+i,kind:joined.some(j=>Math.abs(j.x-r.x)<.0001&&Math.abs(j.y-r.y)<.0001)?'embedded':'detected'}));
}
/** Tile statistics separate dense tonal pictures from white paper and sparse text.
 * Runs on a bounded low-resolution page; linear work, no OCR or AI layout pass. */
export function detectScannedPictures(rgba:Uint8ClampedArray,width:number,height:number):PdfRect[]{
 const cell=8,cols=Math.ceil(width/cell),rows=Math.ceil(height/cell),tiles=new Uint8Array(cols*rows),support=new Uint8Array(cols*rows);
 for(let gy=0;gy<rows;gy++)for(let gx=0;gx<cols;gx++){
  let sum=0,squares=0,mid=0,white=0,color=0,count=0,bins=0;
  for(let y=gy*cell;y<Math.min(height,(gy+1)*cell);y++)for(let x=gx*cell;x<Math.min(width,(gx+1)*cell);x++){
   const p=(y*width+x)*4,r=rgba[p],g=rgba[p+1],b=rgba[p+2],v=(r*77+g*150+b*29)>>8;
   sum+=v;squares+=v*v;count++;if(v>238)white++;if(v>30&&v<230)mid++;if(Math.max(r,g,b)-Math.min(r,g,b)>30)color++;bins|=1<<(v>>4);
  }
  let tones=0;for(let b=bins;b;b&=b-1)tones++;
  const variance=squares/count-(sum/count)**2;
  if(white/count<.35)support[gy*cols+gx]=1;
  if(white/count<.72&&variance>45&&tones>=4&&(mid/count>.28||color/count>.3))tiles[gy*cols+gx]=1;
 }
 // Bridge one-tile interruptions within a photograph without joining text columns.
 const closed=Uint8Array.from(tiles,(v,p)=>v||support[p]?1:0);
 for(let y=1;y<rows-1;y++)for(let x=1;x<cols-1;x++){const p=y*cols+x;if(tiles[p-1]&&tiles[p+1]||tiles[p-cols]&&tiles[p+cols])closed[p]=1;}
 const visited=new Uint8Array(tiles.length),rects:PdfRect[]=[];
 for(let first=0;first<closed.length;first++){
  if(!closed[first]||visited[first])continue;
  const queue=[first];visited[first]=1;let left=cols,right=0,top=rows,bottom=0,count=0,seeds=0;
  for(let q=0;q<queue.length;q++){
   const p=queue[q],x=p%cols,y=Math.floor(p/cols);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);count++;if(tiles[p])seeds++;
   for(const [dx,dy]of [[-1,0],[1,0],[0,-1],[0,1]]){const nx=x+dx,ny=y+dy,n=ny*cols+nx;if(nx>=0&&nx<cols&&ny>=0&&ny<rows&&closed[n]&&!visited[n]){visited[n]=1;queue.push(n);}}
  }
  const w=(right-left+1)*cell,h=(bottom-top+1)*cell;
  if(seeds>=3&&count>=6&&count/((right-left+1)*(bottom-top+1))>.35&&w>=24&&h>=24&&w/h>.12&&w/h<9&&w*h>=width*height*.001){
   // Paragraphs can have textured antialiased glyphs too. Their surrounding
   // white paper dominates the joined component, unlike a tonal photograph.
   let white=0,samples=0;
   for(let y=top*cell;y<Math.min(height,(bottom+1)*cell);y+=2)for(let x=left*cell;x<Math.min(width,(right+1)*cell);x+=2){const p=(y*width+x)*4;const v=(rgba[p]*77+rgba[p+1]*150+rgba[p+2]*29)>>8;if(v>238)white++;samples++;}
   if(white/samples>.6)continue;
   const pad=2,rect=clampRect({x:(left*cell-pad)/width,y:(top*cell-pad)/height,width:(w+2*pad)/width,height:(h+2*pad)/height});if(rect)rects.push(rect);
  }
 }
 const tightened=rects.flatMap(r=>tightenScan(r,rgba,width,height));
 // Scan-edge rails can connect a whole page to a real photo. Prefer its
 // smaller recovered box instead of retaining the overlapping page container.
 const filtered=tightened.filter(r=>!(r.width*r.height>.5&&tightened.some(child=>child!==r
  &&child.width*child.height>.03&&r.width*r.height>child.width*child.height*2
  &&overlap(r,child)/(child.width*child.height)>.4)));
 return deduplicate(filtered).slice(0,64);
}
/** Split only across broad horizontal paper gutters, then trim blank margins.
 * Unlike erosion, this keeps thin photo details and flat interiors connected. */
function tightenScan(r:PdfRect,data:Uint8ClampedArray,width:number,height:number):PdfRect[]{
 const x0=Math.max(0,Math.floor(r.x*width)),x1=Math.min(width,Math.ceil((r.x+r.width)*width));
 const y0=Math.max(0,Math.floor(r.y*height)),y1=Math.min(height,Math.ceil((r.y+r.height)*height));
 const white=(x:number,y:number)=>{const p=(y*width+x)*4;return data[p]>235&&data[p+1]>235&&data[p+2]>235;};
 const bands:Array<[number,number]>=[];let start=y0,gap=-1;
 for(let y=y0;y<=y1;y++){
  let blank=y===y1;
  if(!blank){let n=0;for(let x=x0;x<x1;x++)if(white(x,y))n++;blank=n/(x1-x0)>.96;}
  if(blank){if(gap<0)gap=y;}else if(gap>=0){if(y-gap>=5&&gap-start>=24){bands.push([start,gap]);start=y;}gap=-1;}
 }
 const end=gap>=0?gap:y1;if(end-start>=24)bands.push([start,end]);
 if(!bands.length)return[r];
 return bands.flatMap(([top,bottom])=>{
  let left=x0,right=x1;
  const blankColumn=(x:number)=>{let n=0;for(let y=top;y<bottom;y++)if(white(x,y))n++;return n/(bottom-top)>.985;};
  while(left<right&&blankColumn(left))left++;while(right>left&&blankColumn(right-1))right--;
  if(right-left<24)return[];
  const rect=clampRect({x:(left-2)/width,y:(top-2)/height,width:(right-left+4)/width,height:(bottom-top+4)/height});
  return rect&&pictureStatistics({data,width,height},rect).white<=.6?[rect]:[];
 });
}
export function intersects(a:PdfRect,b:PdfRect):boolean{return overlap(a,b)>0;}
