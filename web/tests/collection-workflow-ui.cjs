const {chromium,browserLaunchOptions}=require("./browser.cjs");
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root=process.env.WORKBENCH_UI_QA_OUT || path.resolve(__dirname,"../../verification/workflow");
const baseURL=process.env.WORKBENCH_UI_BASE_URL || 'http://127.0.0.1:4173';

const stamp = '2026-10-22T07:00:00Z';
const users = [{ id:'admin', username:'qa-admin', display_name:'管理员', role:'admin', status:'active', created_at:stamp }, {id:'creator',username:'qa-user',display_name:'创作用户',role:'creator',status:'active',created_at:stamp}];
const notes = ['把日常过成喜欢的样子','城市漫游，发现新的灵感','给忙碌的生活留一点空白','一杯咖啡的松弛时刻'].map((title,i)=>({id:'n'+i,note_id:'n'+i,title,body:'第一行文案，记录值得收藏的日常。\n第二行文案，分享具体的生活细节。\n第三行文案，留下灵感。\n第四行文案，继续补充。\n第五行文案。#生活记录[话题]# #灵感收藏[话题]#',topics:['生活记录','灵感收藏'],url:'https://www.xiaohongshu.com/explore/n'+i,author:['日常手记','漫游研究所','慢生活提案','咖啡日记'][i],platform:'xhs',kind:'image',tags:['生活记录','灵感收藏'],revision_id:'r'+i,likes:1280+i*120,favorites:328,comments:26,created_at:stamp,updated_at:stamp}));
const assets = notes.map((n,i)=>({id:'a'+i,name:n.title,kind:'image',mime:'image/svg+xml',source:'collection',status:'ready',revision_id:n.revision_id,width:600,height:720,size:1000,position:0,created_at:stamp}));
notes[1].kind='video';assets[1].kind='video';assets[1].mime='video/webm';
let trashedNotes=[{...notes[0],id:'trash-note',deleted_at:stamp}];
const restored=[];
const projects=[{id:'p1',name:'灵感仿写',sources:[],platform:'xhs',kind:'image',asset_ids:[],created_at:stamp},{id:'p2',name:'第二个创作项目',sources:[],platform:'douyin',kind:'image',asset_ids:[],created_at:stamp}];
const workflowData=Object.fromEntries(projects.map(project=>[project.id,{workflow:{id:project.id,title:{key:'',text:''},copy:{key:'',title_key:'',body:'',topics:[]},image_plan_id:'',drafts:{}},reference:{id:'r0',title:'参考笔记标题',body:'参考正文',topics:[]},titles:[],copies:[],image_plans:[],angles:[]} ]));
const mutations=[];
const usage = [{id:'u1',user_id:'creator',user:'创作用户',at:stamp,kind:'rewrite',feature:'文案生成',model:'文案模型',input:1520,output:860,total:2380,cost:0.0238,state:'succeeded',stateLabel:'已完成',jobID:'job'}];
let authRole='creator', authRequests=0, failure=false, jobState='queued', mode='queued', created=[], queries=[]; let cursor=0;
const taskJobs=[
 {id:'asr-config',kind:'asr',target:'a1',state:'blocked',stage:'提取音轨并转写',error:'待配置：请在设置中填写服务地址、模型和密钥',created_at:stamp,updated_at:stamp,attempts:1},
 {id:'collect-failed',kind:'collect',target:notes[2].url,result:notes[2].id,state:'failed',stage:'读取笔记元数据',error:'采集失败，请检查原始链接',created_at:stamp,updated_at:stamp,attempts:1},
 {id:'download-active',kind:'download',target:'standalone',state:'running',stage:'下载素材中',created_at:stamp,updated_at:stamp,attempts:1},
 {id:'rewrite-done',kind:'rewrite',target:'p1',state:'succeeded',stage:'文案生成完成',result:'saved-version',created_at:stamp,updated_at:stamp,attempts:1},
];
const taskRetries=[];
let serialAccount=0;
const unknown = new Set();
async function fixture(route) {
  const req=route.request(), u=new URL(req.url()), p=u.pathname.slice(7);
  let body=[];
  if (p==='/auth/me') return route.fulfill({status: authRole?200:401,json:authRole?{user:users[authRole==='admin'?0:1]}:{error:'未登录'}});
  if (p==='/session') body={csrf_token:'qa-session'};
  else if (p==='/auth/login') {authRequests++; return route.fulfill({status:401,json:{error:'用户名或密码错误'}});}
  else if(p==='/admin/overview') { if(failure)return route.fulfill({status:503,json:{error:'服务暂时不可用'}}); body={users,usage,tasks:[],summary:{active_users:2,calls:1,tokens:2380,cost:.0238,active_tasks:0,failed_tasks:0},price_per_1k:.01}; }
  else if(p==='/admin/audit') body=[{id:1,at:stamp,actor:'管理员',action:'login',detail:'管理员登录'}];
  else if(p==='/sync') body={reset:true,more:false,epoch:'qa',cursor:++cursor,changes:[...taskJobs.map(value=>({entity:'jobs',id:value.id,value})),...projects.map(value=>({entity:'projects',id:value.id,value})),...assets.map(value=>({entity:'assets',id:value.id,value})),{entity:'jobs',id:'collect1',value:{id:'collect1',kind:'collect',state:jobState,result:jobState==='succeeded'?'n0':'',target:'link',stage:'',attempts:1,created_at:stamp,updated_at:stamp}}]};
  else if(/^\/jobs\/[^/]+\/retry$/.test(p)){const task=taskJobs.find(item=>item.id===p.split('/')[2]);taskRetries.push(task.id);task.state='queued';task.error='';task.stage='已排队';body=task;}
  else if(p==='/collections' && req.method()==='POST') body={items:mode==='duplicate'?[{note_id:'n0',duplicate:true}]:mode==='deleted'?[{note_id:'n0',duplicate:true,deleted:true}]:[{job_id:'collect1'}]};
  else if(p==='/collections') { queries.push(u.searchParams.toString()); const items=u.searchParams.get('deleted')==='true'?trashedNotes:notes; body={items,total:items.length}; }
  else if(/^\/collections\/[^/]+$/.test(p)&&req.method()==='GET'){const note=[...notes,...trashedNotes].find(item=>item.id===p.split('/')[2]);body={note,revision:{id:note.revision_id,title:note.title,body:note.body,topics:note.topics,published_at:stamp},history:[{id:note.revision_id,created_at:stamp}],assets:assets.filter(asset=>asset.revision_id===note.revision_id),extractions:[],jobs:[]};}
  else if(p==='/collections/batch-restore') { const {ids}=req.postDataJSON(); restored.push(...ids); for(const note of trashedNotes.filter(n=>ids.includes(n.id))) notes.push({...note,deleted_at:undefined}); trashedNotes=trashedNotes.filter(n=>!ids.includes(n.id)); body={count:ids.length}; }
  else if(p==='/rewrites' && req.method()==='POST') {created.push(req.postDataJSON()); body=projects[0];}
  else if(/^\/rewrites\/p[12]$/.test(p)) body={project:projects.find(item=>item.id===p.split('/')[2]),versions:[],reference_assets:[],reference_videos:[]};
  else if(/^\/rewrites\/p[12]\/workflow$/.test(p)) body=workflowData[p.split('/')[2]];
  else if(p.endsWith('/workflow/account')){const input=req.postDataJSON(),wf=workflowData[p.split('/')[2]].workflow;assert.equal(input.revision,wf.account_profile?.revision||0);assert.equal(input.draft_revision,wf.drafts.account?.revision||0);const profile=input.skip?{}:Object.fromEntries(['account_name','account_subject','positioning','audience','style'].map(key=>[key,input[key]||'']));wf.account_profile={...profile,status:input.skip?'skipped':'confirmed',revision:(wf.account_profile?.revision||0)+1,key:'account-'+(++serialAccount)};body=wf;}
  else if(p.includes('/workflow/drafts/')){const data=req.postDataJSON(),scope=p.split('/').at(-1),wf=workflowData[p.split('/')[2]].workflow; mutations.push(p); body=wf.drafts[scope]={revision:data.revision+1,data:data.data,saved_at:stamp};}
  else if(p==='/usage') body={usage,price_per_1k:.01};
  else if(p==='/admin/settings' || p==='/settings') body={services:{text:{},ocr:{},asr:{},collector_url:''},dependencies:{}};
  else if(p.startsWith('/assets/') && p.endsWith('/file')) {
    const i=Number(p.split('/')[2].slice(1));
    if(i===1)return route.fulfill({contentType:'video/webm',body:await fs.readFile(path.join(__dirname,'fixtures/reference-preview.webm'))});
    const colors=['#b8bba5','#c6a389','#d9c9b5','#929f95'];
    return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="720"><rect width="600" height="720" fill="${colors[i]}"/><circle cx="440" cy="130" r="110" fill="#f5eddb"/><path d="M0 500Q160 310 330 500T650 510V720H0Z" fill="#374a39" opacity=".6"/><rect x="80" y="180" width="280" height="360" rx="140" fill="#f3eada"/><path d="M80 390Q220 220 360 390V540H80Z" fill="#986c53"/><text x="42" y="655" font-size="22" fill="#fff" font-family="Georgia" letter-spacing="3">SLOW LIVING / 0${i+1}</text></svg>`});
  } else if(p.startsWith('/admin/models/') || p.startsWith('/rewrite-models') || p==='/image-models' || p==='/video-models' || p==='/publications' || p==='/jobs') body=[];
  else {unknown.add(p); body=[];}
  return route.fulfill({json:body});
}

(async()=>{
 const browser=await chromium.launch({...browserLaunchOptions,args:["--no-proxy-server"]});
 try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
 page.setDefaultTimeout(12000);
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/v1/**',fixture);
 await fs.mkdir(root,{recursive:true});
 await page.goto(`${baseURL}/?workflow=collections#/collections`);
 await page.locator('.collection-card').first().waitFor();
 const spotlight=page.locator('.brand-spotlight');const spot=await spotlight.evaluate(el=>{const s=getComputedStyle(el),c=document.createElement('canvas').getContext('2d');c.font=s.font;return{size:parseFloat(s.maskSize),capital:c.measureText('M').width,animation:s.animationName};});assert.equal(spot.animation,'brand-spotlight-sweep');assert(spot.size<=spot.capital);await spotlight.evaluate(el=>{const a=el.getAnimations()[0];a.pause();a.currentTime=3600;});await page.locator('.brand').screenshot({path:path.join(root,'brand-spotlight.png')});await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await spotlight.evaluate(el=>getComputedStyle(el).animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});

 const columns=page.getByRole('button',{name:'列配置',exact:true});
 const captureInput=page.getByRole('textbox',{name:'笔记链接或分享文字',exact:true});
 await captureInput.fill('https://www.xiaohongshu.com/explore/theme-check');
 await page.waitForFunction(()=>!document.querySelector('.capture-start')?.disabled);
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.capture-start')).backgroundColor==='rgb(47, 93, 75)');
 const captureStyle=await page.locator('.capture-start').evaluate(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color}));
 assert.equal(captureStyle.background,'rgb(47, 93, 75)');assert.equal(captureStyle.color,'rgb(255, 255, 255)');
 await page.locator('.capture-clear').click();
 assert.equal(await columns.count(),0,'Card view has no column configuration');
 assert.equal(await page.locator('.collection-card-author .ant-checkbox-wrapper').count(),notes.length);
 assert.equal(await page.locator('.collection-card-footer .ant-checkbox-wrapper').count(),0);
 assert.equal(await page.locator('.collection-card-footer .ant-tag').count(),0);
 assert.equal(await page.locator('.collection-card-footer .note-curation-controls').count(),notes.length);
 await page.locator('.collection-primary-tools .ant-segmented-item').nth(1).click();
 await columns.waitFor();
 const navigation=page.getByRole('navigation',{name:'主导航',exact:true});
 assert.deepEqual(await navigation.locator('button').allTextContents(),['采集工作台','仿写工作台','发布管理','素材库','回收站']);
 const sidebarStyle=await page.locator('.sidebar').evaluate(el=>({radius:parseFloat(getComputedStyle(el).borderRadius),left:el.getBoundingClientRect().left,background:getComputedStyle(el).backgroundColor}));
 assert.equal(sidebarStyle.left,12);assert.equal(sidebarStyle.radius,24);assert.equal(sidebarStyle.background,'rgb(41, 63, 54)');
 await page.getByRole('button',{name:'收起侧边栏',exact:true}).click();
 assert.equal(Math.round((await page.locator('.sidebar').boundingBox()).width),64);
 assert.equal(await navigation.getByRole('button',{name:'采集工作台',exact:true}).count(),1);
 await page.getByRole('button',{name:'展开侧边栏',exact:true}).click();
 assert.equal(Math.round((await page.locator('.sidebar').boundingBox()).width),208);
 assert.equal(await page.getByRole('button',{name:'更多采集库操作',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'刷新采集库',exact:true}).count(),0);
 assert.equal(await page.getByRole('combobox',{name:'笔记类型',exact:true}).count(),0);
 await page.getByRole('combobox',{name:'分类标签筛选',exact:true}).locator('xpath=ancestor::div[contains(@class,"ant-select-selector")]').click();
 await page.locator('.ant-select-dropdown:visible').getByText('生活记录',{exact:true}).click();
 await columns.click();
 await page.locator('.collection-column-options').getByText('博主',{exact:true}).click(); await page.waitForFunction(()=>!JSON.parse(localStorage.getItem('gin.columns')||'[]').includes('author'));
 assert(!JSON.parse(await page.evaluate(()=>localStorage.getItem('gin.columns'))).includes('author'));
 await columns.click();
 await page.getByText('分类：生活记录',{exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.collection-count-label'));
 await page.getByRole('button',{name:'重置筛选',exact:true}).click();
 await page.locator('.collection-primary-tools .ant-segmented-item').nth(1).click();
 await page.locator('.ant-table').waitFor();
 assert.equal(await page.getByRole('columnheader',{name:'博主',exact:true}).count(),0);
 assert.deepEqual((await page.locator('.ant-table-thead th').allTextContents()).slice(1,3),['笔记','分类标签']);
 assert((await page.locator('.ant-table-row').filter({hasText:notes[0].title}).innerText()).includes('成功'));
 assert((await page.locator('.ant-table-row').filter({hasText:notes[2].title}).innerText()).includes('失败'));

 const firstNote=page.locator('.collection-note-cell').first();
 const tableAlignment=await page.locator('.ant-table').evaluate(table=>{const head=[...table.querySelectorAll('thead th')],cells=[...table.querySelector('tbody tr.ant-table-row').querySelectorAll('td')];return head.map((el,index)=>{const h=el.getBoundingClientRect(),c=cells[index].getBoundingClientRect();return Math.abs(h.x-c.x)<1&&Math.abs(h.width-c.width)<1&&getComputedStyle(el).paddingLeft===getComputedStyle(cells[index]).paddingLeft})});assert(tableAlignment.every(Boolean),'Header and body use the same column grid');
 assert.equal(await firstNote.locator('.collection-note-cover img').count(),1);
 assert.equal(await firstNote.locator('.platform-badge').count(),1);
 assert.equal(await firstNote.locator('.collection-note-kind').count(),1);
 await columns.click(); await page.locator('.collection-column-options').getByText('来源平台',{exact:true}).click(); await columns.click();
 assert.equal(await firstNote.locator('.platform-badge').count(),0);
 assert.equal(await firstNote.locator('.collection-note-kind').count(),1);
 await columns.click(); await page.locator('.collection-column-options').getByText('笔记类型',{exact:true}).click(); await columns.click();
 assert.equal(await firstNote.locator('.collection-note-kind').count(),0);
 const selectPage=page.getByRole('checkbox',{name:'选择本页',exact:true});
 await selectPage.check();
 const batch=page.getByRole('button',{name:'批量删除',exact:true});
 const selection=await selectPage.locator('..').boundingBox(),action=await batch.boundingBox();
 assert(Math.abs(selection.y+selection.height/2-action.y-action.height/2)<2,'Batch actions align with page selection');
 assert.equal(await page.locator('.collection-selection-bar').getByText(/已选 \d+ 篇/).count(),0);
 assert.deepEqual((await page.locator('.collection-batch-actions .ant-btn').allTextContents()).map(t=>t.trim()),['批量删除','批量加入仿写库']);assert.equal(await batch.evaluate(el=>el.classList.contains('ant-btn-dangerous')),false);const deleteStyle=await batch.evaluate(el=>{const s=getComputedStyle(el);return{border:s.borderTopColor,color:s.color};});assert.equal(deleteStyle.border,'rgba(0, 0, 0, 0)');
 const addBatch=await page.getByRole('button',{name:'批量加入仿写库',exact:true}).boundingBox();
 assert(Math.abs(addBatch.width-action.width)<1&&Math.abs(addBatch.height-action.height)<1,'Batch buttons have balanced dimensions');
 assert.equal(await page.locator('.ant-table-thead th').first().evaluate(el=>getComputedStyle(el).borderBottomWidth),'0px');
 await selectPage.uncheck();
 await page.reload();
 await page.locator('.ant-table').waitFor();
 assert.equal(await page.getByRole('columnheader',{name:'博主',exact:true}).count(),0,'Column preferences persist');
 await page.locator('.collection-primary-tools .ant-segmented-item').first().click();
 const card=page.locator('.collection-card').first();
 assert.equal(await page.getByRole('button',{name:'更多采集操作',exact:true}).count(),0);
 const cardCopy=card.locator('.collection-card-copy');
 assert.equal(await cardCopy.evaluate(el=>getComputedStyle(el).webkitLineClamp),'3');
 assert(await cardCopy.evaluate(el=>el.scrollHeight>el.clientHeight));
 const link=await card.getByRole('link',{name:'打开原始笔记',exact:true}).boundingBox(),remove=await card.getByRole('button',{name:'删除采集记录',exact:true}).boundingBox();
 assert(remove.x>link.x,'Delete button follows external link');
 await card.getByRole('button',{name:'删除采集记录',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:/^取\s*消$/}).click();
 await page.getByRole('dialog').waitFor({state:'hidden'});
 assert(!(await cardCopy.innerText()).includes('[话题]'));
 assert(!(await cardCopy.innerText()).includes('#生活记录'));
 await card.locator('.collection-card-body > strong').click();
 const noteDialog=page.getByRole('dialog',{name:'笔记详情',exact:true});
 await noteDialog.locator('.collection-note-dialog-content h2').waitFor();
 await page.waitForFunction(()=>{const modal=document.querySelector('.collection-note-modal');return modal&&getComputedStyle(modal).transform==='none'&&!modal.className.includes('zoom-');});
 assert.equal(await page.locator('.inline-detail-page').count(),0);
 assert(await page.locator('.collection-grid').isVisible(),'Original list remains behind the dialog');
 assert(!(await noteDialog.getByRole('region',{name:'笔记文案',exact:true}).innerText()).includes('[话题]'));
 assert(!(await noteDialog.getByRole('region',{name:'笔记文案',exact:true}).innerText()).includes('#生活记录'));
 assert((await noteDialog.locator('.collection-note-dialog-topics').innerText()).includes('#生活记录'));
 assert.equal(await noteDialog.locator('.collection-note-management,.collection-note-dialog-stats').count(),0);
 assert.equal(await noteDialog.locator('.collection-card-dots').count(),0);
 assert.deepEqual((await noteDialog.locator('.collection-note-dialog-actions .ant-btn').allTextContents()).map(t=>t.trim()),['参考链接','以此笔记开始仿写']);
 for(const width of [1144,823,547,390]){
  await page.setViewportSize({width,height:width===390?844:751});
  const box=await noteDialog.boundingBox();assert(box.x>=8&&box.x+box.width<=width-8&&box.y>=0&&box.y+box.height<=(width===390?844:751)+1,'Dialog stays inside viewport');
  assert(await noteDialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  if(width>700){const media=await noteDialog.locator('.collection-note-dialog-media').boundingBox(),copy=await noteDialog.locator('.collection-note-dialog-content').boundingBox();assert(media.x+media.width<=copy.x+1&&media.y<copy.y+copy.height);}
  const footerButtons=await noteDialog.locator('.collection-note-dialog-actions .ant-btn').evaluateAll(items=>items.map(el=>{const b=el.getBoundingClientRect();return{width:b.width,height:b.height};}));
  assert(Math.abs(footerButtons[0].width-footerButtons[1].width)<1&&Math.abs(footerButtons[0].height-footerButtons[1].height)<1);
  const mediaButtons=await noteDialog.locator('.collection-asset-actions .ant-btn').evaluateAll(items=>items.map(el=>{const b=el.getBoundingClientRect();return{width:b.width,height:b.height};}));
  assert.equal(mediaButtons.length,3);assert(Math.max(...mediaButtons.map(b=>b.width))-Math.min(...mediaButtons.map(b=>b.width))<1);
  for(const tabName of ['提取图片文字','视频转写','素材预览']){
    await noteDialog.getByRole('tab',{name:tabName,exact:true}).click();
    const switched=await noteDialog.boundingBox();
    assert(Math.abs(switched.width-box.width)<1&&Math.abs(switched.height-box.height)<1,'Modal size stays stable across media and empty-result tabs');
  }
  await page.screenshot({path:path.join(root,`note-dialog-${width}.png`),fullPage:true});
 }
 await noteDialog.locator('.ant-modal-close').click();await noteDialog.waitFor({state:'hidden'});
 await page.setViewportSize({width:1440,height:1000});
 const backgroundVideo=page.locator('.collection-card video');await backgroundVideo.evaluate(async video=>{video.muted=true;await video.play();});
 await page.locator('.collection-card').nth(1).locator('.collection-card-body > strong').click();
 await noteDialog.locator('video').waitFor();assert(await backgroundVideo.evaluate(video=>video.paused));
 const detailVideo=await noteDialog.locator('video').elementHandle();await detailVideo.evaluate(async video=>{video.muted=true;await video.play();});
 await noteDialog.getByRole('tab',{name:'视频转写',exact:true}).click();await noteDialog.getByText(/暂无视频转写结果/).waitFor();assert(await detailVideo.evaluate(video=>video.paused||!video.isConnected));
 await noteDialog.locator('.ant-modal-close').click();await noteDialog.waitFor({state:'hidden'});

 await navigation.getByRole('button',{name:'回收站',exact:true}).click();
 await page.waitForURL(u=>u.hash==='#trash');
 await page.locator('.collection-card').waitFor();
 assert.equal(await page.locator('.capture-card').count(),0);
 assert(queries.some(q=>new URLSearchParams(q).get('deleted')==='true'));
 await page.reload();
 await page.locator('.collection-card').waitFor();
 assert.equal(await page.locator('.workspace-crumb').innerText(),'回收站');
 await page.locator('.collection-card').getByRole('button',{name:'恢复到采集库',exact:true}).click();
 await page.getByText('暂无已删除内容',{exact:true}).waitFor();
 assert.deepEqual(restored,['trash-note']);
 await navigation.getByRole('button',{name:'采集工作台',exact:true}).click();
 await page.waitForFunction(count=>document.querySelectorAll('.collection-card').length===count,notes.length);
 assert.equal(await page.locator('.capture-card').count(),1);
 assert(!queries.some(q=>new URLSearchParams(q).has('kind')),'No removed note-type filter sent');
 for(const width of [1720,1144,823,547,390]) {
   await page.locator(".ant-popover:visible").waitFor({state:"hidden"}); await page.setViewportSize({width,height:width===390?844:1000});
   await page.screenshot({path:path.join(root,`workflow-collections-${width}.png`),fullPage:true});
   assert.equal(await columns.count(),0);
   await page.locator('.collection-primary-tools .ant-segmented-item').nth(1).click();
   await columns.click();
   await page.locator('.collection-column-options').waitFor({state:'visible'}); await page.waitForFunction(()=>{const p=document.querySelector('.ant-popover:not(.ant-popover-hidden)');return p&&getComputedStyle(p).opacity==='1'&&!p.className.includes('zoom');}); 
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   const b=await page.locator('.collection-column-options').boundingBox(); assert(b.x>=0&&b.x+b.width<=width&&b.y>=0&&b.y+b.height<= (width===390?764:1000),'Column panel fits visible viewport');
   await page.screenshot({path:path.join(root,`workflow-columns-${width}.png`),fullPage:true});
   await columns.click();
   await page.locator('.collection-primary-tools .ant-segmented-item').nth(0).click();
 }
 await page.setViewportSize({width:1440,height:1000});
 async function submit() {
   const input=page.getByRole('textbox',{name:'笔记链接或分享文字'});
   await input.fill('https://www.xiaohongshu.com/explore/qa');
   const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/collections'&&r.request().method()==='POST');
   await page.getByRole('button',{name:/开始采集$/}).click();
   assert((await response).ok(),'Collection submission succeeds');
   await page.waitForFunction(()=>document.querySelector('#capture-inputs textarea')?.value==='');
   assert.equal(await page.getByRole('region',{name:'本次采集进度',exact:true}).count(),0);
   assert.equal(await page.locator('.collection-next-step').count(),0);
   assert.equal(await page.getByText('灵感已就绪，开始创作吧',{exact:true}).count(),0);
   assert.equal(await page.locator('.collection-card').count(),notes.length,'Existing notes remain available');
 }
 await submit();
 jobState='succeeded'; await submit();
 mode='deleted'; await submit();
 mode='duplicate'; await submit();
 mode='queued'; jobState='failed'; await submit();
 await page.screenshot({path:path.join(root,'workflow-collected-next.png'),fullPage:true});
 const next=page.locator('.collection-card').first().getByRole('button',{name:/去仿写/});
 await next.click(); await page.waitForURL(u=>u.hash==='#rewrites'); assert.equal(created[0].note_id,'n0'); assert.equal(created.length,1);
 await page.locator('.creation-workflow').waitFor();
 const desktopRail=page.locator('.rewrite-project-rail-desktop');
 const basic=page.getByRole('region',{name:'账号基本信息',exact:true});
 await basic.waitFor();
 const accountValues={'账号名称':'清晨手记','账号主体':'独立咖啡师','账号定位':'分享家庭手冲方法','用户画像':'刚开始学习手冲的上班族','账号风格':'真诚克制，温暖纪实的画面'};
 assert(await basic.getByRole('button',{name:'确认基本信息',exact:true}).isDisabled());
 for(const button of await page.getByRole('navigation',{name:'仿写创作步骤'}).getByRole('button').all())assert(await button.isEnabled(),'Modules are available without confirming basic information');
 for(const [label,value] of Object.entries(accountValues))await basic.getByRole('textbox',{name:label,exact:true}).fill(value);
 await page.waitForFunction(()=>document.querySelector('.workflow-save-announcement')?.textContent.includes('已自动保存'));
 assert.equal(workflowData.p1.workflow.drafts.account.data.account_name,'清晨手记');
 for(const width of [1720,1144,823,547,390]){
   await page.setViewportSize({width,height:width<700?844:1000});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   assert(await basic.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
   await page.screenshot({path:path.join(root,`account-profile-${width}.png`),fullPage:true});
 }
 await page.setViewportSize({width:1440,height:1000});
 await desktopRail.locator('.project-title-button').filter({hasText:projects[1].name}).click();
 await basic.waitFor();assert.equal(await basic.getByRole('textbox',{name:'账号名称',exact:true}).inputValue(),'');
 await basic.getByRole('button',{name:'跳过，继续仿写',exact:true}).click();
 await page.getByRole('textbox',{name:'标题仿写补充要求',exact:true}).waitFor();
 assert.equal(workflowData.p2.workflow.account_profile.status,'skipped');
 await desktopRail.locator('.project-title-button').filter({hasText:projects[0].name}).click();
 await basic.waitFor();
 for(const [label,value] of Object.entries(accountValues))assert.equal(await basic.getByRole('textbox',{name:label,exact:true}).inputValue(),value);
 await basic.getByRole('button',{name:'确认基本信息',exact:true}).click();
 await page.getByRole('textbox',{name:'标题仿写补充要求',exact:true}).waitFor();
 assert.equal(workflowData.p1.workflow.account_profile.status,'confirmed');
 await page.reload();
 await desktopRail.locator('.project-title-button').filter({hasText:projects[0].name}).click();
 await page.getByRole('textbox',{name:'标题仿写补充要求',exact:true}).waitFor();
 await page.getByRole('navigation',{name:'仿写创作步骤'}).getByRole('button',{name:/基本信息/}).click();
 await basic.waitFor();assert.equal(await basic.getByRole('textbox',{name:'账号风格',exact:true}).inputValue(),accountValues['账号风格']);
 await page.getByRole('navigation',{name:'仿写创作步骤'}).getByRole('button',{name:/标题仿写/}).click();
 assert(await desktopRail.isVisible());
 assert.equal(await desktopRail.getByRole('heading',{name:'Projects',exact:true}).count(),1);
 assert.equal(await desktopRail.locator('.rewrite-project-heading').count(),0);
 const projectSearch=await desktopRail.getByRole('textbox',{name:'搜索项目',exact:true}).boundingBox(),newProject=await desktopRail.getByRole('button',{name:'新建创作项目',exact:true}).boundingBox();
 assert(newProject.x>projectSearch.x+projectSearch.width&&Math.abs(projectSearch.y+projectSearch.height/2-newProject.y-newProject.height/2)<2);
 assert.equal(await desktopRail.locator('.rewrite-project-search .anticon-form').count(),1);
 assert.equal(await desktopRail.locator('.ant-segmented,.ant-select,.ant-checkbox-wrapper,.project-title-button small').count(),0,'No removed project filters, selection controls or date');
 assert.equal(await page.getByRole('button',{name:'返回项目列表',exact:true}).count(),0);

 assert.equal(await desktopRail.locator('.anticon-ellipsis').count(),0);
 await desktopRail.getByRole('button',{name:`删除项目 ${projects[0].name}`,exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:/^取\s*消$/}).click();
 await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.getByRole('textbox',{name:'标题仿写补充要求',exact:true}).fill('项目一的补充要求');
 await page.waitForFunction(()=>document.querySelector('.workflow-save-announcement')?.textContent.includes('已自动保存'));
 await desktopRail.locator('.project-title-button').filter({hasText:projects[1].name}).click();
 await page.locator(`.creation-workflow[data-project-id="${projects[1].id}"]`).waitFor();
 await desktopRail.locator('.project-title-button').filter({hasText:projects[0].name}).click();
 await page.locator(`.creation-workflow[data-project-id="${projects[0].id}"]`).waitFor();
 assert.equal(await page.locator('.creation-workflow .workflow-header').count(),0);
 assert.equal(await page.getByRole('heading',{name:projects[0].name,exact:true}).count(),0);
 await page.waitForFunction(()=>document.querySelector('textarea[aria-label="标题仿写补充要求"]')?.value==='项目一的补充要求');
 for(const width of [1720,1144,823,547,390]){
  await page.setViewportSize({width,height:width<700?844:1000});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert(await page.locator('.rewrite-main').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Editor content stays within workspace');
  if(width>1000){
    const rail=await desktopRail.boundingBox(),main=await page.locator('.rewrite-main').boundingBox(),sidebar=await page.locator('.sidebar').boundingBox();
    assert(Math.abs(rail.x-sidebar.x-sidebar.width-12)<2);assert(Math.abs(rail.x+rail.width-main.x)<2);
    const railPanel=await desktopRail.locator('.rewrite-project-rail').boundingBox();assert(Math.abs(railPanel.y+railPanel.height-sidebar.y-sidebar.height)<2,'Floating list bottom aligns with sidebar');
    assert(await desktopRail.isVisible());
  }else{
    assert(!(await desktopRail.isVisible()));
    await page.getByRole('button',{name:'打开项目列表',exact:true}).click();
    await page.locator('.rewrite-project-drawer').waitFor({state:'visible'});
    await page.locator('.rewrite-project-drawer .project-title-button').filter({hasText:projects[0].name}).click();
    await page.locator('.rewrite-project-drawer').waitFor({state:'hidden'});
  }
  await page.screenshot({path:path.join(root,`project-rail-${width}.png`),fullPage:true});
 }

 await page.setViewportSize({width:1144,height:751});
 const draftBeforeTasks=await page.getByRole('textbox',{name:'标题仿写补充要求',exact:true}).inputValue();
 await page.getByRole('button',{name:'后台任务',exact:true}).click();
 const tasks=page.getByRole('dialog',{name:'后台任务列表',exact:true});
 await tasks.locator('[data-job-id="asr-config"]').waitFor();
 await page.waitForFunction(()=>{const el=document.querySelector('.task-modal');return el&&getComputedStyle(el).transform==='none'&&!el.className.includes('zoom-')});
 assert(await page.locator('.creation-workflow').isVisible(),'Editor stays mounted behind task window');
 assert.equal(await tasks.getByRole('button',{name:'返回工作区',exact:true}).count(),0);
 assert.equal(await tasks.locator('.utility-page-header').count(),0);
 assert.equal(await tasks.getByText('关闭页面不影响后台任务。待处理任务会说明原因和下一步操作。',{exact:true}).count(),0);
 await tasks.getByRole('searchbox',{name:'搜索后台任务',exact:true}).fill('提取音轨');
 await page.waitForFunction(()=>document.querySelectorAll('.task-modal [data-job-id]').length===1);
 assert((await tasks.innerText()).includes('原视频转写'));
 await tasks.getByRole('searchbox',{name:'搜索后台任务',exact:true}).fill('');
 assert.equal(await tasks.getByRole('radio',{name:/待处理/}).count(),0);
 await tasks.locator('.ant-segmented-item').filter({hasText:'进行中'}).click();
 assert(await tasks.getByRole('radio',{name:/进行中/}).isChecked());
 assert.equal(await tasks.locator('[data-job-id="download-active"]').count(),1);
 assert.equal(await tasks.locator('[data-job-id="asr-config"]').count(),1);
 assert.equal(await tasks.locator('[data-job-id="rewrite-done"]').count(),0);
 await tasks.locator('.ant-segmented-item').filter({hasText:'全部'}).click();
 for(const width of [1720,1144,823,547,390]){
  await page.setViewportSize({width,height:width<700?844:751});
  const box=await tasks.boundingBox();assert(box.x>=8&&box.x+box.width<=width-8&&box.y>=0&&box.y+box.height<=(width<700?844:751)+1);
  assert(await tasks.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  assert(await tasks.locator('.task-list').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  if(width>1000){const search=await tasks.locator('.ant-input-search').boundingBox(),tabs=await tasks.locator('.ant-segmented').boundingBox(),toolbar=await tasks.locator('.task-dialog-toolbar').boundingBox(),category=await tasks.getByRole('combobox',{name:'项目类型筛选',exact:true}).locator('xpath=ancestor::div[contains(@class,"ant-select")]').first().boundingBox();assert(search.x+search.width<category.x&&category.x+category.width<tabs.x);assert(Math.abs(search.y+search.height/2-tabs.y-tabs.height/2)<2);assert(search.width<toolbar.width*.4&&tabs.width>search.width,'Task search leaves room for project and state filters');}
  assert(await tasks.locator('.ant-segmented-item-label').evaluateAll(items=>items.every(el=>el.scrollWidth<=el.clientWidth+1)),'Task filter names stay fully visible');
  await page.screenshot({path:path.join(root,`task-modal-${width}.png`),fullPage:true});
 }
 await page.setViewportSize({width:1144,height:751});
 await tasks.locator('[data-job-id="asr-config"]').getByRole('button',{name:/重\s*试$/}).click();
 await page.locator('.ant-popconfirm-buttons .ant-btn-primary').click();
 await page.waitForFunction(()=>document.querySelector('[data-job-id="asr-config"]')?.getAttribute('data-state')==='queued');
 assert.deepEqual(taskRetries,['asr-config']);
 assert.equal(await tasks.locator('[data-job-id="asr-config"]').getByRole('button',{name:/重\s*试$/}).count(),0);
 await tasks.locator('.ant-modal-close').click();await tasks.waitFor({state:'hidden'});
 await page.waitForURL(u=>u.hash==='#rewrites');
 assert.equal(await page.getByRole('textbox',{name:'标题仿写补充要求',exact:true}).inputValue(),draftBeforeTasks);
 await navigation.getByRole('button',{name:'发布管理',exact:true}).click();
 await page.locator('.publication-filter-grid').waitFor();
 for(const width of [1720,1144,823,547,390]){
   await page.setViewportSize({width,height:width<700?844:1000});
   const filters=await page.locator('.publication-filter-grid').evaluate(el=>({width:el.clientWidth,overflow:el.scrollWidth>el.clientWidth+1,children:[...el.children].map(child=>{const b=child.getBoundingClientRect();return{left:b.left,right:b.right};}),box:el.getBoundingClientRect().toJSON()}));
   assert(!filters.overflow,JSON.stringify({width,...filters}));
   for(const child of filters.children)assert(child.left>=filters.box.left-1&&child.right<=filters.box.right+1);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.screenshot({path:path.join(root,`publication-filters-${width}.png`),fullPage:true});
 }
 assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(root,'workflow-collection-verification.json'),JSON.stringify({checks:['standalone column preferences and persistence','sidebar trash route and reload','restore deleted note','removed refresh/type/more controls','1720/1144/823/547/390 responsive layout','queued/succeeded/duplicate/deleted/failed submissions without summary panel','existing notes retained','rewrite entry from note card','combined note cell and optional metadata','aligned batch actions','three-line copy and direct deletion','persistent desktop project rail and mobile drawer','project draft preserved across switches','image/video centered detail dialogs','body/topics separated without source mutation','video playback stops when preview changes','simplified project list without dates','explicit collection success/failure','direct project delete with confirmation','task modal search and state filters','responsive task cards and retry','task overlay preserves editor draft'],errors,created,restored},null,2));
 console.log('PASS collection workflow and responsive toolbar');
 } catch(error) {
   await browser.contexts()[0]?.pages()[0]?.screenshot({path:path.join(root,'failure.png'),fullPage:true}).catch(()=>{});
   throw error;
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});








