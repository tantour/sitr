import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const root = process.cwd();
const dist = resolve(root, 'dist');
const concurrent = process.env.SMOKE_CONCURRENT === '1';
const bus = await readFile(resolve(root, 'tests/fixtures/bus.jpg'));
const womanProfile = process.env.SMOKE_PROFILE === '1' ? await readFile(resolve(root, 'tests/fixtures/woman-profile.jpg')) : null;
const clip = await readFile(resolve(root, 'tests/fixtures/bus.mp4'));
const longClip = await readFile(resolve(root, 'tests/fixtures/bus-long.mp4'));
const samplePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/N6kAAAAASUVORK5CYII=';
const server = createServer((request, response) => {
  if (request.url === '/bus.jpg') { response.writeHead(200, { 'content-type': 'image/jpeg' }); response.end(bus); return; }
  if (request.url === '/woman-profile.jpg' && womanProfile) { response.writeHead(200, { 'content-type': 'image/jpeg' }); response.end(womanProfile); return; }
  if (request.url === '/auth.jpg') {
    if (!request.headers.cookie?.includes('image_session=ok')) { response.writeHead(403); response.end(); return; }
    response.writeHead(200, { 'content-type': 'image/jpeg' }); response.end(bus); return;
  }
  if (request.url === '/bus.mp4') { response.writeHead(200, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes' }); response.end(clip); return; }
  if (request.url === '/bus-long.mp4') { response.writeHead(200, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes' }); response.end(longClip); return; }
  if (request.url === '/grid') {
    response.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "default-src 'self' data:; script-src 'none'; object-src 'none'" });
    response.end(`<!doctype html><html><body style="margin:0"><div style="display:grid;grid-template-columns:repeat(3,160px);gap:10px">${Array.from({ length: 24 }, (_, i) => `<img id="grid-${i}" width="160" height="160" src="${samplePng}">`).join('')}</div></body></html>`);
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "default-src 'self' data:; script-src 'none'; object-src 'none'" });
  response.end(`<!doctype html><html><body><img id="sample" width="320" height="320" src="${samplePng}"><img id="bus" width="640" height="420" src="/bus.jpg">${womanProfile ? '<img id="woman-profile" width="640" height="640" src="/woman-profile.jpg">' : ''}<video id="clip" width="640" height="360" muted ${concurrent ? 'autoplay' : ''} ${process.env.SMOKE_LONG_VIDEO === '1' ? '' : 'loop'} playsinline preload="none" src="${process.env.SMOKE_LONG_VIDEO === '1' ? '/bus-long.mp4' : '/bus.mp4'}"></video></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(resolve(tmpdir(), 'local-media-censor-smoke-'));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: 'chromium',
    viewport: { width: 1280, height: 1200 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  const serviceWorkers = [];
  context.on('serviceworker', worker => {
    serviceWorkers.push(worker.url());
    worker.on('console', message => console.log('service worker:', message.text()));
  });
  const page = await context.newPage();
  if (process.env.SMOKE_CPU_SEMANTIC === '1') {
    const extensionWorker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await extensionWorker.evaluate(async () => {
      if (!await chrome.offscreen.hasDocument()) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.WORKERS], justification: 'Browser smoke backend comparison' });
      await chrome.runtime.sendMessage({ type: 'retry-engine', backend: 'cpu' });
    });
  }
  if (process.env.SMOKE_ONNX_WEBGPU === '1') {
    const extensionWorker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await extensionWorker.evaluate(async () => {
      if (!await chrome.offscreen.hasDocument()) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.WORKERS], justification: 'Browser smoke ONNX backend comparison' });
      await chrome.runtime.sendMessage({ type: 'retry-engine', backend: 'webgpu' });
    });
  }
  if (['1', '2', '4'].includes(process.env.SMOKE_ONNX_THREADS || '')) {
    const extensionWorker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await extensionWorker.evaluate(async threads => {
      if (!await chrome.offscreen.hasDocument()) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.WORKERS], justification: 'Browser smoke WASM thread comparison' });
      await chrome.runtime.sendMessage({ type: 'retry-engine', threads });
    }, Number(process.env.SMOKE_ONNX_THREADS));
  }
  if (process.env.SMOKE_FACE === '1' || process.env.SMOKE_PERFORMANCE === '1' || process.env.SMOKE_LABEL === '1' || process.env.SMOKE_VIDEO_LABEL === '1') {
    const extensionWorker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await extensionWorker.evaluate(async flags => {
      const current = (await chrome.storage.local.get('settings')).settings || {};
      await chrome.storage.local.set({ settings: { ...current,
        ...(flags.face ? { faceAssociation: true } : {}),
        ...(flags.performance ? { performance: 'performance' } : {}),
        ...(flags.manualLabel ? { automaticGender: false } : {}),
        revision: (current.revision || 0) + 1 } });
    }, { face: process.env.SMOKE_FACE === '1', performance: process.env.SMOKE_PERFORMANCE === '1',
      manualLabel: process.env.SMOKE_LABEL === '1' || process.env.SMOKE_VIDEO_LABEL === '1' });
  }
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  if (process.env.SMOKE_GENDER === '1') {
    await page.evaluate(async () => {
      const source = document.querySelector('#bus');
      await source.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 1280; canvas.height = 960;
      const context = canvas.getContext('2d');
      const crops = [[20, 390, 220, 220], [215, 390, 200, 220]];
      for (let i = 0; i < 10; i++) {
        const col = i % 4, row = Math.floor(i / 4);
        const crop = crops[i % crops.length];
        context.drawImage(source, ...crop, col * 320, row * 320, 320, 320);
      }
      const group = document.createElement('img');
      group.id = 'group10'; group.width = 640; group.height = 480;
      group.src = canvas.toDataURL('image/jpeg', 0.97);
      document.body.append(group);
    });
  }
  if (process.env.SMOKE_AUTH === '1') {
    await page.evaluate(() => {
      document.cookie = 'image_session=ok; path=/';
      const image = document.createElement('img'); image.id = 'auth'; image.width = 640; image.height = 420; image.src = '/auth.jpg'; document.body.append(image);
    });
  }
  if (process.env.SMOKE_MANY === '1') {
    await page.evaluate(() => {
      const source = document.querySelector('#sample').src;
      for (let i = 0; i < 12; i++) {
        const image = document.createElement('img'); image.className = 'extra'; image.width = 32; image.height = 32; image.src = source; document.body.append(image);
      }
    });
  }
  if (process.env.SMOKE_WEBP === '1') {
    await page.evaluate(async () => {
      const source = document.querySelector('#bus');
      await source.decode();
      const canvas = document.createElement('canvas'); canvas.width = source.naturalWidth; canvas.height = source.naturalHeight;
      canvas.getContext('2d').drawImage(source, 0, 0);
      const image = document.createElement('img'); image.id = 'webp'; image.width = 640; image.height = 420;
      image.src = canvas.toDataURL('image/webp'); document.body.append(image);
    });
  }
  const initial = await page.locator('#sample').evaluate(img => ({ protected: img.hasAttribute('data-local-media-censor-pending'), filter: getComputedStyle(img).filter }));
  await page.waitForTimeout(process.env.SMOKE_QUICK === '1' ? 30000 : 18000);
  if (!concurrent && process.env.SMOKE_QUICK !== '1') await page.locator('#clip').evaluate(video => video.play());
  let videoSamples;
  if (process.env.SMOKE_SUSTAINED === '1') {
    videoSamples = await page.evaluate(() => new Promise(resolve => {
      const samples = [];
      const timer = setInterval(() => {
        const video = document.querySelector('#clip');
        samples.push({ protected: video.hasAttribute('data-local-media-censor-pending'), status: video.getAttribute('data-local-media-censor-status'),
          latency: Number(video.getAttribute('data-local-media-censor-latency-ms')), sequence: Number(video.getAttribute('data-local-media-censor-sequence')),
          captureSequence: Number(video.getAttribute('data-local-media-censor-capture-sequence')),
          motionFrames: Number(video.getAttribute('data-local-media-censor-motion-frames')),
          motionMs: Number(video.getAttribute('data-local-media-censor-motion-ms')),
          motionWorkerMs: Number(video.getAttribute('data-local-media-censor-motion-worker-ms')),
          sceneCuts: Number(video.getAttribute('data-local-media-censor-scene-cuts')),
          errors: Number(video.getAttribute('data-local-media-censor-video-errors')),
          currentTime: video.currentTime, totalVideoFrames: video.getVideoPlaybackQuality().totalVideoFrames });
        if (samples.length === 100) { clearInterval(timer); resolve(samples); }
      }, 100);
    }));
  } else if (process.env.SMOKE_QUICK !== '1') await page.waitForTimeout(10000);
  const final = await page.locator('#sample').evaluate(img => ({ protected: img.hasAttribute('data-local-media-censor-pending'), filter: getComputedStyle(img).filter, status: img.getAttribute('data-local-media-censor-status'), overlays: document.querySelectorAll('[data-local-media-censor-overlay]').length }));
  const busState = await page.locator('#bus').evaluate(img => {
    const canvas = document.querySelector('canvas[data-local-media-censor-for="bus"]');
    const context = canvas?.getContext('2d');
    const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data;
    let maskedPixels = 0;
    if (pixels) for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) maskedPixels++;
    return { protected: img.hasAttribute('data-local-media-censor-pending'), status: img.getAttribute('data-local-media-censor-status'), maskedPixels,
      acquireMs: img.getAttribute('data-local-media-censor-acquire-ms'), latencyMs: img.getAttribute('data-local-media-censor-latency-ms'), timingsMs: img.getAttribute('data-local-media-censor-timings-ms'), gender: img.getAttribute('data-local-media-censor-gender') };
  });
  const videoState = await page.locator('#clip').evaluate(video => ({ protected: video.hasAttribute('data-local-media-censor-pending'), status: video.getAttribute('data-local-media-censor-status'), latencyMs: video.getAttribute('data-local-media-censor-latency-ms'), timingsMs: video.getAttribute('data-local-media-censor-timings-ms'), gender: video.getAttribute('data-local-media-censor-gender'), sequence: video.getAttribute('data-local-media-censor-sequence'), captureSequence: video.getAttribute('data-local-media-censor-capture-sequence'), captureMs: video.getAttribute('data-local-media-censor-capture-ms'), motionError: video.getAttribute('data-local-media-censor-motion-error'), errors: video.getAttribute('data-local-media-censor-video-errors'), lastError: video.getAttribute('data-local-media-censor-last-error'), currentTime: video.currentTime, readyState: video.readyState }));
  const motionFrame = page.frames().find(frame => frame.url().endsWith('/motion.html'));
  const motionHost = motionFrame ? await motionFrame.evaluate(() => ({ ...document.body.dataset })) : null;
  console.log(JSON.stringify({ initial, final, busState, videoState, motionHost, errors, frames: page.frames().map(frame => frame.url()), serviceWorkers: serviceWorkers.concat(context.serviceWorkers().map(worker => worker.url())) }, null, 2));
  if (videoSamples) {
    const protectedSamples = videoSamples.filter(sample => !sample.protected).length;
    const sortedLatency = videoSamples.map(sample => sample.latency).filter(Number.isFinite).sort((a, b) => a - b);
    const sortedMotion = videoSamples.map(sample => sample.motionMs).filter(Number.isFinite).sort((a, b) => a - b);
    const sortedMotionWorker = videoSamples.map(sample => sample.motionWorkerMs).filter(Number.isFinite).sort((a, b) => a - b);
    console.log('Sustained video:', { visibleSamples: protectedSamples, totalSamples: videoSamples.length,
      p95LatencyMs: sortedLatency[Math.floor(sortedLatency.length * 0.95)], statuses: [...new Set(videoSamples.map(sample => sample.status))],
      propagatedSamples: videoSamples.filter(sample => sample.status === 'propagated').length,
      protectedIndices: videoSamples.flatMap((sample, index) => sample.protected ? [index] : []),
      motionFramesDelta: videoSamples.at(-1).motionFrames - videoSamples[0].motionFrames,
      p95MotionMs: sortedMotion[Math.floor(sortedMotion.length * 0.95)], p95MotionWorkerMs: sortedMotionWorker[Math.floor(sortedMotionWorker.length * 0.95)], sceneCutsDelta: videoSamples.at(-1).sceneCuts - videoSamples[0].sceneCuts,
      uniqueSequences: [...new Set(videoSamples.map(sample => sample.sequence))], videoFramesDelta: videoSamples.at(-1).totalVideoFrames - videoSamples[0].totalVideoFrames,
      captureSequenceDelta: videoSamples.at(-1).captureSequence - videoSamples[0].captureSequence,
      errorDelta: videoSamples.at(-1).errors - videoSamples[0].errors,
      firstTime: videoSamples[0].currentTime, lastTime: videoSamples.at(-1).currentTime });
    if (videoSamples.at(-1).motionFrames - videoSamples[0].motionFrames < 50) throw new Error('Display-frame motion tracking did not run');
  }
  if (!initial.protected) throw new Error('Initial protection did not appear');
  if (process.env.SMOKE_PROFILE === '1') {
    await page.locator('#woman-profile').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('#woman-profile')?.dataset.localMediaCensorGender);
    const side = await page.locator('#woman-profile').evaluate(image => ({ status: image.dataset.localMediaCensorStatus,
      gender: JSON.parse(image.dataset.localMediaCensorGender) }));
    const status = await (context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')).evaluate(async base => {
      const tab = (await chrome.tabs.query({})).find(item => item.url?.startsWith(base));
      return tab?.id ? await chrome.tabs.sendMessage(tab.id, { type: 'get-local-status' }, { frameId: 0 }) : null;
    }, `http://127.0.0.1:${server.address().port}/`);
    console.log('Side-facing woman end-to-end:', side, status);
    if (side.gender.faces < 1 || side.gender.associated < 1 || side.gender.accepted < 1 || (status?.female ?? 0) < 1) {
      throw new Error('Side-facing woman was not labelled female end-to-end');
    }
  }
  if (final.protected || final.status !== 'protected') throw new Error('No-person image failed to resolve');
  const busGender = busState.gender ? JSON.parse(busState.gender) : null;
  const expectedMaleExemption = busGender?.accepted >= 2 && busState.status === 'protected';
  if (!['protected', 'uncertain-person', 'unassigned-region'].includes(busState.status) || busState.protected ||
      (!expectedMaleExemption && busState.maskedPixels === 0)) throw new Error('Multi-person image did not reach a valid protected or exempt state');
  if (process.env.SMOKE_GENDER === '1') {
    await page.waitForTimeout(process.env.SMOKE_QUICK === '1' ? 15000 : 25000);
    const group = await page.locator('#group10').evaluate(image => ({
      status: image.dataset.localMediaCensorStatus,
      gender: JSON.parse(image.dataset.localMediaCensorGender),
      diagnostics: image.dataset.localMediaCensorGender,
      pending: image.hasAttribute('data-local-media-censor-pending'),
      protected: image.hasAttribute('data-local-media-censor-pending'),
    }));
    console.log('Ten-person automatic gender fixture:', group);
    if (group.gender?.people < 10 || group.gender?.faces < 10 || group.gender?.associated < 10 || group.gender?.attempted < 10 || group.gender?.accepted < 10) {
      throw new Error('The ten-person frame did not produce ten automatic person labels');
    }
  }
  if (process.env.SMOKE_STATUS === '1') {
    const extensionWorker = context.serviceWorkers()[0];
    const status = await extensionWorker.evaluate(async base => {
      const tab = (await chrome.tabs.query({})).find(item => item.url?.startsWith(base));
      if (!tab?.id) throw new Error('Fixture tab unavailable');
      return await chrome.tabs.sendMessage(tab.id, { type: 'get-local-status' }, { frameId: 0 });
    }, `http://127.0.0.1:${server.address().port}/`);
    console.log('Popup page status:', status);
    if (status.detected < 2 || status.labelled + status.unlabelled !== status.detected) {
      throw new Error('Detected people were not correctly reported as classified or unclassified');
    }
    if (process.env.SMOKE_GENDER === '1' && (status.male < 2 || status.automatic < 2)) {
      throw new Error('Two male person tracks were not automatically labelled');
    }
    const popup = await context.newPage();
    await popup.goto(new URL('popup.html', extensionWorker.url()).href);
    await page.bringToFront();
    await popup.reload();
    await popup.waitForFunction(() => document.querySelector('#pageStatus')?.textContent?.includes('detected people:'), undefined, { timeout: 5000 });
    console.log('Popup text:', await popup.locator('#version').textContent(), await popup.locator('#pageStatus').textContent());
    if (await popup.locator('#unknown option[value="allow"]').textContent() !== 'Allow unclassified people') {
      throw new Error('Popup does not distinguish detected from unclassified people');
    }
    await popup.getByText('Advanced AI thresholds').click();
    if (await popup.locator('input[type="range"]').count() !== 13) throw new Error('Popup is missing a model resolution or advanced AI threshold control');
    const confidenceControl = popup.locator('#faceDetectionConfidence');
    await confidenceControl.evaluate(input => { input.value = '0.60'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
    await popup.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings.faceDetectionConfidence === 0.6);
    await confidenceControl.evaluate(input => { input.value = '0.55'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
    await popup.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings.faceDetectionConfidence === 0.55);
    if (process.env.SMOKE_THREAD_SETTING === '1') {
      const threadControl = popup.locator('#onnxThreads');
      await threadControl.selectOption('8');
      await popup.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings.onnxThreads === 8);
      await page.waitForFunction(() => {
        const image = document.querySelector('#bus');
        if (image?.hasAttribute('data-local-media-censor-pending')) return false;
        try { return JSON.parse(image?.getAttribute('data-local-media-censor-timings-ms') || '{}').onnxThreads === 8; }
        catch { return false; }
      }, undefined, { timeout: 30000 });
      console.log('Popup thread setting reprocessed the bus image with eight ONNX threads.');
      await threadControl.selectOption('auto');
      await popup.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings.onnxThreads === 'auto');
    }
    if (process.env.SMOKE_RESOLUTION === '1') {
      const changeSlider = async (id, index) => {
        await popup.locator(`#${id}`).evaluate((input, value) => {
          input.value = String(value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }, index);
        await popup.waitForFunction(async ({ id, value }) => (await chrome.storage.local.get('settings')).settings[id] === value,
          { id, value: { yoloImageSize: ['auto', 256, 320, 416], yoloVideoSize: ['auto', 256, 320, 416],
            yunetSize: [256, 320, 416], faceCaptureSize: [320, 416, 512, 640] }[id][index] });
      };
      await changeSlider('yoloImageSize', 3);
      await changeSlider('yunetSize', 0);
      await changeSlider('faceCaptureSize', 0);
      await page.waitForFunction(() => {
        const image = document.querySelector('#bus');
        if (image?.hasAttribute('data-local-media-censor-pending')) return false;
        try {
          const timing = JSON.parse(image?.getAttribute('data-local-media-censor-timings-ms') || '{}');
          return timing.yoloSize === 416 && timing.yunetSize === 256 && timing.faceCaptureSize === 320 && timing.faceRun > 0;
        } catch { return false; }
      }, undefined, { timeout: 60000 });
      console.log('Resolution controls reprocessed the bus image at YOLO 416, YuNet 256, face capture 320.');
      await changeSlider('yunetSize', 2);
      await page.waitForFunction(() => {
        const image = document.querySelector('#bus');
        if (image?.hasAttribute('data-local-media-censor-pending')) return false;
        try {
          const timing = JSON.parse(image?.getAttribute('data-local-media-censor-timings-ms') || '{}');
          return timing.yunetSize === 416 && timing.faceRun > 0;
        } catch { return false; }
      }, undefined, { timeout: 60000 });
      console.log('YuNet 416 reprocessed the bus image.');
      await changeSlider('yoloVideoSize', 3);
      await page.locator('#clip').evaluate(video => video.play());
      await page.waitForFunction(() => {
        try { return JSON.parse(document.querySelector('#clip')?.getAttribute('data-local-media-censor-timings-ms') || '{}').yoloSize === 416; }
        catch { return false; }
      }, undefined, { timeout: 60000 });
      console.log('YOLO video 416 analyzed a playing frame.');
    }
    await popup.close();
  }
  if (process.env.SMOKE_SCROLL === '1') {
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'scroll-host';
      Object.assign(host.style, { position: 'relative', overflow: 'auto', height: '240px', width: '660px' });
      const spacer = document.createElement('div'); spacer.style.height = '300px';
      host.append(spacer, document.querySelector('#bus'));
      document.body.append(host);
      window.dispatchEvent(new Event('scroll'));
    });
    await page.waitForFunction(() => {
      const image = document.querySelector('#bus');
      return image.parentElement.querySelector('canvas[data-local-media-censor-overlay]');
    }, undefined, { timeout: 3000 });
    const alignment = await page.evaluate(() => {
      const host = document.querySelector('#scroll-host');
      const image = document.querySelector('#bus');
      const overlay = host.querySelector('canvas[data-local-media-censor-overlay]');
      host.scrollTop = 180;
      const a = image.getBoundingClientRect();
      const b = overlay.getBoundingClientRect();
      return { dx: Math.abs(a.x - b.x), dy: Math.abs(a.y - b.y), dw: Math.abs(a.width - b.width), dh: Math.abs(a.height - b.height) };
    });
    console.log('Immediate nested-scroll overlay alignment:', alignment);
    if (Object.values(alignment).some(error => error > 1)) throw new Error('Overlay lagged behind nested scrolling');
  }
  if (process.env.SMOKE_AUTH === '1') {
    await page.waitForFunction(() => {
      const image = document.querySelector('#auth');
      return image && !image.hasAttribute('data-local-media-censor-pending') && image.getAttribute('data-local-media-censor-status') === 'protected';
    }, undefined, { timeout: 30000 });
    console.log('Cookie-protected same-origin image was analyzed and revealed.');
  }
  if (process.env.SMOKE_MANY === '1') {
    await page.waitForFunction(() => [...document.querySelectorAll('.extra')].every(image => !image.hasAttribute('data-local-media-censor-pending') && image.getAttribute('data-local-media-censor-status') === 'protected'), undefined, { timeout: 60000 });
    console.log('All 12 queued images were analyzed and revealed.');
  }
  if (process.env.SMOKE_WEBP === '1') {
    console.log('WebP diagnostic:', await page.locator('#webp').evaluate(async image => {
      const blob = await (await fetch(image.src)).blob();
      let decoder = 'unavailable';
      if ('ImageDecoder' in window) {
        const d = new ImageDecoder({ data: await blob.arrayBuffer(), type: blob.type });
        try { await d.tracks.ready; decoder = JSON.stringify({ frameCount: d.tracks.selectedTrack?.frameCount, animated: d.tracks.selectedTrack?.animated }); }
        catch (error) { decoder = String(error); }
        finally { d.close(); }
      }
      return { status: image.getAttribute('data-local-media-censor-status'), type: blob.type, size: blob.size, decoder };
    }));
    await page.waitForFunction(() => {
      const image = document.querySelector('#webp');
      return image && !image.hasAttribute('data-local-media-censor-pending') && image.getAttribute('data-local-media-censor-status') === 'protected';
    }, undefined, { timeout: 30000 });
    console.log('Static WebP image was analyzed and revealed.');
  }
  if (process.env.SMOKE_SOURCE === '1') {
    await page.evaluate(() => { document.querySelector('#bus').src = document.querySelector('#sample').src; });
    await page.waitForFunction(() => document.querySelector('#bus')?.hasAttribute('data-local-media-censor-pending'), undefined, { timeout: 3000 });
    await page.waitForFunction(() => {
      const img = document.querySelector('#bus');
      return img && !img.hasAttribute('data-local-media-censor-pending') && img.getAttribute('data-local-media-censor-status') === 'protected';
    }, undefined, { timeout: 20000 });
    console.log('Source replacement reanalyzed and revealed the new no-person image.');
  }
  if (process.env.SMOKE_SETTINGS === '1') {
    const extensionWorker = context.serviceWorkers()[0];
    await extensionWorker.evaluate(async () => {
      const current = (await chrome.storage.local.get('settings')).settings;
      await chrome.storage.local.set({ settings: { ...current, filter: 'off', highExposure: false, revision: current.revision + 1 } });
    });
    await page.waitForFunction(() => {
      const img = document.querySelector('#bus');
      return img && !img.hasAttribute('data-local-media-censor-pending') && img.getAttribute('data-local-media-censor-status') === 'off';
    }, undefined, { timeout: 15000 });
    console.log('Cached analysis accepted the updated label-filter policy.');
  }
  if (process.env.SMOKE_LABEL === '1') {
    const extensionWorker = context.serviceWorkers()[0];
    await extensionWorker.evaluate(async base => {
      const tab = (await chrome.tabs.query({})).find(item => item.url?.startsWith(base));
      if (!tab?.id) throw new Error('Fixture tab unavailable');
      await chrome.tabs.sendMessage(tab.id, { type: 'start-label' });
    }, `http://127.0.0.1:${server.address().port}/`);
    console.log('Label pointer mode:', await page.locator('canvas[data-local-media-censor-for="bus"]').evaluate(canvas => canvas.style.pointerEvents));
    const point = await page.locator('canvas[data-local-media-censor-for="bus"]').evaluate(canvas => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let best = { distance: Infinity, x: 0, y: 0 };
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        if (!data[(y * canvas.width + x) * 4 + 3]) continue;
        const distance = (x - canvas.width / 2) ** 2 + (y - canvas.height / 2) ** 2;
        if (distance < best.distance) best = { distance, x, y };
      }
      const rect = canvas.getBoundingClientRect();
      return { x: best.x * rect.width / canvas.width, y: best.y * rect.height / canvas.height };
    });
    await page.locator('canvas[data-local-media-censor-for="bus"]').click({ position: point });
    const menu = page.locator('[data-local-media-censor-label-menu]');
    try { await menu.waitFor({ timeout: 2000 }); }
    catch {
      console.log('Label click diagnostic:', point, await page.locator('#bus').getAttribute('data-local-media-censor-status'));
      throw new Error('Track menu did not appear after clicking a masked pixel');
    }
    await menu.locator('select').nth(1).selectOption('male');
    await menu.locator('button').click();
    await page.waitForTimeout(1500);
    const labelled = await page.locator('canvas[data-local-media-censor-for="bus"]').evaluate(canvas => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]) count++;
      return count;
    });
    console.log(`Explicit male label changed bus mask pixels from ${busState.maskedPixels} to ${labelled}.`);
    if (labelled >= busState.maskedPixels) throw new Error('Explicit label did not exempt the selected track');
    if (process.env.SMOKE_STATUS === '1') {
      const status = await extensionWorker.evaluate(async base => {
        const tab = (await chrome.tabs.query({})).find(item => item.url?.startsWith(base));
        return await chrome.tabs.sendMessage(tab.id, { type: 'get-local-status' }, { frameId: 0 });
      }, `http://127.0.0.1:${server.address().port}/`);
      console.log('Page status after male label:', status);
      if (status.labelled < 1) throw new Error('Assigned male label was not reported');
    }
  }
  if (process.env.SMOKE_VIDEO_LABEL === '1') {
    const extensionWorker = context.serviceWorkers()[0];
    await extensionWorker.evaluate(async base => {
      const tab = (await chrome.tabs.query({})).find(item => item.url?.startsWith(base));
      if (!tab?.id) throw new Error('Fixture tab unavailable');
      await chrome.tabs.sendMessage(tab.id, { type: 'start-label' });
    }, `http://127.0.0.1:${server.address().port}/`);
    const videoOverlay = page.locator('canvas[data-local-media-censor-for="clip"]');
    const countMask = async () => await videoOverlay.evaluate(canvas => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]) count++;
      return count;
    });
    const beforeLabel = await countMask();
    const point = await videoOverlay.evaluate(canvas => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let best = { distance: Infinity, x: 0, y: 0 };
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        if (!data[(y * canvas.width + x) * 4 + 3]) continue;
        const distance = (x - canvas.width / 2) ** 2 + (y - canvas.height / 2) ** 2;
        if (distance < best.distance) best = { distance, x, y };
      }
      const rect = canvas.getBoundingClientRect();
      return { x: best.x * rect.width / canvas.width, y: best.y * rect.height / canvas.height };
    });
    await videoOverlay.click({ position: point });
    const menu = page.locator('[data-local-media-censor-label-menu]');
    await menu.waitFor({ timeout: 3000 });
    await menu.locator('select').nth(1).selectOption('male');
    await menu.locator('button').click();
    await page.waitForFunction(() => document.querySelector('#clip')?.dataset.localMediaCensorLabelOutcome === 'applied', undefined, { timeout: 5000 });
    await page.waitForTimeout(1500);
    const afterLabel = await countMask();
    await page.waitForTimeout(1500);
    const laterLabel = await countMask();
    console.log('Playing-video male label mask pixels:', { beforeLabel, afterLabel, laterLabel });
    if (afterLabel >= beforeLabel || laterLabel >= beforeLabel) throw new Error('Playing-video male label did not retain an exemption');
  }
  if (process.env.SMOKE_PAUSE === '1') {
    await page.waitForFunction(() => !document.querySelector('#clip')?.hasAttribute('data-local-media-censor-pending'), undefined, { timeout: 5000 });
    const paused = await page.locator('#clip').evaluate(video => {
      video.pause();
      return { protected: video.hasAttribute('data-local-media-censor-pending'), status: video.dataset.localMediaCensorStatus };
    });
    if (paused.protected) throw new Error('Pausing a masked video caused a full-black flash');
    console.log('Pausing a masked video kept its previous mask visible.');
  }
  if (process.env.SMOKE_GRID === '1') {
    await page.setViewportSize({ width: 800, height: 480 });
    await page.addInitScript(() => {
      window.__gridCompletion = [];
      window.__gridCompletedAt = [];
      const seen = new Set();
      new MutationObserver(records => {
        for (const record of records) {
          const image = record.target;
          if (image.id?.startsWith('grid-') && image.getAttribute('data-local-media-censor-status') === 'protected' && !seen.has(image.id)) {
            seen.add(image.id);
            window.__gridCompletion.push(image.id);
            window.__gridCompletedAt.push(performance.now());
          }
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-local-media-censor-status'] });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/grid`);
    await page.waitForFunction(() => [0, 1, 2].every(i => document.querySelector(`#grid-${i}`)?.getAttribute('data-local-media-censor-status') === 'protected'), undefined, { timeout: 45000 });
    const before = await page.evaluate(() => ({
      firstRow: [0, 1, 2].map(i => document.querySelector(`#grid-${i}`)?.getAttribute('data-local-media-censor-status')),
      belowViewportAnalyzed: [...document.querySelectorAll('img')].slice(12).filter(img => img.hasAttribute('data-local-media-censor-sequence')).length,
      completionOrder: window.__gridCompletion.slice(0, 3),
      firstRowElapsedMs: Math.round(window.__gridCompletedAt[2] - window.__gridCompletedAt[0]),
    }));
    if (before.completionOrder.join(',') !== 'grid-0,grid-1,grid-2') throw new Error(`Visible grid processing order was ${before.completionOrder.join(',')}`);
    if (before.belowViewportAnalyzed) throw new Error('Offscreen grid images were analyzed before scrolling');
    await page.evaluate(() => window.scrollTo(0, 800));
    await page.waitForFunction(() => document.querySelector('#grid-18')?.getAttribute('data-local-media-censor-status') === 'protected', undefined, { timeout: 45000 });
    await page.evaluate(() => document.querySelector('#grid-0').remove());
    await page.waitForFunction(() => !document.querySelector('canvas[data-local-media-censor-for="grid-0"]'), undefined, { timeout: 3000 });
    console.log('Viewport grid:', before, 'grid-18 processed after scrolling.');
  }
} finally {
  await context?.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
