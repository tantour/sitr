// SPDX-License-Identifier: AGPL-3.0-only
import {afterEach,expect,it,vi} from 'vitest';
import {FrameMotion} from '../src/media/frameMotionClient';
import type {AnalysisResult} from '../src/state/contracts';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
function harness(){
 vi.useFakeTimers();vi.setSystemTime(1000);
 const port={postMessage:vi.fn(),onmessage:undefined as any};
 const host={src:'',style:{},setAttribute:vi.fn(),isConnected:true,contentWindow:{postMessage:vi.fn()},onload:undefined as any};
 vi.stubGlobal('document',{createElement:()=>host,documentElement:{appendChild:vi.fn()}});
 vi.stubGlobal('chrome',{runtime:{getURL:()=> 'chrome-extension://test/motion.html'}});
 vi.stubGlobal('MessageChannel',class{port1=port;port2={};});
 const motion=new FrameMotion(()=>{});host.onload();port.onmessage({data:{type:'connected'}});
 const result=(sequence:number,x=.2)=>({key:{sequence},capturedAtMs:1000,tracks:[{id:'p',box:{x,y:.2,width:.3,height:.5}}],trackMasks:[{id:'p'}]}) as unknown as AnalysisResult;
 const receive=(sequence:number,at:number,x:number,source='frame')=>{
  vi.setSystemTime(at);port.onmessage({data:{type:'motion',source,generation:0,at,frames:1,sequence,reliable:true,reliableIds:['p'],offsets:[['p',{x,y:0}]]}});
 };
 return{motion,result,receive};
}
it('shows measured movement immediately and does not extrapolate twice when masks rebase',()=>{
 const {motion,result,receive}=harness();motion.align(result(1));
 receive(1,1000,0);receive(1,1030,.03);
 expect(motion.offsets(1030).get('p')!.x).toBeCloseTo(.03);
 vi.setSystemTime(1040);motion.align(result(2,.23));
 expect(motion.offsets(1040).get('p')!.x).toBeCloseTo(.01);
 // An already-queued old-anchor reply cannot overwrite the new offset.
 receive(1,1045,.2);expect(motion.offsets(1045).get('p')!.x).toBeLessThan(.025);
 receive(2,1050,.02,'align');receive(2,1060,.03);
 // Velocity is continuous across the rebase, measured in frame coordinates.
 expect(motion.offsets(1070).get('p')!.x).toBeCloseTo(.04,2);
});
it('expires propagation when observations or the analyzed pose become old',()=>{
 const {motion,result,receive}=harness(),anchor=result(1);motion.align(anchor);receive(1,1050,.03);
 expect(motion.canPropagate(anchor,1100)).toBe(true);
 expect(motion.canPropagate(anchor,1160)).toBe(false);
 receive(1,1290,.04);expect(motion.canPropagate(anchor,1300)).toBe(false);
});
