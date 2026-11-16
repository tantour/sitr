import { expect, it } from 'vitest';
import { LatestVideoFrame } from '../src/media/latestVideoFrame';
import type { FramePacket } from '../src/state/contracts';
const frame=(sequence:number):FramePacket=>({key:{mediaSessionId:'video',epoch:1,sequence},kind:'video',capturedAtMs:sequence,width:1,height:1,rgba:new Uint8Array(4)});
it('keeps only the newest decoded frame and consumes it once',()=>{const queue=new LatestVideoFrame();queue.offer(frame(1));queue.offer(frame(2));expect(queue.take('video',1,3)?.key.sequence).toBe(2);expect(queue.take('video',1,3)).toBeUndefined();});
it('drops old-source, old-epoch and old-capture work',()=>{for(const [session,epoch,now]of [['other',1,5],['video',2,5],['video',1,200]] as const){const queue=new LatestVideoFrame();queue.offer(frame(1));expect(queue.take(session,epoch,now)).toBeUndefined();}});
it('reset and paused frames cannot replay a queued mask',()=>{const queue=new LatestVideoFrame();queue.offer(frame(1));queue.clear();expect(queue.take('video',1,2)).toBeUndefined();queue.offer({...frame(2),paused:true});expect(queue.take('video',1,3)).toBeUndefined();});
