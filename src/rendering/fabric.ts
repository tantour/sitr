// SPDX-License-Identifier: AGPL-3.0-only
// Fixed synthetic cloth: never samples skin, clothing, or background pixels.
// A small RGB lookup is reused by every layer at the same analysis resolution.
let cachedWidth = 0, cachedHeight = 0;
let texture = new Uint8ClampedArray(0);
export function applyFabric(pixels: Uint8ClampedArray, width: number, height: number): void {
  if (pixels.length !== width * height * 4) throw new Error('Fabric grid mismatch');
  if (cachedWidth !== width || cachedHeight !== height) {
    cachedWidth = width; cachedHeight = height;
    texture = new Uint8ClampedArray(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      // Broad quiet folds and a restrained woven grain, stable across frames.
      const u = x / width, v = y / height;
      const fold = Math.sin(u * 36 + Math.sin(v * 5) * .7) * 3
        + Math.sin(u * 15 - v * 2) * 2;
      const weave = ((x + y) % 2 ? .6 : -.6);
      const shade = fold + weave;
      const i = (y * width + x) * 3;
      texture[i] = 57 + shade; texture[i + 1] = 66 + shade; texture[i + 2] = 77 + shade;
    }
  }
  for (let i = 0, p = 0; i < texture.length; i += 3, p += 4) {
    pixels[p] = texture[i]; pixels[p + 1] = texture[i + 1]; pixels[p + 2] = texture[i + 2];
  }
  // Alpha is deliberately untouched: identical coverage and protected boundaries.
}

/** Continue garment tones, never tile/mirror clothing imagery.
 * Donors must be eroded class-4 clothing inside a high-confidence person mask.
 * Target ownership is intentionally less strict: confidence falls at arm edges,
 * which must not turn back into unrelated slate patches. RGB never changes alpha.
 */
