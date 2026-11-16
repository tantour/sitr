// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest';
import {videoMaskNeedsProtection as protect,videoMaskPadding} from '../src/media/videoMaskFreshness';
it('bridges short tracking gaps in smooth mode without full-player flashes',()=>{
 const result={capturedAtMs:1000,mediaTimeSec:5};
 for(const age of [40,90,150,250,400,600])expect(protect(result,1000+age,5+age/1000,false,true)).toBe(false);
 expect(videoMaskPadding(result,1090,5.09,false,true)).toBeGreaterThan(0);
 expect(videoMaskPadding(result,1400,5.4,false,true)).toBe(.04);
 expect(videoMaskPadding(result,1090,5.09,true,false)).toBe(0);
 expect(protect(result,1800,5.8,false,true)).toBe(true);
 expect(protect(result,1020,6,false)).toBe(true);
});
it('keeps strict playback explicit and tighter',()=>{
 const result={capturedAtMs:1000,mediaTimeSec:5};
 expect(protect(result,1090,5.09,false,true,'strict')).toBe(true);
 expect(protect(result,1150,5.15,false,false,'strict')).toBe(true);
 expect(protect(result,1150,5.15,true,false,'strict')).toBe(false);
});
