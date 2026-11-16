// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest';
import {embeddedRegions,detectScannedPictures,clampRect,intersects,joinImageTiles,reconstructPictures,hasQrFinders} from '../src/pdf/regions';
const ops={save:1,restore:2,transform:3,paintImageXObject:4,paintInlineImageXObject:5,paintFormXObjectBegin:6,paintFormXObjectEnd:7,paintImageXObjectRepeat:8,paintInlineImageXObjectGroup:9};
const viewport={width:600,height:800,transform:[1,0,0,-1,0,800]};
it('gets embedded-picture boxes from saved, nested and rotated PDF transforms',()=>{
 const list={fnArray:[1,3,4,2,6,1,3,4,2,7],argsArray:[[],[180,0,0,240,60,400],['picture'],[],[[1,0,0,1,300,100],null],[],[0,120,-160,0,160,0],['rotated'],[],[]]};
 const boxes=embeddedRegions(list,ops,viewport);expect(boxes).toHaveLength(2);
 expect(boxes[0].x).toBeCloseTo(.1);expect(boxes[0].y).toBeCloseTo(.2);expect(boxes[0].width).toBeCloseTo(.3);expect(boxes[0].height).toBeCloseTo(.3);
 expect(boxes[1].x).toBeCloseTo(.5);expect(boxes[1].y).toBeCloseTo(.725);
});
it('handles repeated image operators and deduplicates identical placements',()=>{
 const boxes=embeddedRegions({fnArray:[8],argsArray:[['pic',100,140,[20,30,20,30,200,300]]]},ops,viewport);expect(boxes).toHaveLength(2);
});
it('finds tonal photographs in scans while ignoring sparse textbook text',()=>{
 const width=320,height=400,rgba=new Uint8ClampedArray(width*height*4).fill(255);
 for(let y=16;y<100;y+=12)for(let x=20;x<300;x+=7)for(let yy=0;yy<3;yy++)for(let xx=0;xx<3;xx++){const p=((y+yy)*width+x+xx)*4;rgba[p]=rgba[p+1]=rgba[p+2]=15;}
 for(const rect of [{x:25,y:140,w:96,h:120},{x:190,y:235,w:90,h:112}])for(let y=rect.y;y<rect.y+rect.h;y++)for(let x=rect.x;x<rect.x+rect.w;x++){
  const p=(y*width+x)*4,v=40+((x*17+y*31)%180);rgba[p]=v;rgba[p+1]=v;rgba[p+2]=v;
 }
 const boxes=detectScannedPictures(rgba,width,height);expect(boxes.length).toBe(2);expect(boxes.every(b=>b.y>.3)).toBe(true);
 expect(boxes.some(b=>b.x<.1&&b.x+b.width>.37&&b.y<.35&&b.y+b.height>.64)).toBe(true);
});
it('clamps partially visible boxes and rejects empty intersections',()=>{
 expect(clampRect({x:-.1,y:.2,width:.4,height:.3})).toEqual({x:0,y:.2,width:.30000000000000004,height:.3});
 expect(intersects({x:0,y:0,width:.3,height:.3},{x:.5,y:.5,width:.3,height:.3})).toBe(false);
});