export function clothingFabric(rgba: Uint8Array, categories: Uint8Array,
  people: readonly { mask: Float32Array }[], side: number): Uint8ClampedArray | undefined {
  const count = side * side;
  if (rgba.length !== count * 4 || categories.length !== count || people.some(p => p.mask.length !== count)) return;
  const out = new Uint8ClampedArray(count * 4); applyFabric(out, side, side);
  const owner = new Int16Array(count).fill(-1);
  if (people.length === 1) owner.fill(0);
  else for (let p = 0; p < count; p++) {
    let best = .01, second = 0;
    for (let t = 0; t < people.length; t++) {
      const value = people[t].mask[p];
      if (value > best) { second = best; best = value; owner[p] = t; }
      else second = Math.max(second, value);
    }
    if (second > .1 && best - second < .15) owner[p] = -1;
  }
  const donor = new Int32Array(count).fill(-1), distance = new Uint16Array(count).fill(65535);
  const sums = people.map(() => new Float64Array(64 * 4));
  // Integral validity grid replaces 25 donor checks per pixel with four reads.
  // A 3x3 window keeps narrow straps/sleeves usable in small pictures.
  const pitch = side + 1, valid = new Uint32Array(pitch * pitch);
  // Semantic clothing can contain misclassified neck/hand pixels in small photos.
  // Ambiguous warm skin tones use the safe synthetic textile instead.
  const safeColor=(p:number)=>{const i=p*4,r=rgba[i],g=rgba[i+1],b=rgba[i+2];
    return !(r>60&&b>25&&r-g>7&&g>=b-3&&r-b>18);};
  for (let y = 0; y < side; y++) {
    let row = 0;
    for (let x = 0; x < side; x++) {
      const p = y * side + x, person = owner[p];
      row += Number(person >= 0 && categories[p] === 4 && people[person].mask[p] >= .8 && safeColor(p));
      valid[(y + 1) * pitch + x + 1] = valid[y * pitch + x + 1] + row;
    }
  }
  for (let y = 1; y < side - 1; y++) for (let x = 1; x < side - 1; x++) {
    const p = y * side + x, person = owner[p];
    if (person < 0 || categories[p] !== 4 || people[person].mask[p] < .8) continue;
    const samples = valid[(y + 2) * pitch + x + 2] - valid[(y - 1) * pitch + x + 2]
      - valid[(y + 2) * pitch + x - 1] + valid[(y - 1) * pitch + x - 1];
    let safe = samples === 9;
    if (safe && people.length > 1) for (let dy = -1; dy <= 1 && safe; dy++) for (let dx = -1; dx <= 1; dx++)
      if (owner[p + dy * side + dx] !== person) { safe = false; break; }
    if (safe) {
      donor[p] = p; distance[p] = 0;
      const i = p * 4, bin = ((rgba[i] >> 6) * 16 + (rgba[i + 1] >> 6) * 4 + (rgba[i + 2] >> 6)) * 4;
      const histogram = sums[person]; histogram[bin]++; histogram[bin + 1] += rgba[i]; histogram[bin + 2] += rgba[i + 1]; histogram[bin + 3] += rgba[i + 2];
    }
  }
  // Dominant clothing tones suppress logos, ribs and seams rather than copying
  // them onto bare arms. Keep substantial alternate colors (e.g. blue trousers).
  const palettes = sums.map(histogram => {
    let total = 0; const bins: number[] = [];
    for (let b = 0; b < 64; b++) { total += histogram[b * 4]; if (histogram[b * 4]) bins.push(b); }
    bins.sort((a, b) => histogram[b * 4] - histogram[a * 4]);
    const colors: Array<{ rgb: number[]; weight: number }> = [];
    for (const b of bins) {
      const i = b * 4, n = histogram[i];
      const rgb = [histogram[i + 1] / n, histogram[i + 2] / n, histogram[i + 3] / n];
      const mean=rgb.reduce((a,b)=>a+b)/3;
      const match = colors.find(color => {
        const other=color.rgb.reduce((a,b)=>a+b)/3;
        return color.rgb.reduce((d,v,c)=>d+(v-rgb[c])**2,0)<100**2
          && color.rgb.reduce((d,v,c)=>d+(v-other-rgb[c]+mean)**2,0)<22**2;
      });
      if (match) { for (let c = 0; c < 3; c++) match.rgb[c] = (match.rgb[c] * match.weight + rgb[c] * n) / (match.weight + n); match.weight += n; }
      else colors.push({ rgb, weight: n });
    }
    // Combine nearby shades before rejecting small colors: a patterned blue
    // garment can span many histogram bins while one shadow dominates a bin.
    colors.sort((a,b)=>b.weight-a.weight);
    const kept=colors.filter((color,i)=>i===0||color.weight>=total*.12).slice(0,3);
    const dyed=kept.find(color=>Math.max(...color.rgb)-Math.min(...color.rgb)>25&&color.weight>=total*.12);
    if(dyed)for(const color of kept){const light=color.rgb.reduce((a,b)=>a+b)/3,base=dyed.rgb.reduce((a,b)=>a+b)/3;
      if(light>55&&light<base*.85&&Math.max(...color.rgb)-Math.min(...color.rgb)<18)color.rgb=[...dyed.rgb];}
    return kept.map(color => color.rgb);
  });
  const borrow = (p: number, q: number, cost: number) => {
    if (owner[p] < 0 || owner[p] !== owner[q] || donor[q] < 0) return;
    const d = distance[q] + cost;
    if (d < distance[p]) { distance[p] = d; donor[p] = donor[q]; }
  };
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const p = y * side + x;
    if (y) borrow(p, p - side, 1); if (x) borrow(p, p - 1, 2);
  }
  for (let y = side - 1; y >= 0; y--) for (let x = side - 1; x >= 0; x--) {
    const p = y * side + x;
    if (y + 1 < side) borrow(p, p + side, 3); if (x + 1 < side) borrow(p, p + 1, 2);
  }
  // Low-frequency garment lighting is extended on a bounded coarse grid.
  // Only trusted clothing seeds enter the field; no skin luminance or background.
  const step=Math.max(3,Math.ceil(side/64)),grid=Math.ceil(side/step),cells=grid*grid;
  const cellOwner=new Int16Array(cells).fill(-1),bucket=new Int8Array(cells).fill(-1),fixed=new Uint8Array(cells);
  const field=new Float32Array(cells*3),weights=new Uint16Array(cells);
  const choose=(person:number,q:number)=>{
    const palette=palettes[person];let best=0,error=Infinity;
    for(let c=0;c<(palette?.length??0);c++){
      const color=palette[c],d=(color[0]-rgba[q*4])**2+(color[1]-rgba[q*4+1])**2+(color[2]-rgba[q*4+2])**2;
      if(d<error){best=c;error=d;}
    }
    return{best,error};
  };
  for(let p=0;p<count;p++)if(donor[p]===p&&owner[p]>=0){
    const person=owner[p],choice=choose(person,p);if(choice.error>90**2)continue;
    const cell=Math.floor(Math.floor(p/side)/step)*grid+Math.floor((p%side)/step);
    if(cellOwner[cell]===-2)continue;
    if(cellOwner[cell]>=0&&(cellOwner[cell]!==person||bucket[cell]!==choice.best)){cellOwner[cell]=-2;continue;}
    cellOwner[cell]=person;bucket[cell]=choice.best;weights[cell]++;
    for(let c=0;c<3;c++)field[cell*3+c]+=rgba[p*4+c];
  }
  for(let cell=0;cell<cells;cell++)if(cellOwner[cell]>=0&&weights[cell]){
    fixed[cell]=1;for(let c=0;c<3;c++)field[cell*3+c]/=weights[cell];
  }
  for(let gy=0;gy<grid;gy++)for(let gx=0;gx<grid;gx++){
    const cell=gy*grid+gx;if(fixed[cell])continue;
    const x=Math.min(side-1,gx*step+Math.floor(step/2)),y=Math.min(side-1,gy*step+Math.floor(step/2));
    const p=y*side+x,person=owner[p],q=donor[p],palette=palettes[person];if(!palette?.length)continue;
    const color=q>=0?choose(person,q).best:0;cellOwner[cell]=person;bucket[cell]=color;
    const from=q>=0?Math.floor(Math.floor(q/side)/step)*grid+Math.floor((q%side)/step):-1;
    for(let c=0;c<3;c++)field[cell*3+c]=from>=0&&fixed[from]&&cellOwner[from]===person&&bucket[from]===color?field[from*3+c]:palette[color][c];
  }
  let smooth=field,scratch=new Float32Array(field.length);
  for(let pass=0;pass<6;pass++){
    scratch.set(smooth);
    for(let y=0;y<grid;y++)for(let x=0;x<grid;x++){
      const cell=y*grid+x;if(fixed[cell]||cellOwner[cell]<0)continue;
      let n=2;const sum=[smooth[cell*3]*2,smooth[cell*3+1]*2,smooth[cell*3+2]*2];
      for(const next of [x?cell-1:-1,x+1<grid?cell+1:-1,y?cell-grid:-1,y+1<grid?cell+grid:-1]){
        if(next<0||cellOwner[next]!==cellOwner[cell]||bucket[next]!==bucket[cell])continue;
        n++;for(let c=0;c<3;c++)sum[c]+=smooth[next*3+c];
      }
      for(let c=0;c<3;c++)scratch[cell*3+c]=sum[c]/n;
    }
    const old=smooth;smooth=scratch;scratch=old;
  }
  for(let y=0;y<side;y++)for(let x=0;x<side;x++){
    const p=y*side+x,person=owner[p],palette=palettes[person];if(!palette?.length)continue;
    const q=donor[p],color=q>=0?choose(person,q).best:0,tone=palette[color];
    const fx=Math.max(0,x/step-.5),fy=Math.max(0,y/step-.5),gx=Math.min(grid-1,Math.floor(fx)),gy=Math.min(grid-1,Math.floor(fy));
    const tx=fx-gx,ty=fy-gy;let weight=0;const rgb=[0,0,0];
    for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
      const cell=Math.min(grid-1,gy+dy)*grid+Math.min(grid-1,gx+dx);
      if(cellOwner[cell]!==person||bucket[cell]!==color)continue;
      const w=(dx?tx:1-tx)*(dy?ty:1-ty);weight+=w;for(let c=0;c<3;c++)rgb[c]+=smooth[cell*3+c]*w;
    }
    const near=q<0?0:Math.max(0,1-distance[p]/Math.max(2,side*.035));
    for(let c=0;c<3;c++){
      const light=Math.max(tone[c]-14,Math.min(tone[c]+14,weight?rgb[c]/weight:tone[c]));
      // Soft local attachment, no copied logos/ribs and no long mirrored strips.
      const detail=q<0?light:Math.max(light-8,Math.min(light+8,rgba[q*4+c]));
      out[p*4+c]=light+(detail-light)*near;
    }
  }
  return out;
}
export function applyClothing(pixels: Uint8ClampedArray, clothing: Uint8ClampedArray): void {
  if (pixels.length !== clothing.length) throw new Error('Clothing grid mismatch');
  for (let p = 0; p < pixels.length; p += 4) {
    pixels[p] = clothing[p]; pixels[p + 1] = clothing[p + 1]; pixels[p + 2] = clothing[p + 2];
  }
}

