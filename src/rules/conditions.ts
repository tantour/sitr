// SPDX-License-Identifier: AGPL-3.0-only
import {BODY_REGIONS,type BodyRegion,type PartThreshold,type RuleCondition} from '../config/settings';
export function ruleConditions(rule:PartThreshold):RuleCondition[]{
  return rule.conditions??[{areas:rule.areas?.length?rule.areas:[rule.area],operator:rule.condition??'above',percent:rule.percent}];
}
export function areaIds(areas:readonly BodyRegion[]):Set<number>{return new Set(areas.flatMap(area=>area==='torso'?[1,10,11]:[BODY_REGIONS.indexOf(area)+1]));}
/** Evaluate every clause against the same person's confidently owned anatomy. */
export function conditionPasses(condition:RuleCondition,total:Uint32Array,skin:Uint32Array):boolean{
  let denominator=0,numerator=0;for(const id of areaIds(condition.areas)){denominator+=total[id];numerator+=skin[id];}
  if(condition.operator==='any')return numerator>0;
  if(denominator<4)return false; // Missing/fragmentary anatomy cannot satisfy a negative test.
  const value=numerator*100,threshold=condition.percent*denominator;
  switch(condition.operator){
    case 'above':return value>threshold;
    case 'at-least':return value>=threshold;
    case 'below':return value<threshold;
    case 'at-most':return value<=threshold;
    case 'none':return numerator===0;
    default:return false;
  }
}
