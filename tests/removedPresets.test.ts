import {expect,it} from 'vitest';
import {normalizeSettings} from '../src/config/settings';
import {uniformPolicy} from '../src/config/personPolicy';
it('removes saved modesty presets while retaining manually created rules',()=>{
 const custom={area:'belly',percent:35,target:'skin',effect:'smart',conditions:[{areas:['belly'],operator:'above',percent:35}]};
 const rules=['modesty-gaps','modesty-chest','modesty-torso','modesty-swimwear','modesty-legs-arms'].map(presetKey=>({...custom,presetKey}));
 const settings=normalizeSettings({personPolicies:{female:{...uniformPolicy('show'),partThresholds:[...rules,custom]},male:{...uniformPolicy('show'),partThresholds:[custom]}}});
 expect(settings.personPolicies!.female.partThresholds).toHaveLength(1);expect(settings.personPolicies!.male.partThresholds).toHaveLength(1);
 expect(settings.personPolicies!.female.partThresholds![0].conditions![0].percent).toBe(35);
 expect(normalizeSettings(settings)).toEqual(settings);
});
