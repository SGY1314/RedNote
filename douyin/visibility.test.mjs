import test from 'node:test';
import assert from 'node:assert/strict';
import {readVisibility,setVisibility,visibilityDiagnostics} from './visibility.mjs';
import {publicFailure} from './errors.mjs';
function fixture({labels=['公开 所有人可见','私密 仅自己可见'],selected=0,native=true,labelOnly=false,delay=0,noChange=false}={}) {
 let ticks=0;const clicks=[];
 const options=labels.map((name,i)=>({name,selected:i===selected}));
 const locator=matches=>({
  async count(){return ticks>=delay?matches.length:0;},
  async getAttribute(key){return key==='type'?(native?'radio':null):key==='role'?'radio':key==='aria-checked'?String(matches[0].selected):null;},
  async isChecked(){return matches[0].selected;},
  async check(){clicks.push(matches[0].name);if(!noChange)options.forEach(x=>x.selected=x===matches[0]);},
  async click(){return this.check();},
 });
 const page={
  getByText(){return {filter(){return this;},async count(){return 0;}};},
  getByRole(role,{name}){assert.equal(role,'radio');return locator(labelOnly?[]:options.filter(x=>name.test(x.name)));},
  getByLabel(name){return locator(options.filter(x=>name.test(x.name)));},
  async waitForTimeout(){ticks++;},
 };
 return {page,clicks,options};
}
const human=async()=>{};
test('public option with explanatory text is read and not clicked when already selected',async()=>{
 const f=fixture();await setVisibility(f.page,'public',human);
 assert.equal(await readVisibility(f.page),'public');assert.equal(f.clicks.length,0);
});
test('private aliases work for both native and ARIA radios and are read back',async()=>{
 for(const native of [true,false])for(const label of ['私密 仅自己可见','仅自己可见','私密仅自己可见']) {
  const f=fixture({native,labels:['公开 · 所有人可见',label,'好友可见'],delay:2});
  await setVisibility(f.page,'self',human);assert.equal(await readVisibility(f.page),'self');assert.deepEqual(f.clicks,[label]);
  await setVisibility(f.page,'public',human);assert.equal(await readVisibility(f.page),'public');
 }
});
test('labelled native inputs can be located without a radio accessibility name',async()=>{
 const f=fixture({labelOnly:true});await setVisibility(f.page,'self',human);assert.equal(await readVisibility(f.page),'self');
});
test('missing, duplicate, unknown and unapplied selections fail instead of assuming public',async()=>{
 await assert.rejects(setVisibility(fixture({labels:['好友可见']}).page,'public',human),/visibility_control_missing/);
 await assert.rejects(setVisibility(fixture({labels:['公开','公开 所有人可见']}).page,'public',human),/visibility_ambiguous/);
 await assert.rejects(readVisibility(fixture({selected:-1}).page),/visibility_unverified/);
 await assert.rejects(setVisibility(fixture({noChange:true}).page,'self',human),/visibility_unverified/);
 const both=fixture();both.options[1].selected=true;await assert.rejects(readVisibility(both.page),/visibility_unverified/);
 const f=fixture();await assert.rejects(setVisibility(f.page,'self',async()=>{throw Error('human_required')}),/human_required/);assert.equal(f.clicks.length,0);
 assert.equal(publicFailure(Error('visibility_unverified'),'visibility').error,'visibility_unverified');
});

