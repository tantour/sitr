// SPDX-License-Identifier: AGPL-3.0-only
import type {AnalysisResult} from '../state/contracts';
type MaskTiming=Pick<AnalysisResult,'capturedAtMs'|'mediaTimeSec'>;
function maskAge(result:MaskTiming,now:number,mediaTime:number):number{
  return Math.max(now-result.capturedAtMs,result.mediaTimeSec===undefined?0:Math.abs(mediaTime-result.mediaTimeSec)*1000);
}
/** Smooth playback bridges short tracking gaps locally; strict keeps its tighter cutoff. */
export function videoMaskNeedsProtection(result:MaskTiming,now:number,mediaTime:number,aligned:boolean,lost=false,playback:'smooth'|'strict'='smooth'):boolean{
  const age=maskAge(result,now,mediaTime);
  return playback==='strict'?(age>40&&lost||age>120&&!aligned):age>650&&!aligned;
}
/** A small body-relative margin bridges uncertainty without blacking the whole player. */
export function videoMaskPadding(result:MaskTiming,now:number,mediaTime:number,aligned:boolean,lost=false):number{
  const age=maskAge(result,now,mediaTime);
  return lost||!aligned&&age>80?Math.max(0,Math.min(.04,(age-40)/3000)):0;
}