/** Add a narrow antialiased fringe OUTSIDE coverage. Never blur away core opacity.
 * RGB is already clothing-only, so no original image pixels enter this operation.
 */
export function softenFabricEdges(pixels: Uint8ClampedArray, width: number, height: number): void {
  if (pixels.length !== width * height * 4) throw new Error('Fabric edge grid mismatch');
  const alpha = new Uint8Array(width * height);
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x, value = pixels[p * 4 + 3]; alpha[p] = value;
    if (value) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  }
  if (right < 0) return;
  left = Math.max(0, left - 2); right = Math.min(width - 1, right + 2);
  top = Math.max(0, top - 2); bottom = Math.min(height - 1, bottom + 2);
  // Separable five-pixel support smooths the contour, including stair corners.
  // Original protected alpha is a lower bound; this can only add coverage.
  const horizontal = new Uint16Array(alpha.length);
  for (let y = top; y <= bottom; y++) {
    const row = y * width; let sum = 0;
    for (let x = left; x < Math.min(left + 2, width); x++) sum += alpha[row + x];
    for (let x = left; x <= right; x++) {
      if (x + 2 < width) sum += alpha[row + x + 2];
      if (x > left + 2) sum -= alpha[row + x - 3];
      horizontal[row + x] = sum;
    }
  }
  for (let x = left; x <= right; x++) {
    let sum = 0;
    for (let y = top; y < Math.min(top + 2, height); y++) sum += horizontal[y * width + x];
    for (let y = top; y <= bottom; y++) {
      if (y + 2 < height) sum += horizontal[(y + 2) * width + x];
      if (y > top + 2) sum -= horizontal[(y - 3) * width + x];
      const p = y * width + x;
      if (alpha[p] === 255) continue;
      const fringe = Math.min(255, Math.round(sum * .065));
      if (fringe <= alpha[p]) continue;
      let edgeColor = p, best = alpha[p], nearestDistance = Infinity;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
        const q = p + dy * width + dx, distance = dx * dx + dy * dy;
        if (alpha[q] > best || alpha[q] === best && distance < nearestDistance) { best = alpha[q]; edgeColor = q; nearestDistance = distance; }
      }
      pixels[p * 4] = pixels[edgeColor * 4]; pixels[p * 4 + 1] = pixels[edgeColor * 4 + 1]; pixels[p * 4 + 2] = pixels[edgeColor * 4 + 2];
      pixels[p * 4 + 3] = fringe;
    }
  }
}