function customFixture({selected=0,ambiguous=false,mode='class',texts=['公开','好友可见','仅自己可见'],rowText='谁可以看',depth=1,lazy=false}={}) {
 const clicks=[];
 let revealed=!lazy;
 function node(text='',children=[],classes=[]) {
  const n={children,classList:classes,parentElement:null,attrs:{},
   get textContent(){return text+children.map(c=>c.textContent).join('');},
   querySelectorAll(){return children.flatMap(c=>[c,...c.querySelectorAll('*')]);},
   getAttribute(k){return this.attrs[k]??null;},hasAttribute(k){return k in this.attrs;},
   matches(selector){return selector.includes('[role="radio"]')&&this.attrs.role==='radio';},
  };children.forEach(c=>c.parentElement=n);return n;
 }
 const labels=texts.map(s=>node(s));
 const icons=labels.map(()=>node());
 const wrappers=labels.map((label,i)=>node('',[icons[i],label]));
 const group=node('',wrappers);
 function select(index){icons.forEach((icon,i)=>{
  icon.classList=mode==='class'?['radioIcon',i===index?'radioSelected':'radio']:['active','focused'];
  if(mode==='aria')icon.attrs={role:'radio','aria-checked':String(i===index)};
 });}
 select(selected);
 const options=labels.map((label,i)=>({
  filter(){return this;},async count(){return 1;},async evaluate(fn){return fn(label);},
  async click(){clicks.push(label.textContent);select(i);},
 }));
 const absent={filter(){return this;},async count(){return 0;}};
 const row={getByText(name){return revealed?options[labels.findIndex(l=>name.test(l.textContent))]||absent:absent;},locator(){return this;}};
 let nested=row;for(let i=1;i<depth;i++){const parent=nested;nested={getByText(){return absent;},locator(){return parent;}};}
 // Other selected publishing settings sit outside this smallest privacy row.
 node('',[group,node('允许',[],['checked']),node('立即发布',[],['checked'])]);
 const page={getByText(text){if(!text.test(rowText))return absent;return {
  filter(){return this;},async count(){return ambiguous?2:1;},locator(){return nested;},
  async scrollIntoViewIfNeeded(){revealed=true;},
 }},async waitForTimeout(){}};
 return {page,clicks,icons,labels,wrappers};
}
test('scoped custom privacy controls read checked classes and ARIA, excluding adjacent settings',async()=>{
 for(const mode of ['class','aria']) {
  const f=customFixture({mode});
  await setVisibility(f.page,'public',human);assert.deepEqual(f.clicks,[]);
  await setVisibility(f.page,'self',human);assert.equal(await readVisibility(f.page),'self');
  assert.deepEqual(f.clicks,['仅自己可见']);
  await setVisibility(f.page,'public',human);assert.equal(await readVisibility(f.page),'public');
 }
});
test('privacy row allows optional friends, descriptive labels, split text and deeper wrappers',async()=>{
 for(const texts of [['公开','仅自己可见'],['公 开 · 所有人可见','只 有自己可见'],['公开','私密 · 仅自己可见']]) {
  const f=customFixture({texts,rowText:'谁 可以 看：',depth:7});
  await setVisibility(f.page,'public',human);assert.deepEqual(f.clicks,[]);
  await setVisibility(f.page,'self',human);assert.equal(await readVisibility(f.page),'self');
  assert.deepEqual(f.clicks,[texts[1]]);
 }
});
test('embedded official settings are read while unrelated frames are ignored and duplicate settings rejected',async()=>{
 const page=fixture({labels:[]}).page;
 const f=customFixture({texts:['公开','仅自己可见']});
 const main={};const official={...f.page,url:()=> 'https://creator.douyin.com/editor'};
 page.mainFrame=()=>main;page.frames=()=>[main,{url:()=> 'https://example.com/'},official];
 await setVisibility(page,'self',human);assert.equal(await readVisibility(page),'self');
 page.frames=()=>[main,official,official];
 await assert.rejects(setVisibility(page,'public',human),/visibility_ambiguous/);
});
test('scrolling reveals lazy settings and options may load later than the old ten second limit',async()=>{
 const f=customFixture({lazy:true});await setVisibility(f.page,'self',human);
 assert.equal(await readVisibility(f.page),'self');
 const slow=fixture({delay:60});await setVisibility(slow.page,'self',human);
 assert.equal(await readVisibility(slow.page),'self');
});
test('custom controls refuse friend-only, unknown focus state, multiple selections and duplicate rows',async()=>{
 await assert.rejects(readVisibility(customFixture({selected:1}).page),/visibility_unverified/);
 await assert.rejects(setVisibility(customFixture({mode:'unknown'}).page,'public',human),/visibility_unverified/);
 await assert.rejects(setVisibility(customFixture({ambiguous:true}).page,'public',human),/visibility_ambiguous/);
 const f=customFixture();f.icons[2].classList=['checked'];
 await assert.rejects(readVisibility(f.page),/visibility_ambiguous/);
});

test('duplicate semantic markers agree; conflicting state is rejected without clicking',async()=>{
 const f=customFixture({mode:'aria'});
 f.wrappers.forEach((w,i)=>w.attrs={'aria-checked':String(i===0),'data-checked':String(i===0)});
 assert.equal(await readVisibility(f.page),'public');
 await setVisibility(f.page,'public',human);assert.deepEqual(f.clicks,[]);
 f.wrappers[0].attrs['aria-checked']='false';
 await assert.rejects(setVisibility(f.page,'public',human),/visibility_ambiguous/);
 assert.deepEqual(f.clicks,[]);
});
test('semantic state overrides stale styling and supports data-state without radio role',async()=>{
 const f=customFixture({mode:'unknown'});
 f.icons.forEach((e,i)=>{e.attrs={'data-state':i===0?'checked':'unchecked'};e.classList=['selected'];});
 assert.equal(await readVisibility(f.page),'public');
 f.icons[0].attrs={'data-selected':'false'};f.icons[2].attrs={'data-selected':'true'};
 assert.equal(await readVisibility(f.page),'self');
});
test('unknown initial state is selected once and still requires verified read-back',async()=>{
 const f=customFixture();f.icons.forEach(e=>e.classList=['radio','focused']);
 await setVisibility(f.page,'self',human);
 assert.deepEqual(f.clicks,['仅自己可见']);assert.equal(await readVisibility(f.page),'self');
 const stuck=customFixture({mode:'unknown'});
 await assert.rejects(setVisibility(stuck.page,'self',human),/visibility_unverified/);
 assert.deepEqual(stuck.clicks,['仅自己可见']);
});
test('visibility diagnostics retain safe structure but exclude text, raw classes and attributes',async()=>{
 const f=customFixture({mode:'unknown'});
 f.icons[0].attrs={'data-cookie':'PRIVATE_COOKIE',id:'PRIVATE_ACCOUNT',title:'PRIVATE_CAPTION'};
 f.icons[0].classList=['radio','active','PRIVATE_SECRET'];
 const d=await visibilityDiagnostics(f.page), serialized=JSON.stringify(d);
 assert.equal(d.schema,1);assert.equal(d.scopes[0].options[0].reason,'missing');
 assert.ok(d.scopes[0].options[0].structure.some(e=>e.activeClass));
 assert.doesNotMatch(serialized,/PRIVATE_|公开|仅自己可见/);
});
test('labels with external native radio controls read live checked property, not default attributes',async()=>{
 const f=customFixture({mode:'unknown'});
 const controls=f.labels.map((_,i)=>({checked:i===0,matches:()=>true}));
 f.labels.forEach((label,i)=>label.closest=()=>({control:controls[i]}));
 assert.equal(await readVisibility(f.page),'public');
 controls[0].checked=false;controls[2].checked=true;
 assert.equal(await readVisibility(f.page),'self');
});
