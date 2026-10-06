// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
let worker: Worker | undefined;
let workerError = '';
try { worker = new Worker(chrome.runtime.getURL('motion-worker.js')); }
catch (error) { workerError = String(error); }
document.body.dataset.motionHost = worker ? 'worker-created' : workerError;
worker?.addEventListener('message', event => { if (event.data?.type === 'ready') document.body.dataset.motionWorkerReady = 'true'; });
worker?.addEventListener('error', event => { document.body.dataset.motionWorkerError = event.message || 'Worker error'; });
let port: MessagePort | undefined;

window.addEventListener('message', event => {
  if (event.source !== window.parent || event.data?.type !== 'connect' || !event.ports[0] || port) return;
  port = event.ports[0];
  document.body.dataset.motionHost = 'connected';
  if (!worker) { port.postMessage({ type: 'error', message: workerError || 'Motion worker unavailable' }); return; }
  port.onmessage = incoming => {
    const message = incoming.data;
    if (!['frame', 'align', 'reset'].includes(message?.type)) return;
    document.body.dataset.motionMessages = String(Number(document.body.dataset.motionMessages || 0) + 1);
    try {
      if (message.type === 'frame') worker?.postMessage(message, [message.frame]);
      else worker?.postMessage(message);
    } catch (error) {
      message.frame?.close?.();
      port?.postMessage({ type: 'error', message: String(error) });
    }
  };
  worker.onmessage = result => {
    document.body.dataset.motionReplies = String(Number(document.body.dataset.motionReplies || 0) + 1);
    document.body.dataset.motionReplyType = result.data?.type || 'unknown';
    port?.postMessage(result.data);
  };
  worker.onerror = error => { document.body.dataset.motionWorkerError = error.message || 'Worker error'; port?.postMessage({ type: 'error', message: error.message }); };
  port.start();
  port.postMessage({ type: 'connected' });
});
