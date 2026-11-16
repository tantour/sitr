import {expect,it} from 'vitest';
import {personExpansion} from '../src/rendering/expansion';
import {DEFAULT_SETTINGS,normalizeSettings} from '../src/config/settings';
it('scales with each body rather than source or analysis resolution',()=>{
 const near={x:.1,y:.1,width:.3,height:.8},far={x:.1,y:.1,width:.075,height:.2};
 expect(personExpansion(5,400,near)).toBe(16);expect(personExpansion(5,400,far)).toBe(4);
 expect(personExpansion(5,800,near)/800).toBe(personExpansion(5,400,near)/400);
 expect(personExpansion(0,400,near)).toBe(0);
 expect(personExpansion(5,400,{x:0,y:0,width:.8,height:.3})).toBe(16);
});
it('migrates old pixel settings once, keeps fractional percentages and clips visible bounds',()=>{
 const migrated=normalizeSettings({schemaVersion:20,imageExpansion:2,videoExpansion:4,videoSkinExpansion:8});
 expect([migrated.imageExpansion,migrated.videoExpansion,migrated.videoSkinExpansion]).toEqual([1,2,4]);
 expect(normalizeSettings(migrated)).toEqual(migrated);
 expect(normalizeSettings({...DEFAULT_SETTINGS,imageExpansion:1.25}).imageExpansion).toBe(1.25);
 expect(personExpansion(5,400,{x:-1,y:-1,width:3,height:3})).toBe(20);
});
