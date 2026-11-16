// SPDX-License-Identifier: AGPL-3.0-only
import {BODY_REGIONS,type BodyRegion,type PartThreshold,type RuleCondition,type RuleOperator,type Settings} from '../config/settings';
import {editablePolicies,genderPolicy} from '../config/personPolicy';
import {ruleConditions} from '../rules/conditions';
import {t,number} from './localization';
type Control=HTMLButtonElement|HTMLSelectElement|HTMLInputElement;
const OPERATORS:[RuleOperator,string][]=[['above','Above'],['at-least','At least'],['below','Below'],['at-most','At most'],['any','Any skin'],['none','No skin']];
export function initializeRulesEditor(get:()=>Settings,save:(patch:Partial<Settings>,control:Control)=>Promise<boolean>,gender:()=> 'female'|'male',names:Record<string,string>,setGender:(value:'female'|'male')=>void){
  const list=document.getElementById('rulesList')!,add=document.getElementById('addCustomRule') as HTMLButtonElement;
  const genderSelect=document.getElementById('rulesGenderSelect') as HTMLSelectElement;
  genderSelect.onchange=()=>setGender(genderSelect.value as 'female'|'male');
  let busy=false,rendered=false;
  const areaName=(area:BodyRegion)=>t(area==='torso'?'Torso (chest + belly)':names[area]);
  const describe=(clause:RuleCondition)=>`${clause.areas.map(areaName).join(' + ')}: ${t(OPERATORS.find(([operator])=>operator===clause.operator)?.[1]??'Above')}${['any','none'].includes(clause.operator)?'':' '+number(clause.percent)+'%'}`;
  const refresh=()=>{
    if(!get())return;
    const rules=genderPolicy(get(),gender()).partThresholds??[],previousCount=list.querySelectorAll('details.advanced-rule').length;
    const opened=new Set(Array.from(list.querySelectorAll<HTMLDetailsElement>('details.advanced-rule[open]')).map(row=>Number(row.dataset.ruleIndex)));
    const focused=document.activeElement as HTMLElement|null,focusIndex=focused?.closest<HTMLElement>('[data-rule-index]')?.dataset.ruleIndex,focusKey=focused?.dataset.ruleKey;
    list.replaceChildren();add.disabled=rules.length>=32;
    genderSelect.value=gender();
    document.getElementById('rulesGender')!.textContent=t('Rules: {count}',{count:number(rules.length)});
    if(!rules.length){const empty=document.createElement('p');empty.className='setting-hint';empty.textContent=t('No custom rules. Add a rule, choose conditions, then choose what to cover.');list.append(empty);}
    rules.forEach((rule,index)=>{
      const row=document.createElement('details');row.className='advanced-rule';row.dataset.ruleIndex=String(index);row.open=opened.has(index)||(rendered&&index===previousCount&&previousCount<rules.length);
      const clauses=ruleConditions(rule),summary=document.createElement('summary');
      const expression=clauses.map(describe).join(' '+t(rule.match==='any'?'OR':'AND')+' ');
      summary.textContent=`${number(index+1)}. ${rule.name?t(rule.name):expression||t('New rule')} - ${t(rule.effect==='smart'?'Smart clothing':'Black')}${rule.enabled===false?' - '+t('Off'):''}`;row.append(summary);
      const update=(patch:Partial<PartThreshold>,control:Control)=>{const next=structuredClone(rules);next[index]={...rule,...patch};void commit(next,control);};
      const label=(parent:HTMLElement,text:string,control:HTMLElement)=>{const wrap=document.createElement('label');wrap.className='setting-field';const span=document.createElement('span');span.textContent=t(text);wrap.append(span,control);parent.append(wrap);};
      const select=(parent:HTMLElement,text:string,key:string,options:[string,string][],value:string,onchange:(value:string,control:HTMLSelectElement)=>void)=>{
        const el=document.createElement('select');el.dataset.ruleKey=key;for(const [v,text]of options)el.add(new Option(t(text),v));el.value=value;el.onchange=()=>onchange(el.value,el);label(parent,text,el);return el;
      };
      const button=(parent:HTMLElement,text:string,key:string,click:(control:HTMLButtonElement)=>void)=>{const el=document.createElement('button');el.type='button';el.textContent=t(text);el.dataset.ruleKey=key;el.onclick=()=>click(el);parent.append(el);return el;};
      const areaPicker=(parent:HTMLElement,areas:BodyRegion[],key:string,change:(areas:BodyRegion[],control:Control)=>void)=>{
        select(parent,'Area',key,BODY_REGIONS.map(area=>[area,areaName(area)] as [string,string]).concat([['combined','Combined areas']]),areas.length>1?'combined':areas[0]??'chest',(value,control)=>{
          change(value==='combined'?[areas[0]??'chest',BODY_REGIONS.find(area=>area!=='torso'&&area!==(areas[0]??'chest'))!]:[value as BodyRegion],control);
        });
        if(areas.length>1){const field=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=t('Combined area');field.className='rule-areas';field.append(legend);
          BODY_REGIONS.forEach(area=>{const wrap=document.createElement('label'),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=areas.includes(area);checkbox.dataset.ruleKey=key+'-'+area;checkbox.onchange=()=>{const next=BODY_REGIONS.filter(a=>a===area?checkbox.checked:areas.includes(a));if(!next.length){checkbox.checked=true;return;}change(next,checkbox);};wrap.append(checkbox,document.createTextNode(areaName(area)));field.append(wrap);});parent.append(field);
        }
      };
      const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=rule.enabled!==false;enabled.dataset.ruleKey='enabled';enabled.onchange=()=>update({enabled:enabled.checked},enabled);label(row,'Enabled',enabled);
      const name=document.createElement('input');name.type='text';name.maxLength=80;name.value=rule.name??'';name.dataset.ruleKey='name';name.onchange=()=>update({name:name.value.trim()},name);label(row,'Rule name (optional)',name);
      const when=document.createElement('fieldset');when.className='rule-section';const legend=document.createElement('legend');legend.textContent=t('If');when.append(legend);row.append(when);
      select(when,'Match','match',[['all','All conditions (AND)'],['any','Any condition (OR)']],rule.match??'all',(match,control)=>update({conditions:clauses,match:match as 'all'|'any'},control));
      clauses.forEach((clause,conditionIndex)=>{
        const group=document.createElement('fieldset');group.className='rule-condition';group.dataset.conditionIndex=String(conditionIndex);const heading=document.createElement('legend');heading.textContent=t('Condition {number}',{number:number(conditionIndex+1)});group.append(heading);when.append(group);
        const change=(patch:Partial<RuleCondition>,control:Control)=>{const next=structuredClone(clauses);next[conditionIndex]={...clause,...patch};update({conditions:next},control);};
        areaPicker(group,clause.areas,'area-'+conditionIndex,(areas,control)=>change({areas},control));
        select(group,'Skin amount','operator-'+conditionIndex,OPERATORS,clause.operator,(operator,control)=>change({operator:operator as RuleOperator},control));
        if(!['any','none'].includes(clause.operator)){const input=document.createElement('input');input.type='number';input.min='0';input.max='100';input.step='1';input.value=String(clause.percent);input.dataset.ruleKey='percent-'+conditionIndex;input.onchange=()=>{if(input.checkValidity()&&Number.isFinite(input.valueAsNumber))change({percent:input.valueAsNumber},input);else input.reportValidity();};label(group,'Skin percentage (%)',input);}
        if(clauses.length>1)button(group,'Remove condition','remove-condition-'+conditionIndex,control=>update({conditions:clauses.filter((_,i)=>i!==conditionIndex)},control));
      });
      const append=button(when,'Add condition','add-condition',control=>update({conditions:[...clauses,{areas:['chest'],operator:'above',percent:50}]},control));append.disabled=clauses.length>=8;
      const then=document.createElement('fieldset');then.className='rule-section';const thenLegend=document.createElement('legend');thenLegend.textContent=t('Then');then.append(thenLegend);row.append(then);
      select(then,'Cover','target',[['part','Entire areas'],['skin','Exposed skin only'],['body','Entire body']],rule.target,(target,control)=>update({target:target as PartThreshold['target']},control));
      if(rule.target!=='body'){
        select(then,'Areas to cover','coverage-source',[['conditions','Areas used in conditions'],['custom','Choose different areas']],rule.coverAreas?.length?'custom':'conditions',(value,control)=>update({coverAreas:value==='custom'?[clauses[0]?.areas[0]??'chest']:undefined},control));
        if(rule.coverAreas?.length)areaPicker(then,rule.coverAreas,'cover-area',(areas,control)=>update({coverAreas:areas},control));
      }
      select(then,'Effect','effect',[['black','Black'],['smart','Smart clothing']],rule.effect??'black',(effect,control)=>update({effect:effect as PartThreshold['effect']},control));
      if(rule.target==='body')select(then,'Face when body threshold triggers','face',[['black','Black'],['show','Show']],rule.face??'black',(face,control)=>update({face:face as 'black'|'show'},control));
      const hint=document.createElement('p');hint.className='setting-hint';hint.textContent=t('Rules add coverage. For conditional-only coverage, set the regular area choice to Show. Hair stays black.');row.append(hint);
      const actions=document.createElement('div');actions.className='rule-add';row.append(actions);
      const duplicate=button(actions,'Duplicate rule','duplicate',control=>{if(rules.length<32)void commit([...rules,structuredClone(rule)],control);});duplicate.disabled=rules.length>=32;
      button(actions,'Remove rule','remove',control=>{void commit(rules.filter((_,i)=>i!==index),control);});list.append(row);
    });rendered=true;
    if(focusIndex!==undefined&&focusKey)list.querySelector<HTMLElement>(`[data-rule-index="${focusIndex}"] [data-rule-key="${focusKey}"]`)?.focus({preventScroll:true});
  };
  const commit=async(rules:PartThreshold[],control:Control)=>{
    if(busy){refresh();return;}busy=true;const policies=editablePolicies(get());policies[gender()].partThresholds=rules;
    try{await save({personPolicies:policies,imageCoverage:'regions',imageBodyRegionMode:get().imageBodyRegionMode==='off'?'faster':get().imageBodyRegionMode},control);}finally{busy=false;refresh();}
  };
  add.onclick=()=>{const rules=genderPolicy(get(),gender()).partThresholds??[];if(rules.length<32)void commit([...rules,{area:'chest',percent:50,conditions:[{areas:['chest'],operator:'above',percent:50}],match:'all',target:'part',effect:'black',enabled:true}],add);};
  return{refresh};
}
