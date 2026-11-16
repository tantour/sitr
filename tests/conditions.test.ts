import {expect,it} from 'vitest';
import {conditionPasses} from '../src/rules/conditions';
import {normalizeSettings,type RuleOperator} from '../src/config/settings';
import {uniformPolicy} from '../src/config/personPolicy';
it('handles exact percentage boundaries and missing areas without negative false positives',()=>{
 const total=new Uint32Array(12),skin=total.slice();total[10]=100;skin[10]=30;
 for(const [operator,expected]of [['above',false],['at-least',true],['below',false],['at-most',true],['any',true],['none',false]] as [RuleOperator,boolean][])
  expect(conditionPasses({areas:['chest'],operator,percent:30},total,skin)).toBe(expected);
 for(const operator of ['above','at-least','below','at-most','any','none'] as const)expect(conditionPasses({areas:['belly'],operator,percent:50},total,skin)).toBe(false);
 skin[10]=0;expect(conditionPasses({areas:['chest'],operator:'none',percent:0},total,skin)).toBe(true);
});
it('validates conditions as a group so malformed AND clauses cannot silently disappear',()=>{
 const male={...uniformPolicy('show'),partThresholds:[{area:'chest',percent:50,target:'part',conditions:[{areas:['chest'],operator:'above',percent:25},{areas:['bad'],operator:'below',percent:50}]}]};
 expect(normalizeSettings({personPolicies:{male}}).personPolicies!.male.partThresholds![0].conditions).toEqual([]);
 male.partThresholds[0].conditions[1].areas=['belly'];
 const saved=normalizeSettings({personPolicies:{male}});expect(saved.personPolicies!.male.partThresholds![0].conditions).toHaveLength(2);expect(normalizeSettings(saved)).toEqual(saved);
});
