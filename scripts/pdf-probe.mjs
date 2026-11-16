// SPDX-License-Identifier: AGPL-3.0-only
import {chromium} from 'playwright';import {createServer} from 'node:http';import {readFile,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';import {resolve,sep} from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const cache=resolve('.cache');await mkdir(cache,{recursive:true});const profile=await mkdtemp(resolve(cache,'pdf-probe-'));const photo=await readFile('tests/fixtures/bus.jpg');let pdfBytes;
const server=createServer((req,res)=>{if(req.url==='/book.pdf'){res.setHeader('content-type','application/pdf');res.setHeader('access-control-allow-origin','*');res.setHeader('content-length',pdfBytes.length);res.write(pdfBytes.subarray(0,1024));setTimeout(()=>res.end(pdfBytes.subarray(1024)),2200);return;}res.end('PDF test');});await new Promise(r=>server.listen(0,'127.0.0.1',r));let context;
function makePDF(scan){const objects=[null,Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),null,Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')];const add=data=>{objects.push(Buffer.isBuffer(data)?data:Buffer.from(data));return objects.length-1;};const stream=(header,data)=>Buffer.concat([Buffer.from(`<< ${header} /Length ${data.length} >>\nstream\n`),data,Buffer.from('\nendstream')]);
const image=add(stream('/Type /XObject /Subtype /Image /Width 810 /Height 1080 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode',photo));const scanned=add(stream('/Type /XObject /Subtype /Image /Width 600 /Height 800 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode',scan));const kids=[];
for(let p=1;p<=12;p++){let content=p===2?'q 600 0 0 800 0 0 cm /Scan Do Q':`BT /F1 18 Tf 45 755 Td (Textbook page ${p}) Tj ET\nBT /F1 12 Tf 45 720 Td (Selectable text above two separate photographs.) Tj ET\nq 165 0 0 220 55 430 cm /Photo Do Q\nq 165 0 0 220 335 135 cm /Photo Do Q`;
 const c=add(stream('',Buffer.from(content)));kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> /XObject << /Photo ${image} 0 R /Scan ${scanned} 0 R >> >> /Contents ${c} 0 R >>`));}
objects[2]=Buffer.from(`<< /Type /Pages /Count ${kids.length} /Kids [${kids.map(n=>n+' 0 R').join(' ')}] >>`);const parts=[Buffer.from('%PDF-1.7\n')],offsets=[0];let size=parts[0].length;
for(let n=1;n<objects.length;n++){offsets.push(size);const part=Buffer.concat([Buffer.from(`${n} 0 obj\n`),objects[n],Buffer.from('\nendobj\n')]);parts.push(part);size+=part.length;}const xref=size;parts.push(Buffer.from(`xref\n0 ${objects.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`));return Buffer.concat(parts);}
try{
 context=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium',viewport:{width:1365,height:900},args:[`--disable-extensions-except=${resolve('dist')}`,`--load-extension=${resolve('dist')}`]});
 console.log('Chrome',context.browser().version());const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),ui=await context.newPage();await ui.goto(new URL('popup.html',sw.url()).href);
 await ui.evaluate(()=>chrome.runtime.sendMessage({type:'set-settings',patch:{pdfs:true,images:true,automaticGender:false,filter:'both',imageCoverage:'whole-body',fabricFill:true}}));
 const scan=Buffer.from(await ui.evaluate(async bytes=>{const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],{type:'image/jpeg'})),c=document.createElement('canvas');c.width=600;c.height=800;const g=c.getContext('2d');g.fillStyle='white';g.fillRect(0,0,600,800);g.fillStyle='black';g.font='18px Arial';g.fillText('Scanned textbook page',35,45);g.font='11px Arial';for(let i=0;i<9;i++)g.fillText('This is a line of textbook text, with paragraphs and captions.',35,80+i*15);g.drawImage(bitmap,55,270,165,220);g.drawImage(bitmap,335,535,165,220);bitmap.close();return c.toDataURL('image/jpeg',.95).split(',')[1];},photo.toString('base64')),'base64');pdfBytes=makePDF(scan);await writeFile(resolve(cache,'textbook.pdf'),pdfBytes);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('pageerror',e.message);});page.on('console',m=>{if(m.type()==='error')console.log('console',m.text().slice(0,250));});
 const url=new URL('pdf.html',sw.url());url.searchParams.set('src',`http://127.0.0.1:${server.address().port}/book.pdf`);await page.goto(url.href);
 const diag=()=>page.evaluate(()=>({body:{...document.body.dataset},status:document.querySelector('#status').textContent,error:document.querySelector('#errorDetail').textContent,pages:[...document.querySelectorAll('.pdf-page')].filter(p=>p.dataset.pdfRendered==='true'||p.dataset.pdfError||p.dataset.pdfFatal).map(p=>({...p.dataset}))}));
 await page.waitForFunction(()=>Number(document.body.dataset.pdfAnalyzedRegions)>=3,null,{timeout:60000}).catch(async e=>{console.log(await diag());throw e;});
 let first=await diag();assert(Number(first.body.pdfRenderedPages)<=2,'Offscreen pages must not render eagerly');
 await page.locator('#showRegions').check();assert.equal(await page.locator('[data-page="1"] .image-region').count(),2,'Find embedded picture boxes separately');
 assert((await page.locator('[data-page="1"] .textLayer').innerText()).includes('Textbook page 1'),'Keep digital text selectable');
 await page.locator('#pageNumber').fill('2');await page.locator('#pageNumber').press('Enter');await page.locator('#pageNumber').press('Tab');
 await page.waitForFunction(()=>{const p=document.querySelector('[data-page="2"]');return p?.dataset.pdfRendered==='true'&&Number(p.dataset.pdfAnalyzed)>1;},null,{timeout:45000}).catch(async e=>{console.log(await diag());throw e;});
 const scannedCount=await page.locator('[data-page="2"] .image-region').count();assert.equal(scannedCount,2,'Find both scanned pictures without treating the paragraph as a photo');
 // Add an image box on the visible page using the actual drawing tool.
 await page.locator('#drawRegion').click();const bounds=await page.locator('[data-page="2"]').boundingBox();await page.mouse.move(bounds.x+50,bounds.y+150);await page.mouse.down();await page.mouse.move(bounds.x+190,bounds.y+250,{steps:4});await page.mouse.up();
 assert.equal(await page.locator('[data-page="2"] .image-region').count(),scannedCount+1);await page.locator('#drawRegion').click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Visible pictures checked'),null,{timeout:45000});
 await mkdir('.impeccable/review',{recursive:true});await page.screenshot({path:'.impeccable/review/pdf-reader-desktop.png'});
 await page.locator('#pageNumber').fill('3');await page.locator('#pageNumber').press('Enter');await page.locator('#pageNumber').press('Tab');
 await page.waitForFunction(()=>(document.body.dataset.pdfReadyPages||'').split(',').includes('3'),null,{timeout:45000});
 for(const n of [1,2])assert.equal(await page.locator(`[data-page="${n}"]`).getAttribute('data-pdf-rendered'),'true','Retain the previous two pages');
 // Moving far down the book must release old rendering resources.
 await page.locator('#pageNumber').fill('10');await page.locator('#pageNumber').press('Enter');await page.locator('#pageNumber').press('Tab');
 await page.waitForFunction(()=>document.querySelector('[data-page="10"]')?.dataset.pdfRendered==='true',null,{timeout:30000});
 for(const n of [6,12]){await page.locator('#pageNumber').fill(String(n));await page.locator('#pageNumber').press('Enter');await page.locator('#pageNumber').press('Tab');await page.waitForFunction(n=>document.querySelector(`[data-page="${n}"]`)?.dataset.pdfRendered==='true',n,{timeout:30000});}
 await page.locator('#pageNumber').fill('2');await page.locator('#pageNumber').press('Enter');await page.locator('#pageNumber').press('Tab');await page.waitForFunction(()=>document.querySelector('[data-page="2"]')?.dataset.pdfRendered==='true',null,{timeout:30000});
 assert.equal(await page.locator('[data-page="2"] .image-region[data-kind="manual"]').count(),1,'Keep manual boxes after page-cache eviction');
 await page.locator('#pageNumber').fill('10');await page.locator('#pageNumber').press('Enter');await page.locator('#pageNumber').press('Tab');await page.waitForFunction(()=>document.querySelector('[data-page="10"]')?.dataset.pdfRendered==='true',null,{timeout:30000});
 await page.waitForFunction(()=>[10,11,12].every(n=>(document.body.dataset.pdfReadyPages||'').split(',').includes(String(n))),null,{timeout:90000});
 const final=await diag();assert(Number(final.body.pdfCachedPages)<=7);assert(Number(final.body.pdfCacheBytes)<256*1024*1024);assert(!final.pages.some(p=>p.pdfFatal||p.pdfError),JSON.stringify(final));
 await page.setViewportSize({width:600,height:850});await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Visible pictures checked'),null,{timeout:30000});assert.equal(await page.locator('#pageNumber').inputValue(),'10');await page.screenshot({path:'.impeccable/review/pdf-reader-narrow.png'});
 const native=await context.newPage();await native.goto(`http://127.0.0.1:${server.address().port}/book.pdf`);
 await native.waitForTimeout(2500);console.log('native frames',native.frames().map(f=>f.url()));
 const handler=native.frames().find(f=>f.url().includes('/pdf.html'));
 if(handler){await handler.waitForFunction(()=>Number(document.body.dataset.pdfAnalyzedRegions)>0,null,{timeout:45000});console.log('PASS: Chrome MIME handler opened protected PDF at its original URL.');}
 else if(Number(context.browser().version().split('.')[0])>=151)assert.fail('Chrome did not route the PDF to its registered handler');
 const local=await context.newPage();await local.goto(pathToFileURL(resolve(cache,'textbook.pdf')).href);await local.waitForTimeout(1500);
 const localHandler=local.frames().find(f=>f.url().includes('/pdf.html'));if(Number(context.browser().version().split('.')[0])>=151)assert(localHandler,'Local PDFs should use the protected MIME handler');
 if(localHandler){await localHandler.waitForFunction(()=>Number(document.body.dataset.pdfAnalyzedRegions)>0,null,{timeout:45000});console.log('PASS: local file PDF handling without file-URL access permission.');}
 await ui.evaluate(()=>chrome.runtime.sendMessage({type:'set-settings',patch:{pdfs:false}}));
 const options=await ui.evaluate(()=>chrome.mimeHandler?.getMimeHandlerOptions('application/pdf'));if(options)assert.equal(options.enabled,false);
 await ui.evaluate(()=>chrome.runtime.sendMessage({type:'set-settings',patch:{pdfs:true}}));
 assert.deepEqual(errors,[]);console.log('PASS: local PDF rendering, embedded and scanned picture boxes, visible-only processing, selectable text, manual boxes, and bounded page cache.',JSON.stringify({first:first.body,final:final.body,scannedCount}));
}catch(error){throw error;}finally{await context?.close();await new Promise(r=>server.close(r));assert(profile.startsWith(cache+sep));await rm(profile,{recursive:true,force:true});}