it('reconstructs the four-tile photograph from the reported textbook page',()=>{
 const rects=[{x:.434491,y:.264913,width:.214531,height:.157045},{x:.648585,y:.264913,width:.214312,height:.157045},{x:.434491,y:.421628,width:.428406,height:.0784695},{x:.862459,y:.264915,width:.0536123,height:.235182}];
 const joined=joinImageTiles(rects,600,800);expect(joined).toHaveLength(1);expect(joined[0].width).toBeCloseTo(.4815803);expect(joined[0].height).toBeCloseTo(.2351845);
});
it('joins horizontal photo slices without merging the next exam row',()=>{
 const joined=joinImageTiles([{x:.37,y:.714,width:.12,height:.0384},{x:.37,y:.7524,width:.12,height:.0384},{x:.35,y:.814,width:.15,height:.0358},{x:.35,y:.8498,width:.15,height:.0358}],600,850);
 expect(joined).toHaveLength(2);expect(joined.every(r=>r.height>.07)).toBe(true);
});
it('keeps a real white gutter between otherwise touching image rectangles',()=>{
 const width=120,height=100,data=new Uint8ClampedArray(width*height*4).fill(255);
 for(let y=20;y<80;y++)for(let x=15;x<105;x++){if(x>=58&&x<=62)continue;const p=(y*width+x)*4;data[p]=50;data[p+1]=100;data[p+2]=150;}
 const regions=joinImageTiles([{x:.125,y:.2,width:.375,height:.6},{x:.5,y:.2,width:.375,height:.6}],120,100,{data,width,height});expect(regions).toHaveLength(2);
});
it('fills low-texture interiors instead of splitting a photo into texture islands',()=>{
 const width=320,height=400,data=new Uint8ClampedArray(width*height*4).fill(255);
 for(let y=120;y<290;y++)for(let x=35;x<270;x++){const p=(y*width+x)*4,v=y>180&&y<220?155:50+((x*17+y*31)%170);data[p]=v;data[p+1]=v;data[p+2]=v;}
 const regions=detectScannedPictures(data,width,height);expect(regions).toHaveLength(1);expect(regions[0].height).toBeGreaterThan(.4);
});

it('recognizes QR finder geometry without confusing a normal photograph',()=>{
 const width=100,height=100,data=new Uint8ClampedArray(width*height*4).fill(255);
 for(const [x0,y0]of [[8,8],[68,8],[8,68]])for(let my=0;my<7;my++)for(let mx=0;mx<7;mx++){
  const black=mx===0||my===0||mx===6||my===6||mx>=2&&mx<=4&&my>=2&&my<=4;
  if(black)for(let y=0;y<3;y++)for(let x=0;x<3;x++){const p=((y0+my*3+y)*width+x0+mx*3+x)*4;data[p]=data[p+1]=data[p+2]=0;}
 }
 expect(hasQrFinders({data,width,height},{x:0,y:0,width:1,height:1})).toBe(true);
 for(let p=0;p<width*height;p++){const v=(p*17+Math.floor(p/width)*31)%255;data[p*4]=v;data[p*4+1]=v;data[p*4+2]=v;}
 expect(hasQrFinders({data,width,height},{x:0,y:0,width:1,height:1})).toBe(false);
});

it('does not discard a picture containing three QR-like crossing stripe patterns',()=>{
 const width=100,height=100,data=new Uint8ClampedArray(width*height*4).fill(255);
 for(const [x0,y0]of [[8,8],[68,8],[8,68]])for(let my=0;my<7;my++)for(let mx=0;mx<7;mx++){
  if(mx!==3&&my!==3)continue;
  const black=mx===0||my===0||mx===6||my===6||mx>=2&&mx<=4&&my>=2&&my<=4;
  if(black)for(let y=0;y<3;y++)for(let x=0;x<3;x++){const p=((y0+my*3+y)*width+x0+mx*3+x)*4;data[p]=data[p+1]=data[p+2]=0;}
 }
 expect(hasQrFinders({data,width,height},{x:0,y:0,width:1,height:1})).toBe(false);
});

it('disconnects a photograph from a caption joined by a thin scan-border rail',()=>{
 const width=320,height=260,data=new Uint8ClampedArray(width*height*4).fill(255);
 for(let y=40;y<140;y++)for(let x=40;x<280;x++){const p=(y*width+x)*4,v=45+(x*17+y*31)%160;data[p]=v;data[p+1]=v;data[p+2]=v;}
 for(let y=140;y<170;y++)for(let x=40;x<48;x++){const p=(y*width+x)*4;data[p]=data[p+1]=data[p+2]=80;}
 for(let y=170;y<215;y++)for(let x=40;x<280;x++){const p=(y*width+x)*4;data[p]=210;data[p+1]=170;data[p+2]=135;}
 const boxes=detectScannedPictures(data,width,height),photo=boxes.find(r=>r.y<.2&&r.width>.7);
 expect(photo).toBeDefined();expect(photo!.y+photo!.height).toBeLessThan(.6);
 expect(photo!.width).toBeGreaterThan(.73);
});
