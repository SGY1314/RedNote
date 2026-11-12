import {inspectVisibilityOption} from './visibility-state.mjs';
// Match the option label plus its explanatory text, never a substring of the
// caption. "私密 · 仅自己可见" and "公开 · 所有人可见" are distinct choices.
const names = {
 public: /^公\s*开(?:\s|[·:：,，(（-]|所有人|所有用户|所有观众|任何人|$)/,
 self: /^(?:私\s*密|(?:仅|仅\s*限|只\s*有|只\s*允\s*许|只\s*限)\s*自\s*己(?:\s*可\s*见)?)(?:\s|[·:：,，(（-]|仅自己|只对自己|仅对自己|$)/,
};
const rowName=/^\s*(?:谁\s*可\s*以\s*看|可\s*见\s*范\s*围|谁\s*可\s*见)\s*[:：?？*＊]?\s*$/;
const optionNames = [names.public,/^好\s*友\s*可\s*见(?:\s|[·:：,，(（-]|互关|$)/,names.self];
// Evaluated against rendered DOM only. Stop before a parent contains a second
// privacy choice, so unrelated "同时发布"/"保存权限" radios cannot count.
async function privacyRow(page) {
 const label=page.getByText(rowName).filter({visible:true});
 const count=await label.count();
 if(count>1) throw Error('visibility_ambiguous');
 if(!count) return undefined;
 let row=label;
 for(let depth=0;depth<10;depth++) {
  row=row.locator('..');
  const options=optionNames.map(name=>row.getByText(name).filter({visible:true}));
  const counts=await Promise.all(options.map(o=>o.count()));
  if(counts.some(n=>n>1)) throw Error('visibility_ambiguous');
  // Friend-only visibility is optional and is not offered on every editor.
  // Public and self must both belong to the same labelled setting.
  if(counts[0]===1 && counts[2]===1) return options.map((o,i)=>counts[i]?o:undefined);
 }
 return undefined;
}
async function customControl(page,value) {
 const options=await privacyRow(page);
 if(!options) return undefined;
 const index=value==='public'?0:2;
 return {
  async getAttribute(){return null;},
  async click(args){await options[index].click(args);},
  async isChecked(){
   const evidence=await Promise.all(options.map(o=>o?o.evaluate(inspectVisibilityOption):{state:false}));
   if(evidence.some(e=>e.reason==='conflicting'))throw Error('visibility_ambiguous');
   const states=evidence.map(e=>e.state);
   if(states.filter(s=>s===true).length>1)throw Error('visibility_ambiguous');
   if(states.filter(s=>s===true).length!==1) throw Error('visibility_unverified');
   return states[index]===true;
  },
 };
}
async function controlInScope(page, value) {
 const scoped=await customControl(page,value);
 if(scoped) return scoped;
 const radios = page.getByRole('radio', {name:names[value]});
 const count = await radios.count();
 if(count>1) throw Error('visibility_ambiguous');
 if(count===1) return radios;
 // Native radios can be labelled through <label> while the input is visually hidden.
 const labelled = page.getByLabel(names[value]);
 const labelledCount = await labelled.count();
 if(labelledCount>1) throw Error('visibility_ambiguous');
 if(labelledCount===1 && (await labelled.getAttribute('type')==='radio' || await labelled.getAttribute('role')==='radio')) return labelled;
 return undefined;
}
async function control(page,value) {
 const scopes=editorScopes(page);
 const found=[];
 for(const scope of scopes) {const option=await controlInScope(scope,value);if(option)found.push(option);}
 if(found.length>1)throw Error('visibility_ambiguous');
 return found[0];
}
function editorScopes(page) {
 const scopes=[page];
 // An embedded editor may render settings in its own official document.
 if(typeof page.frames==='function') for(const frame of page.frames()) {
  if(frame===page.mainFrame()) continue;
  try {const u=new URL(frame.url());if(u.protocol==='https:'&&u.hostname==='creator.douyin.com')scopes.push(frame);}catch{}
 }
 return scopes;
}
async function revealSettings(page) {
 for(const scope of editorScopes(page)) {
  for(const name of [rowName,/^\s*发\s*布\s*设\s*置\s*$/]) {
   const anchor=scope.getByText(name).filter({visible:true});
   if(await anchor.count()===1) {
    // Settings below the editor can be mounted only after scrolling into view.
    await anchor.scrollIntoViewIfNeeded({timeout:1500}).catch(()=>{});
    break;
   }
  }
 }
}
async function checked(option) {
 if(!option) return false;
 try { return await option.isChecked(); }
 catch(e) {
  if(e.message==='visibility_ambiguous')throw e;
  const value=await option.getAttribute('aria-checked');
  if(value==='true') return true;
  if(value==='false') return false;
  throw Error('visibility_unverified');
 }
}
export async function readVisibility(page) {
 const selected=[];
 for(const value of ['public','self']) {
  if(await checked(await control(page,value))) selected.push(value);
 }
 if(selected.length!==1) throw Error('visibility_unverified');
 return selected[0];
}
export async function setVisibility(page,value,checkHuman) {
 if(!names[value]) throw Error('visibility_unverified');
 for(let attempt=0;attempt<120;attempt++) {
  await checkHuman(page);
  if(attempt%20===0)await revealSettings(page);
  const option=await control(page,value);
  if(option) {
   let selected=false;
   try {selected=await checked(option);}catch(e){if(e.message!=='visibility_unverified')throw e;}
   if(!selected) {
    // ARIA radios use click; native radios use check. Both require read-back.
    if(await option.getAttribute('type')==='radio') await option.check({timeout:10000});
    else await option.click({timeout:10000});
   }
   for(let read=0;read<20;read++) {
    await checkHuman(page);
    try { if(await readVisibility(page)===value) return; }
    catch(e) { if(e.message!=='visibility_unverified') throw e; }
    await page.waitForTimeout(100);
   }
   throw Error('visibility_unverified');
  }
  await page.waitForTimeout(250);
 }
 throw Error('visibility_control_missing');
}

export async function visibilityDiagnostics(page) {
 const scopes=[];
 for(const scope of editorScopes(page)) {
  try {
   const options=await privacyRow(scope);
   scopes.push({row:!!options,options:options?await Promise.all(options.map(async(o,i)=>({
    option:['public','friends','self'][i],present:!!o,...(o?await o.evaluate(inspectVisibilityOption):{}),
   }))):[]});
  } catch {scopes.push({row:false,error:'inspection_unavailable'});}
 }
 return {schema:1,scopes};
}