/** Gentle volume along each covered run: stable in mask coordinates, RGB only. */
export function shadeFabricRuns(pixels:Uint8ClampedArray,width:number,height:number,light?:[number,number,number,number],box?:{x:number;y:number;width:number;height:number}):void{
  for(let y=0;y<height;y++)for(let x=0;x<width;){
    if(!pixels[(y*width+x)*4+3]){x++;continue;}
    const left=x;while(x<width&&pixels[(y*width+x)*4+3])x++;const length=x-left;if(length<5)continue;
    for(let u=0;u<length;u++){
      const p=(y*width+left+u)*4,t=(u+.5)/length,arch=4*t*(1-t);
      const luminance=(pixels[p]+pixels[p+1]+pixels[p+2])/3;
      let shade=(arch-.66)*Math.min(5,luminance*.023);
      if(light&&box){const px=(left+u+.5)/width,py=(y+.5)/height;
        const a=Math.max(0,Math.min(1,(px-box.x)/Math.max(.001,box.width))),b=Math.max(0,Math.min(1,(py-box.y)/Math.max(.001,box.height)));
        shade+=(light[0]*(1-a)+light[1]*a)*.65+(light[2]*(1-b)+light[3]*b)*.35;
      }
      for(let c=0;c<3;c++)pixels[p+c]+=shade;
    }
  }
}
/** A blend band may enter clothing, never reopen protected skin or shown faces. */
export function joinClothing(alpha:Uint8Array,categories:Uint8Array,people:readonly{mask:Float32Array}[],side:number,radius=4):Uint8Array{
  const out=alpha.slice(),distance=new Uint8Array(alpha.length).fill(255),owner=new Int16Array(alpha.length).fill(-1);
  for(let p=0;p<alpha.length;p++)if(alpha[p]){
    let best=.5;for(let t=0;t<people.length;t++)if(people[t].mask[p]>best){best=people[t].mask[p];owner[p]=t;}
    if(owner[p]>=0)distance[p]=0;
  }
  const borrow=(p:number,q:number)=>{const t=owner[q];if(t<0||distance[q]>=radius||distance[q]+1>=distance[p]||people[t].mask[p]<.8||people.some((other,i)=>i!==t&&other.mask[p]>=people[t].mask[p]-.15))return;owner[p]=t;distance[p]=distance[q]+1;};
  for(let y=0;y<side;y++)for(let x=0;x<side;x++){const p=y*side+x;if(x)borrow(p,p-1);if(y)borrow(p,p-side);}
  for(let y=side-1;y>=0;y--)for(let x=side-1;x>=0;x--){const p=y*side+x;if(x+1<side)borrow(p,p+1);if(y+1<side)borrow(p,p+side);}
  for(let p=0;p<out.length;p++)if(!alpha[p]&&categories[p]===4&&distance[p]<=radius)out[p]=Math.round(255*((radius+1-distance[p])/(radius+1))**2);
  return out;
}
