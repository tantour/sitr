import type { Label, Settings } from '../config/settings';

export interface FrameKey { mediaSessionId: string; epoch: number; sequence: number }
export interface Rect { x: number; y: number; width: number; height: number }
export interface FramePacket {
  key: FrameKey;
  kind: 'image' | 'video';
  mediaTimeSec?: number;
  acquisitionStartedAtMs?: number;
  capturedAtMs: number;
  width: number;
  height: number;
  rgba: Uint8Array;
  faceRgba?: Uint8Array;
  faceSize?: number;
}
export interface PersonDetection {
  box: Rect;
  score: number;
  mask: Float32Array;
  maskWidth: number;
  maskHeight: number;
}
export interface Track {
  id: string;
  box: Rect;
  mask: Float32Array;
  maskWidth: number;
  maskHeight: number;
  score: number;
  firstSeen: number;
  lastSeen: number;
  hits: number;
  state: 'tentative' | 'active' | 'lost' | 'ambiguous';
  label: Label;
  labelUsable: boolean;
  labelSource: 'none' | 'automatic' | 'user';
  genderConfidence: number;
  genderEvidence: number;
  identityGeneration: number;
  velocityX: number;
  velocityY: number;
}
export interface Exposure { ratio: number; reliable: boolean; ownedPixels: number; ambiguousFraction: number }
export interface TrackObservation {
  id: string;
  box: Rect;
  label: Label;
  labelUsable: boolean;
  exposure: Exposure;
  ownedMask: Uint8Array;
  bodySkinMask: Uint8Array;
  hairMask: Uint8Array;
  faceSkinMask: Uint8Array;
  state: Track['state'];
}
export interface AnalysisResult {
  key: FrameKey;
  width: number;
  height: number;
  mediaTimeSec?: number;
  acquisitionStartedAtMs?: number;
  capturedAtMs: number;
  analyzedAtMs: number;
  settingsRevision: number;
  black: boolean;
  reason: string;
  rgbaMask: Uint8Array;
  staticMask?: Uint8Array;
  trackMasks?: Array<{ id: string; alpha: Uint8Array }>;
  tracks: Array<{ id: string; box: Rect; label: Label; labelUsable: boolean; labelSource: Track['labelSource']; genderConfidence: number; exposure: Exposure }>;
  faceAssociations?: Array<{ faceIndex: number; trackId?: string; ambiguous: boolean }>;
  debugPersonMasks?: Array<{ id: string; box: Rect; mask: Uint8Array; width: number; height: number; label: Label; labelUsable: boolean; labelSource: Track['labelSource']; genderConfidence: number }>;
  debugFaces?: Array<{ box: Rect; score: number; trackId?: string; ambiguous: boolean }>;
  genderDiagnostics?: { people?: number; faces: number; associated: number; attempted: number; accepted: number; error?: string };
  timingsMs?: { acquire: number; queue?: number; modelInit: number; person: number; personPreprocess: number; personRun: number; personDecode: number;
    semantic: number; tracking: number; face: number; gender: number; composition: number; render: number;
    semanticPreprocess?: number; semanticRun?: number; semanticDecode?: number;
    facePreprocess?: number; faceRun?: number; faceDecode?: number;
    genderPreprocess?: number; genderRun?: number; genderDecode?: number;
    total: number; backend: string; faceBackend?: string; genderBackend?: string; semanticBackend: string;
    yoloSize?: number; yunetSize?: number; faceCaptureSize?: number;
    onnxThreads?: number; semanticParallel?: boolean; isolated: boolean };
}
export type WorkerInput =
  | { type: 'backend'; semantic: 'auto' | 'cpu'; onnx: 'wasm' | 'webgpu'; threads?: number; parallelSemantic: boolean }
  | { type: 'warm'; size: number; faces: boolean; gender: boolean }
  | { type: 'analyze'; frame: FramePacket; settings: Settings }
  | { type: 'settings'; key: FrameKey; settings: Settings }
  | { type: 'label'; key: FrameKey; trackId: string; label: Label; settings: Settings }
  | { type: 'reset'; mediaSessionId: string; epoch: number };
export type WorkerOutput =
  | { type: 'result'; result: AnalysisResult }
  | { type: 'error'; key?: FrameKey; message: string; stage?: 'semantic' }
  | { type: 'ready' };
