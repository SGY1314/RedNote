const {chromium,browserLaunchOptions}=require('./browser.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const out=process.env.WORKBENCH_UI_QA_OUT||path.resolve(__dirname,'../../data/verification/title-stage');
const base=process.env.WORKBENCH_UI_BASE_URL||'http://127.0.0.1:8080';
const stamp='2026-11-01T02:00:00Z';
const source={id:'r-title',kind:'image',title:'一杯咖啡的清晨',body:'真实的原始正文，记录磨豆、注水和品尝的过程。\n分享家里的手冲方法。',topics:['手冲咖啡','真实分享'],asset_ids:['original-2','original-1']};
const project={id:'p-title',note_id:'n-title',revision_id:source.id,name:source.title,platform:'xhs',kind:'image',sources:[{id:'original',label:'原始笔记',text:source.title+'\n'+source.body}],asset_ids:source.asset_ids,media_selections:{image:{asset_ids:source.asset_ids,cover_id:source.asset_ids[0]}},created_at:stamp};
const assets=source.asset_ids.map((id,position)=>({id,name:'原图 '+(position+1),kind:'image',status:'ready',source:'collection',revision_id:source.id,position,width:600,height:800,created_at:stamp}));
const workflow={id:project.id,account_profile:{},title:{key:'',text:''},copy:{key:'',title_key:'',body:'',topics:[]},drafts:{},stage_versions:{}};
function workflowBasis(){const title=workflow.title.key?workflow.title:{key:'source-title-'+source.id,text:source.title};const copy=workflow.copy.key?workflow.copy:{key:'source-copy-'+title.key,title_key:title.key,body:source.body,topics:source.topics};return {title,copy};}
const titles=[],copies=[],versions=[],publications=[],jobs=[],generationRequests=[],copyRequests=[];let serial=0,cursor=0,modelConfigured=false;
async function routeAPI(route){
 const req=route.request(),e=new URL(req.url()).pathname.slice(7),data=req.method()==='GET'||e==='/assets'?null:req.postDataJSON();let body=[];
 if(e==='/auth/me')body={user:{id:'creator',username:'qa',display_name:'创作用户',role:'creator',status:'active',created_at:stamp}};
 else if(e==='/session')body={csrf_token:'fixture'};
 else if(e==='/sync')body={reset:true,more:false,epoch:'title-qa',cursor:++cursor,changes:[{entity:'projects',id:project.id,value:project},...assets.map(value=>({entity:'assets',id:value.id,value})),...jobs.map(value=>({entity:'jobs',id:value.id,value})),...publications.map(value=>({entity:'publications',id:value.id,value}))]};
 else if(e==='/rewrites')body=[project];
 else if(e===`/rewrites/${project.id}`)body={project,versions,reference_assets:assets,reference_videos:[]};
 else if(e.endsWith('/workflow'))body={workflow,basis:workflowBasis(),reference:source,titles,copies,image_plans:[],angles:[],title_system_prompts:Object.fromEntries([1,3,5].map(count=>[count,`结合原始标题、正文及标签，参考账号基本信息和补充要求，生成${count}个自然准确的完整标题，每个不超过20个字符。`])),copy_system_prompts:Object.fromEntries([1,2,3,4,5].map(count=>[count,`参考原始文案、标签、已保存的标题、基本信息和补充要求，生成${count}份完整文案，正文与话题分别返回。`]))};
 else if(e.includes('/workflow/drafts/')){const scope=e.split('/').at(-1),old=workflow.drafts[scope];assert.equal(data.revision,old?.revision||0);body=workflow.drafts[scope]={revision:data.revision+1,data:data.data,saved_at:stamp};if(scope==='source'){source.id='original-snapshot-'+(++serial);Object.assign(source,data.data);project.revision_id=source.id;body={...body,project,reference:source,basis:workflowBasis()};}}
 else if(e==='/assets'&&req.method()==='POST'){assert(req.headers()['content-type'].startsWith('multipart/form-data;'));const asset={id:'uploaded-original',name:'原创素材.png',kind:'image',source:'upload',status:'ready',created_at:stamp,width:640,height:800};assets.push(asset);body=asset;}
 else if(e.endsWith('/titles/generate')){
  generationRequests.push(data);assert([1,3,5].includes(data.count));assert.equal(data.prompt,'');assert.equal(data.preset_id,'');
  const id='titles-'+(++serial);titles.unshift({id,count:data.count,titles:Array.from({length:data.count},(_,index)=>index===0?'把日常过成喜欢的模样，从一杯手冲咖啡开始':`清晨手冲灵感${data.count}-${index+1}`),model:'默认标题模型',requirements:data.requirements,created_at:stamp});
  jobs.push({id,kind:'title_rewrite',target:project.id,state:'succeeded',stage:'已完成',result:id,created_at:stamp,updated_at:stamp});body={job_id:id};
 }
 else if(e.endsWith('/copies/generate')){
  copyRequests.push(data);assert([1,2,3,4,5].includes(data.count));assert.equal(data.prompt,'');assert.equal(data.preset_id,'');
  const id='copies-'+(++serial);copies.unshift({id,title_key:workflowBasis().title.key,count:data.count,copies:Array.from({length:data.count},(_,index)=>({body:`第${index+1}份咖啡笔记。\n从磨豆到注水，记录家里的手冲过程。\n生成批次${data.count}，保持内容自然真实。`,topics:['手冲咖啡',`批次${data.count}`]})),model:'文案模型二',requirements:data.requirements,created_at:stamp});
  jobs.push({id,kind:'copy_rewrite',target:project.id,state:'succeeded',stage:'已完成',result:id,created_at:stamp,updated_at:stamp});body={job_id:id};
 }
 else if(e.endsWith('/workflow/stage')){
  const step=data.step;assert(['title','copy','image','video'].includes(step));
  if(step==='title'){if(workflow.title.text!==data.text)workflow.title={key:'title-key-'+(++serial),text:data.text,generation_id:data.generation_id};}
  else if(step==='copy'){assert.equal(data.title_key,workflow.title.key);if(workflow.copy.body!==data.text)workflow.copy={key:'copy-key-'+(++serial),title_key:workflow.title.key,body:data.text,topics:data.topics,generation_id:data.generation_id};}
  const content={title:workflow.title.text,body:step==='title'?source.body:workflow.copy.body,topics:step==='title'?source.topics:workflow.copy.topics};
  let version=versions.find(v=>v.workflow_snapshot.stage===step&&v.title===content.title&&v.body===content.body&&JSON.stringify(v.topics)===JSON.stringify(content.topics));
  if(!version){version={id:'version-'+(++serial),project_id:project.id,number:versions.length+1,...content,media:data.media||{kind:'image',asset_ids:[...source.asset_ids],cover_id:source.asset_ids[0]},status:'confirmed',workflow_snapshot:{stage:step},created_at:stamp};versions.unshift(version);}
  workflow.stage_versions[step]=version.id;
  let selected=[];
  {let pub=publications.find(p=>p.project_id===project.id);if(!pub){pub={id:'publication-'+(++serial),project_id:project.id,target_platform:'xhs',revision:0,created_at:stamp};publications.push(pub);}if(JSON.stringify([pub.title,pub.body,pub.topics,pub.asset_ids])!==JSON.stringify([content.title,content.body,content.topics,version.media.asset_ids])){pub.ready=false;pub.revision++;}Object.assign(pub,{version_id:version.id,...content,kind:version.media.kind,asset_ids:[...version.media.asset_ids],cover_id:version.media.cover_id});selected=[pub];}
  body={workflow,version,publications:selected};
 }
 else if(e==='/publications/confirm'){for(const item of data.items){const p=publications.find(p=>p.id===item.id);assert.equal(p.revision,item.revision);p.ready=true;}body={items:data.items.map(item=>publications.find(p=>p.id===item.id))};}
 else if(e==='/publications')body=publications;
 else if(e==='/collections')body={items:[{...source,id:project.note_id,note_id:project.note_id,revision_id:source.id,platform:'xhs',author:'咖啡手记',created_at:stamp}],total:1};
 else if(e==='/settings')body={services:{},dependencies:{}};
 else if(e==='/image-models')body=[{id:'model-image',name:'图片模型',model:'fixture-image',configured:modelConfigured,reference_mode:'generations_image',reference_limit:3}];
 else if(e==='/copy-models')body=[{id:'copy-default',name:'文案模型一',model:'fixture-copy',configured:modelConfigured},{id:'copy-alternate',name:'文案模型二',model:'fixture-copy-alternate',configured:modelConfigured}];
 else if(e.endsWith('-models'))body=[{id:'model-title',name:'默认标题模型',model:'fixture',configured:modelConfigured,base_url:'https://fixture.test'}];
 else if(e.startsWith('/assets/')&&(e.endsWith('/file')||e.endsWith('/preview')))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#e8e5d5"/><rect x="75" y="70" width="450" height="500" rx="210" fill="#f9f7ed"/><ellipse cx="300" cy="565" rx="200" ry="60" fill="#c0ac88"/><path d="M185 385h230v150q-110 100-230 0Z" fill="#55755c"/><path d="M410 420q100-30 80 60t-75 25" fill="none" stroke="#55755c" stroke-width="25"/><text x="120" y="720" fill="#3e5945" font-size="34">清晨的手冲日常</text></svg>'});
 else if(req.method()!=='GET')throw Error('Unexpected mutation '+e);
 return route.fulfill({json:body});
}
(async()=>{
 await fs.mkdir(out,{recursive:true});const browser=await chromium.launch({...browserLaunchOptions,args:['--no-proxy-server']});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));modelConfigured=true;
 await page.route('**/api/v1/**',routeAPI);await page.goto(base+'/#rewrites');
 const steps=page.getByRole('navigation',{name:'仿写创作步骤',exact:true});await steps.waitFor();await steps.getByRole('button',{name:'标题仿写',exact:true}).click();
 const panel=page.locator('.title-rewrite-panel:not(.copy-rewrite-panel)'),wheel=panel.getByRole('region',{name:'标题创意轮盘',exact:true});
 const actions=()=>panel.locator('.workflow-next');const confirm=()=>actions().getByRole('button',{name:/确\s*认$/});
 const number=()=>wheel.getByRole('status');
 const go=async index=>{await wheel.focus();await page.keyboard.press('Home');for(let i=0;i<index;i++)await page.keyboard.press('ArrowRight');};
 const settled=()=>wheel.evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));
 const assertResultHeading=async target=>{assert.equal(await target.locator('.workflow-result-panel > h3').count(),0);const heading=await target.locator('.workflow-result-section > h3').boundingBox(),box=await target.locator('.workflow-result-panel').boundingBox();assert(heading.y+heading.height<=box.y-8&&Math.abs(heading.x-box.x)<1);};
 await assertResultHeading(panel);const fixedHeight=(await panel.locator('.title-wheel-panel').boundingBox()).height;
 const assertWheelFillsFrame=async()=>{assert.equal(await wheel.locator('.title-wheel-controls').count(),0);const frame=await panel.locator('.title-wheel-panel').boundingBox(),stage=await wheel.locator('.title-wheel-stage').boundingBox();assert(Math.abs(stage.x-frame.x-1)<1&&Math.abs(stage.y-frame.y-1)<1&&Math.abs(stage.width-frame.width+2)<1&&Math.abs(stage.height-frame.height+2)<1,'Wheel stage must fill the bordered frame');assert.equal(await number().evaluate(el=>getComputedStyle(el).clipPath),'inset(50%)');};
 await assertWheelFillsFrame();
 assert.equal(await number().innerText(),'自定义');assert(await confirm().isDisabled());
 await wheel.getByRole('textbox',{name:'自定义标题',exact:true}).fill('手写的原创咖啡标题');assert(await confirm().isEnabled());
 await page.waitForFunction(()=>document.querySelector('.workflow-save-announcement')?.textContent.includes('已自动保存'));await page.reload();await panel.waitFor();assert.equal(await wheel.getByRole('textbox',{name:'自定义标题',exact:true}).inputValue(),'手写的原创咖啡标题');
 await panel.getByRole('textbox',{name:'标题仿写补充要求',exact:true}).fill('使用真实场景，保持自然表达');
 for(const count of [1,3,5]){
  await panel.locator('.ant-select').filter({has:page.getByRole('combobox',{name:'标题生成数量',exact:true})}).click();await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({hasText:new RegExp('^'+count+'\\s*个$')}).click();
  await panel.getByRole('button',{name:'开始生成',exact:true}).click();await page.waitForFunction(count=>document.querySelectorAll('.title-wheel-card:not(.is-custom)').length===count,count);
  assert.equal((await panel.locator('.title-wheel-panel').boundingBox()).height,fixedHeight);
  await go(1);await settled();await wheel.getByRole('textbox',{name:'编辑标题1',exact:true}).fill('修改后的手冲标题'+count);assert.equal(await wheel.getByRole('checkbox',{name:'选用标题1',exact:true}).isChecked(),false);
  await wheel.getByRole('checkbox',{name:'选用标题1',exact:true}).check();await wheel.getByRole('textbox',{name:'编辑标题1',exact:true}).fill('可编辑的手冲标题'+count);assert(await confirm().isEnabled());
  await go(count);await settled();await wheel.getByRole('checkbox',{name:'选用标题'+count,exact:true}).check();
  const positions=()=>wheel.evaluate(el=>{const positions=[];for(let parent=el.parentElement;parent;parent=parent.parentElement)positions.push(parent.scrollTop);return positions;});
  await wheel.hover({position:{x:25,y:80}});const before=await positions();await page.mouse.wheel(0,120);await page.waitForFunction(()=>document.querySelector('.title-wheel-status')?.textContent==='自定义');assert.deepEqual(await positions(),before,'Wheel browsing must not scroll the page');
  await go(count);await settled();
  if(count===1){await confirm().click();await panel.getByText('已保存版本 V1',{exact:true}).waitFor();}
  if(count===3){await page.waitForFunction(()=>document.querySelector('.workflow-save-announcement')?.textContent.includes('已自动保存'));await page.reload();await panel.waitFor();await go(1);await settled();assert.equal(await wheel.getByRole('textbox',{name:'编辑标题1',exact:true}).inputValue(),'可编辑的手冲标题3');await go(3);}
 }
 assert.deepEqual(generationRequests.map(r=>r.count),[1,3,5]);
 for(const width of [1720,1157,823,547,390]){
  await page.setViewportSize({width,height:width<700?844:1000});await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1);assert(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert.equal((await panel.locator('.title-wheel-panel').boundingBox()).height,fixedHeight);await assertResultHeading(panel);await assertWheelFillsFrame();await panel.locator('.workflow-result-section').screenshot({path:path.join(out,'editable-title-wheel-'+width+'.png'),animations:'disabled'});
 }
 await page.setViewportSize({width:1440,height:1000});await go(5);await settled();await wheel.getByRole('textbox',{name:'编辑标题5',exact:true}).fill('超'.repeat(21));assert(await confirm().isDisabled());await wheel.getByRole('textbox',{name:'编辑标题5',exact:true}).fill('清晨手冲灵感5-5');
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await wheel.locator('.title-wheel-ring').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');await page.emulateMedia({reducedMotion:'no-preference'});
 await actions().getByRole('button',{name:/发\s*布$/}).click();await page.getByRole('dialog',{name:'确认发布稿',exact:true}).getByRole('button',{name:'暂不确认',exact:true}).click();await page.waitForURL(url=>url.hash==='#publications');assert.equal(versions.length,2);assert.equal(publications.length,1);assert.equal(publications[0].title,'清晨手冲灵感5-5');assert.equal(publications[0].body,source.body);assert.deepEqual(publications[0].asset_ids,source.asset_ids);assert.equal(publications[0].ready,false);await page.getByRole('button',{name:'查看发布稿 '+publications[0].title,exact:true}).click();const review=page.getByRole('dialog',{name:'确认发布稿',exact:true});await review.locator('.publication-content-preview').waitFor();await review.screenshot({path:path.join(out,'publication-review-1157.png'),animations:'disabled'});await review.getByRole('button',{name:'确认，设为等待发布',exact:true}).click();await review.waitFor({state:'hidden'});assert.equal(publications[0].ready,true);
 await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'仿写工作台',exact:true}).click();
 await page.locator('.project-title-button').filter({hasText:project.name}).click();await steps.getByRole('button',{name:/标题仿写/}).click();await panel.waitFor();
 await page.getByRole('navigation',{name:'仿写创作步骤',exact:true}).getByRole('button',{name:/文案仿写/}).click();
 const copyPanel=page.locator('.copy-rewrite-panel');await copyPanel.waitFor();
 await assertResultHeading(copyPanel);
 assert((await copyPanel.locator('.title-original-content > h3').innerText()).includes('清晨手冲灵感5-5'));
 assert.equal(await copyPanel.getByRole('textbox',{name:'系统提示词',exact:true}).getAttribute('readonly'),'');
 await copyPanel.getByRole('textbox',{name:'文案仿写补充要求',exact:true}).fill('分段清晰，写出实际步骤');
 await copyPanel.locator('.ant-select').filter({has:page.getByRole('combobox',{name:'文案仿写模型',exact:true})}).click();await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({hasText:'文案模型二'}).click();
 for(const count of [1,2,3,4,5]){
  await copyPanel.locator('.ant-select').filter({has:page.getByRole('combobox',{name:'文案生成份数',exact:true})}).click();await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({hasText:new RegExp('^'+count+'\\s*份$')}).click();
  await copyPanel.getByRole('button',{name:'开始生成',exact:true}).click();await page.waitForFunction(count=>document.querySelectorAll('.copy-letter-sidebar button').length===count+1,count);
  await copyPanel.getByRole('button',{name:'查看文案'+count,exact:true}).click();await copyPanel.getByRole('button',{name:'选用当前文案',exact:true}).click();await copyPanel.getByRole('button',{name:'打开文案信笺',exact:true}).click();assert((await copyPanel.getByRole('textbox',{name:'最终文案',exact:true}).inputValue()).includes(`第${count}份咖啡笔记。`));
 }
 assert.deepEqual(copyRequests.map(item=>item.count),[1,2,3,4,5]);assert(copyRequests.every(item=>item.model_id==='copy-alternate'&&item.requirements==='分段清晰，写出实际步骤'));
 await page.waitForFunction(()=>document.querySelector('.workflow-save-announcement')?.textContent.includes('已自动保存'));
 await page.reload();await page.locator('.project-title-button').filter({hasText:project.name}).click();await steps.getByRole('button',{name:/文案仿写/}).click();await copyPanel.waitFor();
 assert.equal(await copyPanel.getByRole('button',{name:'查看文案5',exact:true}).getAttribute('aria-pressed'),'true');await copyPanel.getByRole('button',{name:'打开文案信笺',exact:true}).click();assert((await copyPanel.getByRole('textbox',{name:'最终文案',exact:true}).inputValue()).includes('第5份咖啡笔记。'));
 for(const width of [1720,1144,823,547,390]){
  await page.setViewportSize({width,height:width<700?844:1000});await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1);assert(await copyPanel.evaluate(el=>el.scrollWidth<=el.clientWidth+1));const sourceMedia=await copyPanel.locator('.title-original-media').boundingBox(),sourceCopy=await copyPanel.locator('.title-original-content').boundingBox();assert(sourceMedia.x+sourceMedia.width<=sourceCopy.x-8,'Source preview must not overlap the title or copy');await steps.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`copy-rewrite-${width}.png`),fullPage:true});
 }
 await page.setViewportSize({width:1157,height:1000});
 const longCopy=Array.from({length:90},(_,i)=>`${i+1}. 清晨在家磨豆、注水，慢慢记录一杯手冲咖啡。`).join('\n');
 const letterText=copyPanel.getByRole('textbox',{name:'最终文案',exact:true});await letterText.fill(longCopy);await letterText.hover();const outsideScroll=await page.evaluate(()=>[document.documentElement.scrollTop,document.querySelector('.page-content').scrollTop]);await page.mouse.wheel(0,420);await page.waitForFunction(()=>document.querySelector('.copy-letter-content textarea').scrollTop>0);assert.deepEqual(await page.evaluate(()=>[document.documentElement.scrollTop,document.querySelector('.page-content').scrollTop]),outsideScroll);
 await copyPanel.locator('.copy-letter-panel').screenshot({path:path.join(out,'copy-letter-open-1157.png'),animations:'disabled'});
 await copyPanel.getByRole('button',{name:'查看文案1',exact:true}).click();await copyPanel.getByRole('button',{name:'查看文案5',exact:true}).click();await copyPanel.getByRole('button',{name:'打开文案信笺',exact:true}).click();assert.equal(await letterText.inputValue(),longCopy);
 await copyPanel.getByRole('button',{name:'收起信笺',exact:true}).click();await copyPanel.locator('.copy-letter-panel').screenshot({path:path.join(out,'copy-letter-closed-1157.png'),animations:'disabled'});
 await page.setViewportSize({width:390,height:844});await copyPanel.getByRole('button',{name:'打开文案信笺',exact:true}).click();await copyPanel.locator('.copy-letter-panel').screenshot({path:path.join(out,'copy-letter-open-390.png'),animations:'disabled'});assert(await copyPanel.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('textbox',{name:'最终文案',exact:true}).fill('这是新的正文，原图保持不变。');
 await page.getByRole('combobox',{name:'文案话题',exact:true}).fill('新话题');await page.getByRole('combobox',{name:'文案话题',exact:true}).press('Enter');
 await copyPanel.locator('.workflow-next').getByRole('button',{name:/确\s*认$/}).click();
 await page.waitForFunction(()=>document.querySelector('.workflow-save-announcement')?.textContent.includes('已自动保存'));assert.equal(versions.length,3);assert.equal(publications.length,1);
 await copyPanel.locator('.workflow-next').getByRole('button',{name:/发\s*布$/}).click();await page.getByRole('dialog',{name:'确认发布稿',exact:true}).getByRole('button',{name:'确认，设为等待发布',exact:true}).click();await page.waitForURL(url=>url.hash==='#publications');
 assert.equal(versions.length,3);assert.equal(publications.length,1);assert.equal(publications[0].body,'这是新的正文，原图保持不变。');assert.deepEqual(publications[0].asset_ids,source.asset_ids);assert.equal(publications[0].ready,true);
 source.body='#手冲咖啡[话题]#';await page.goto(base+'/#rewrites');await page.locator('.project-title-button').filter({hasText:project.name}).click();await steps.getByRole('button',{name:/标题仿写/}).click();await panel.waitFor();assert.equal((await panel.locator('.title-original-copy p').innerText()).trim(),'');assert.equal(await panel.getByText('原始标题',{exact:true}).count(),0);assert.equal(await panel.getByText('暂无正文',{exact:true}).count(),0);

 project.id='p-original';project.name='原创手冲项目';delete project.note_id;source.id='r-original';source.title='';source.body='';source.topics=[];source.asset_ids=[];project.revision_id=source.id;project.asset_ids=[];project.sources=[];
 workflow.id=project.id;workflow.title={key:'',text:''};workflow.copy={key:'',title_key:'',body:'',topics:[]};workflow.drafts={};workflow.stage_versions={};titles.length=0;copies.length=0;
 await page.goto(base+'/#rewrites');await page.locator('.project-title-button').filter({hasText:project.name}).click();await page.locator('.creation-workflow[data-project-id="p-original"]').waitFor();await steps.getByRole('button',{name:'标题仿写',exact:true}).click();await panel.getByRole('textbox',{name:'创作标题',exact:true}).waitFor();
 assert.equal(await page.getByText('从采集库选择',{exact:true}).count(),0);assert.equal(await page.getByRole('combobox',{name:'唯一参考帖子',exact:true}).count(),0);
 await panel.getByRole('textbox',{name:'创作标题',exact:true}).fill('原创手冲标题');await panel.getByRole('textbox',{name:'创作文案',exact:true}).fill('在家磨豆、注水，这是我自己的手冲记录。');
 await panel.getByRole('combobox',{name:'创作话题',exact:true}).fill('原创咖啡');await page.keyboard.press('Enter');
 await panel.getByRole('button',{name:'选择素材',exact:true}).click();let material=page.getByRole('dialog',{name:'添加创作素材',exact:true});await material.getByRole('checkbox',{name:'选用素材原图 1',exact:true}).check();await material.getByRole('button',{name:/确认选择$/}).click();
 await panel.getByRole('button',{name:'上传素材',exact:true}).click();material=page.getByRole('dialog',{name:'添加创作素材',exact:true});await material.locator('input[type=file]').setInputFiles({name:'原创素材.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/r8AAAAASUVORK5CYII=','base64')});await material.locator('.ant-upload-list-item-done').waitFor();await material.getByRole('button',{name:/确认选择$/}).click();
 await page.waitForFunction(()=>document.querySelector('.workflow-save-announcement')?.textContent.includes('已自动保存'));assert.deepEqual(workflow.drafts.source.data.asset_ids,['original-2','uploaded-original']);
 await page.reload();await panel.waitFor();assert.equal(await panel.getByRole('textbox',{name:'创作文案',exact:true}).inputValue(),'在家磨豆、注水，这是我自己的手冲记录。');
 for(const label of ['标题仿写','文案仿写','图片仿写','视频仿写']){await steps.getByRole('button',{name:label,exact:true}).click();assert.equal(await page.locator('.creation-workflow .original-creation-input').count(),1);assert.equal(await page.getByText('从采集库选择',{exact:true}).count(),0);}
 await steps.getByRole('button',{name:'标题仿写',exact:true}).click();
 for(const width of [1720,1157,823,547,390]){await page.setViewportSize({width,height:width<700?844:1000});assert(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.locator('.original-creation-input').screenshot({path:path.join(out,'original-input-'+width+'.png'),animations:'disabled'});}
 await page.setViewportSize({width:1440,height:1000});await wheel.getByRole('textbox',{name:'自定义标题',exact:true}).fill('周末手冲原创');await actions().getByRole('button',{name:/发\s*布$/}).click();await page.getByRole('dialog',{name:'确认发布稿',exact:true}).getByRole('button',{name:'暂不确认',exact:true}).click();await page.waitForURL(url=>url.hash==='#publications');assert.equal(publications.at(-1).title,'周末手冲原创');assert.equal(publications.at(-1).body,'在家磨豆、注水，这是我自己的手冲记录。');assert.deepEqual(publications.at(-1).asset_ids,['original-2','uploaded-original']);
 assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(out,'title-stage-verification.json'),JSON.stringify({status:'PASS',titleCounts:[1,3,5],copyCounts:[1,2,3,4,5],versions:versions.length,publications:publications.length,checks:['read-only system prompts','empty source has no annotations','single checkbox title selection after generation','copy uses saved title and original note','copy model and count selection','candidate and draft restored after reload','confirmation and direct publish preserve original media','independent module navigation','1720/1144/823/547/390 layout'],errors},null,2));
 console.log('PASS title generation counts, original-note snapshots and staged confirm/publish.');
 }catch(error){const failedPage=browser.contexts()[0]?.pages()[0];await failedPage?.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});if(failedPage)await fs.writeFile(path.join(out,'overflow.json'),JSON.stringify(await failedPage.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.right>innerWidth+2}).slice(0,25).map(el=>({tag:el.tagName,class:typeof el.className==='string'?el.className:'',rect:el.getBoundingClientRect().toJSON()}))})),null,2));throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
