const { chromium } = require('./browser.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.env.WORKBENCH_UI_QA_OUT || path.resolve(__dirname, '../../verification/ui-refinement');
const chrome = path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe');
const stamp = '2026-10-22T07:00:00Z';
const users = [{ id:'admin', username:'qa-admin', display_name:'管理员', role:'admin', status:'active', created_at:stamp }, {id:'creator',username:'qa-user',display_name:'创作用户',role:'creator',status:'active',created_at:stamp}];
const notes = ['把日常过成喜欢的样子','城市漫游，发现新的灵感','给忙碌的生活留一点空白','一杯咖啡的松弛时刻'].map((title,i)=>({id:'n'+i,note_id:'n'+i,title,author:['日常手记','漫游研究所','慢生活提案','咖啡日记'][i],platform:'xhs',kind:'image',tags:['生活记录','灵感收藏'],revision_id:'r'+i,likes:1280+i*120,favorites:328,comments:26,created_at:stamp,updated_at:stamp}));
const assets = notes.map((n,i)=>({id:'a'+i,name:n.title,kind:'image',mime:'image/svg+xml',source:'collection',status:'ready',revision_id:n.revision_id,width:600,height:720,size:1000,position:0,created_at:stamp}));
const usage = [{id:'u1',user_id:'creator',user:'创作用户',at:stamp,kind:'rewrite',feature:'文案生成',model:'文案模型',input:1520,output:860,total:2380,cost:0.0238,state:'succeeded',stateLabel:'已完成',jobID:'job'}];
let authRole=null, authRequests=0, failure=false;
const unknown = new Set();
async function fixture(route) {
  const req=route.request(), u=new URL(req.url()), p=u.pathname.slice(7);
  let body=[];
  if (p==='/auth/me') return route.fulfill({status: authRole?200:401,json:authRole?{user:users[authRole==='admin'?0:1]}:{error:'未登录'}});
  if (p==='/session') body={csrf_token:'qa-session'};
  else if (p==='/auth/login') {authRequests++; return route.fulfill({status:401,json:{error:'用户名或密码错误'}});}
  else if(p==='/admin/overview') { if(failure)return route.fulfill({status:503,json:{error:'服务暂时不可用'}}); body={users,usage,tasks:[],summary:{active_users:2,calls:1,tokens:2380,cost:.0238,active_tasks:0,failed_tasks:0},price_per_1k:.01}; }
  else if(p==='/admin/audit') body=[{id:1,at:stamp,actor:'管理员',action:'login',detail:'管理员登录'}];
  else if(p==='/sync') body={reset:true,more:false,epoch:'qa',cursor:1,changes:assets.map(value=>({entity:'assets',id:value.id,value}))};
  else if(p==='/collections') body={items:notes,total:notes.length};
  else if(p==='/usage') body={usage,price_per_1k:.01};
  else if(p==='/admin/settings' || p==='/settings') body={services:{text:{},ocr:{},asr:{},collector_url:''},dependencies:{}};
  else if(p.startsWith('/assets/') && p.endsWith('/file')) {
    const i=Number(p.split('/')[2].slice(1));
    const colors=['#b8bba5','#c6a389','#d9c9b5','#929f95'];
    return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="720"><rect width="600" height="720" fill="${colors[i]}"/><circle cx="440" cy="130" r="110" fill="#f5eddb"/><path d="M0 500Q160 310 330 500T650 510V720H0Z" fill="#374a39" opacity=".6"/><rect x="80" y="180" width="280" height="360" rx="140" fill="#f3eada"/><path d="M80 390Q220 220 360 390V540H80Z" fill="#986c53"/><text x="42" y="655" font-size="22" fill="#fff" font-family="Georgia" letter-spacing="3">SLOW LIVING / 0${i+1}</text></svg>`});
  } else if(p.startsWith('/admin/models/') || p.startsWith('/rewrite-models') || p==='/image-models' || p==='/video-models' || p==='/publications' || p==='/jobs') body=[];
  else {unknown.add(p); body=[];}
  return route.fulfill({json:body});
}
(async()=>{
  await fs.mkdir(root,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-proxy-server']});
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},deviceScaleFactor:1});
  const page=await context.newPage();
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const report=[];
  const base=process.env.UI_BASE || 'http://127.0.0.1:4173';
  if(process.env.WORKBENCH_BEFORE_URL) {
    await page.goto(process.env.WORKBENCH_BEFORE_URL,{waitUntil:'domcontentloaded'});
    await page.locator('.login-form-card').waitFor();
    await page.screenshot({path:path.join(root,'before-user-login.png'),fullPage:true});
  }
  await context.route('**/api/v1/**',fixture);
  async function shot(name, route, width=1440, height=1000) {
    await page.setViewportSize({width,height});
    await page.goto(base+'/?qa='+name+'#/'+route,{waitUntil:'domcontentloaded'});
    await page.locator('.login-form-card,.admin-content,.page-content').first().waitFor();
    if (authRole === 'admin') await page.locator('.admin-loading').waitFor({state:'hidden'});
    if (authRole === 'creator' && route === 'collections') await page.locator('.collection-card').first().waitFor();
    if (authRole === 'creator') await page.locator('.page-content .workspace-loading').waitFor({state:'hidden'});
    await page.evaluate(()=>document.fonts.ready);
    const dims=await page.evaluate(()=>({view:innerWidth,scroll:document.documentElement.scrollWidth}));
    report.push({name,width,...dims});
    if(dims.scroll>dims.view+1) {
      report[report.length-1].overflow=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1 && getComputedStyle(e).position!=='fixed').slice(0,10).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right})));
    }
    await page.screenshot({path:path.join(root,name+'.png'),fullPage:true});
    console.log('Verified screenshot:',name);
  }
  await shot('user-login-desktop','login');
  await page.getByRole('button',{name:'进入工作台'}).click();
  await page.getByRole('alert').filter({hasText:'请输入用户名和密码'}).waitFor();
  assert.equal(authRequests,0,'Empty forms must not issue auth requests');
  await page.getByRole('textbox',{name:'用户名',exact:true}).fill('qa');
  await page.locator('input[name=password]').fill('wrong-password');
  await page.locator('input[name=password]').press('Enter');
  await page.getByRole('alert').filter({hasText:'用户名或密码错误'}).waitFor();
  assert.equal(authRequests,1,'Enter submits once');
  await page.locator('.login-user-link').click();
  await page.getByRole('form',{name:'管理员登录',exact:true}).waitFor();
  await shot('admin-login-desktop','admin/login');
  await shot('user-login-mobile','login',390,844);
  await shot('admin-login-mobile','admin/login',390,844);
  await shot('login-tablet','login',820,1024);
  authRole='creator';
  await shot('workspace-desktop','collections');
  await page.locator('.ant-segmented-item').last().click();
  await page.locator('.ant-table').waitFor();
  await page.locator('.ant-segmented-item').first().click();
  await shot('workspace-mobile','collections',390,844);
  await page.locator('.page-content').evaluate(el=>{el.scrollTop=el.scrollHeight;});
  const lastCard=await page.locator('.collection-card').last().boundingBox();
  const navigation=await page.locator('.sidebar').boundingBox();
  assert(lastCard && navigation && lastCard.y+lastCard.height<=navigation.y,'Last collection card remains reachable above bottom navigation');
  await page.screenshot({path:path.join(root,'workspace-mobile-library.png'),fullPage:true});
  await page.locator('.sidebar').getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await shot('workspace-tablet','collections',820,1024);
  for(const route of ['rewrites','publications','usage']) {
    await shot('user-'+route+'-mobile',route,390,844);
    await shot('user-'+route+'-desktop',route);
  }
  authRole='admin';
  for(const route of ['overview','users','models','usage','tasks','audit']) {
    await shot('admin-'+route+'-desktop','admin/'+route);
    await shot('admin-'+route+'-mobile','admin/'+route,390,844);
  }
  await fs.writeFile(path.join(root,'ui-verification.json'),JSON.stringify({report,errors,unknown:[...unknown]},null,2));
  failure=true;
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base+'/?qa=offline#/admin/overview',{waitUntil:'networkidle'});
  await page.getByRole('alert').filter({hasText:'暂时无法读取服务端数据'}).waitFor();
  assert(await page.getByRole('status').filter({hasText:'连接异常'}).count());
  await fs.writeFile(path.join(root,'ui-verification.json'),JSON.stringify({report,errors,unknown:[...unknown],checks:['Empty login validation','Single Enter submit','Role entry switching','Grid/list switching','Mobile settings access','Admin connection error state']},null,2));
  await browser.close();
  console.log(JSON.stringify({screenshots:report.length,overflows:report.filter(x=>x.scroll>x.view+1),errors,unknown:[...unknown]},null,2));
  assert.equal(errors.length,0,'No uncaught page errors');
  assert.equal(report.filter(x=>x.scroll>x.view+1).length,0,'No horizontal document overflow');
})().catch(e=>{console.error(e);process.exit(1)});
