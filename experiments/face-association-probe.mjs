import { chromium } from 'playwright';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';

const root = process.cwd();
const imagePath = process.argv[2];
if (!imagePath) throw new Error('Usage: node experiments/face-association-probe.mjs IMAGE_PATH');
const bytes = await readFile(imagePath);
const encoded = bytes.toString('base64');
const profile = await mkdtemp(resolve(tmpdir(), 'face-association-probe-'));
let browser;
let server;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`] });
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
  const page = await browser.newPage();
  await page.goto(new URL('popup.html', worker.url()).href);
  const result = await page.evaluate(async base64 => {
    const { YoloPersonSegmenter, OptionalFaceDetector, associateFaces } = await import(chrome.runtime.getURL('person-runtime.js'));
    const image = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([image], { type: 'image/png' }));
    const capture = side => {
      const canvas = new OffscreenCanvas(side, side);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.fillStyle = '#000';
      context.fillRect(0, 0, side, side);
      const scale = Math.min(side / bitmap.width, side / bitmap.height);
      context.drawImage(bitmap, (side - bitmap.width * scale) / 2, (side - bitmap.height * scale) / 2,
        bitmap.width * scale, bitmap.height * scale);
      return new Uint8Array(context.getImageData(0, 0, side, side).data);
    };
    const faceDetector = new OptionalFaceDetector('wasm', 2, 320);
    await faceDetector.initialize();
    const faces = (await faceDetector.detect(capture(640), 640)).filter(face => face.score >= 0.55 && face.box.width * 640 >= 8);
    const results = [];
    for (const side of [320, 416]) {
      const detector = new YoloPersonSegmenter(side, 'wasm', 2);
      await detector.initialize();
      const detections = await detector.segment(capture(side), 0.1);
      const tracks = detections.map((detection, index) => ({ ...detection, id: String(index) }));
      const associated = associateFaces(faces, tracks, side);
      const details = faces.map(face => tracks.map(track => {
        const { x, y, width, height } = face.box;
        const count = (x0, y0, x1, y1, threshold) => {
          let covered = 0, area = 0;
          for (let py = Math.max(0, Math.floor(y0 * side)); py < Math.min(side, Math.ceil(y1 * side)); py++)
            for (let px = Math.max(0, Math.floor(x0 * side)); px < Math.min(side, Math.ceil(x1 * side)); px++) {
              area++;
              if (track.mask[py * side + px] >= threshold) covered++;
            }
          return area ? +(covered / area).toFixed(3) : 0;
        };
        const cx = x + width / 2, cy = y + height / 2;
        const box = track.box;
        const cxPixel = Math.floor(cx * side), cyPixel = Math.floor(cy * side);
        const noseX = Math.floor(face.nose.x * side), noseY = Math.floor(face.nose.y * side);
        return { id: track.id, score: +track.score.toFixed(3), center: track.mask[cyPixel * side + cxPixel]?.toFixed(2),
          nose: track.mask[noseY * side + noseX]?.toFixed(2), core: count(x + width * .25, y + height * .25,
          x + width * .75, y + height * .75, .35), strong: count(x + width * .25, y + height * .25,
          x + width * .75, y + height * .75, .65), shoulder: count(x - width * .15, y + height * .65,
          x + width * 1.15, y + height * 1.55, .35), boxHead: cx >= box.x && cx <= box.x + box.width &&
          cy >= box.y - Math.max(height * .75, box.height * .18) && cy <= box.y + box.height * .58 };
      }).filter(item => item.core > 0 || item.shoulder > 0 || item.boxHead));
      results.push({ side, detections: detections.map(detection => ({ box: detection.box, score: detection.score })),
        faces: faces.map((face, index) => ({ index, box: face.box, score: face.score, nose: face.nose,
          association: associated[index], withoutNose: associateFaces([{ ...face, nose: undefined }], tracks, side)[0],
          candidates: details[index] })) });
      await detector.dispose();
    }
    await faceDetector.dispose();
    bitmap.close();
    return results;
  }, encoded);
  console.log('DIRECT', JSON.stringify(result.map(item => ({ side: item.side, people: item.detections.length,
    faces: item.faces.length, associated: item.faces.filter(face => !face.association.ambiguous).length,
    assignments: item.faces.map(face => face.association.trackId ?? null) }))));
  if (process.env.PROBE_DETAILS === '1') console.log(JSON.stringify(result, null, 2));
  server = createServer((request, response) => {
    if (request.url === '/image.png') {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(bytes);
    } else {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<img id="sample" width="612" height="409" src="/image.png">');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  for (const side of [320, 416]) {
    await page.evaluate(async side => chrome.runtime.sendMessage({ type: 'set-settings',
      patch: { yoloImageSize: side, faceAssociation: true, imageGenderModel: 'face', debugOverlay: true } }), side);
    const live = await browser.newPage();
    await live.goto(`http://127.0.0.1:${server.address().port}/`);
    await live.waitForFunction(() => {
      const value = document.querySelector('#sample')?.getAttribute('data-local-media-censor-gender');
      return value && JSON.parse(value).faces > 0;
    }, null, { timeout: 60_000 });
    const state = await live.locator('#sample').evaluate(image => ({
      status: image.getAttribute('data-local-media-censor-status'),
      gender: JSON.parse(image.getAttribute('data-local-media-censor-gender') || 'null'),
    }));
    console.log('LIVE', side, JSON.stringify(state));
    await live.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server?.close(resolve) ?? resolve());
  await rm(profile, { recursive: true, force: true });
}
