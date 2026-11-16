import ts from 'typescript';
import {readFile} from 'node:fs/promises';
const source = ts.transpileModule(await readFile('src/rendering/fabric.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {applyFabric,clothingFabric,softenFabricEdges}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
for(const side of [256,416]) {
 const pixels=new Uint8ClampedArray(side*side*4); applyFabric(pixels,side,side);
 for(let i=0;i<200;i++) applyFabric(pixels,side,side);
 const start=performance.now(); for(let i=0;i<2000;i++) applyFabric(pixels,side,side);
 console.log(side+'x'+side+': '+((performance.now()-start)/2000).toFixed(3)+' ms per mask (warm lookup, Node CPU)');
}

for(const side of [256,416]) {
 const n=side*side, rgba=new Uint8Array(n*4).fill(220), categories=new Uint8Array(n).fill(2), mask=new Float32Array(n).fill(1);
 categories.fill(4,0,n/3);
 for(let i=0;i<20;i++) clothingFabric(rgba,categories,[{mask}],side);
 const start=performance.now(); for(let i=0;i<100;i++) clothingFabric(rgba,categories,[{mask}],side);
 console.log(side+'x'+side+': '+((performance.now()-start)/100).toFixed(3)+' ms clothing extrapolation (one person, Node CPU)');
}

for(const side of [256,416]) {
 const a=new Uint8ClampedArray(side*side*4);for(let p=0;p<side*side;p++) if(p%side>side/3&&p%side<side*2/3)a[p*4+3]=255;
 for(let i=0;i<20;i++)softenFabricEdges(a,side,side);
 const start=performance.now();for(let i=0;i<100;i++)softenFabricEdges(a,side,side);
 console.log(side+'x'+side+': '+((performance.now()-start)/100).toFixed(3)+' ms edge fringe (Node CPU)');
}
