const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {buildSync}=require('esbuild');
const {chromium,browserLaunchOptions}=require('./browser.cjs');
const built=buildSync({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import Mobile from'./src/MobilePublishDialog';createRoot(document.getElementById('root')).render(<Mobile publication={{id:'dy',target_platform:'douyin',kind:'video',ready:true,title:'视频预览测试',body:'完整正文',asset_ids:['a']}} onClose={()=>{}}/>);`,resolveDir:path.resolve(__dirname,'..'),loader:'tsx'},bundle:true,write:false,outdir:'out',platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"production"'}});
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1kAAAAASUVORK5CYII=';
(async()=>{
 const browser=await chromium.launch(browserLaunchOptions);
 try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  let session,creates=0,previews=0,fail=false,hold;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://127.0.0.1:18886/**',route=>{
   const u=new URL(route.request().url()),method=route.request().method();
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/f.css"><div id="root"></div><script src="/f.js"></script>'});
   if(u.pathname==='/f.js'||u.pathname==='/f.css')return route.fulfill({contentType:u.pathname.endsWith('js')?'text/javascript':'text/css',body:built.outputFiles.find(f=>f.path.endsWith(u.pathname.endsWith('js')?'.js':'.css')).text});
   if(u.pathname==='/api/v1/session')return route.fulfill({json:{csrf_token:'fixture'}});
   if(u.pathname.endsWith('/miniapp/douyin/cloud'))return route.fulfill({json:{available:true,launch_environment:'development'}});
   if(u.pathname.endsWith('/cancel')){session={...session,state:'cancelled'};return route.fulfill({json:session});}
   if(u.pathname.endsWith('/douyin-handoff')){
    if(method==='POST'){creates++;session={id:'task-'+creates,state:'created',expires_at:new Date(Date.now()+120000).toISOString()};return route.fulfill({status:201,json:{...session,launch_path:'pages/publish/index?ticket='+'a'.repeat(43)}});}
    return route.fulfill(session?{json:session}:{status:404,json:{error:'未创建'}});
   }
   throw Error('unexpected request '+u.pathname);
  });
  await page.route('http://127.0.0.1:17843/**',async route=>{
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type'}});
   previews++;const data=route.request().postDataJSON();
   assert.match(data.launch_path,/^pages\/publish\/index\?ticket=a{43}$/);assert.equal(route.request().headers().authorization,'Bearer '+'b'.repeat(48));
   if(hold)await hold;
   return route.fulfill({status:fail?401:200,json:fail?{error:'连接码已失效'}:{qr_image:png,expires_at:data.expires_at}});
  });
  await page.goto('http://127.0.0.1:18886');
  await page.getByRole('button',{name:'创建调试任务',exact:true}).click();
  await page.getByRole('button',{name:'生成预览二维码',exact:true}).click();
  await page.getByText('请先打开本机预览助手，复制连接码到这里',{exact:true}).waitFor();assert.equal(previews,0);
  await page.getByLabel('本机预览助手连接码',{exact:true}).fill('b'.repeat(48));
  await page.getByRole('button',{name:'生成预览二维码',exact:true}).click();
  await page.getByAltText('抖音开发版预览二维码').waitFor();
  await page.waitForTimeout(2300);assert.equal(previews,1,'poll should not regenerate preview');
  const out=path.resolve(__dirname,'../test-results/douyin-preview');fs.mkdirSync(out,{recursive:true});
  for(const width of [390,1440]){await page.setViewportSize({width,height:900});await page.screenshot({path:path.join(out,`preview-${width}.png`),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.getByRole('button',{name:'撤销任务',exact:true}).click();await page.getByText('二维码已撤销',{exact:true}).waitFor();assert.equal(await page.getByAltText('抖音开发版预览二维码').count(),0);
  await page.getByRole('button',{name:'重新创建调试任务',exact:true}).click();await page.getByAltText('抖音开发版预览二维码').waitFor();assert.equal(previews,2,'paired helper should automatically preview new task');
  fail=true;await page.getByRole('button',{name:'刷新预览码',exact:true}).click();await page.getByText('连接码已失效',{exact:true}).waitFor();assert.equal(await page.getByAltText('抖音开发版预览二维码').count(),0);
  assert.equal(await page.getByRole('textbox',{name:'抖音调试启动参数'}).count(),1,'manual fallback stays available');
  fail=false;let release;hold=new Promise(r=>release=r);
  await page.getByRole('button',{name:'生成预览二维码',exact:true}).click();await page.getByRole('status').waitFor();
  await page.getByRole('button',{name:'撤销任务',exact:true}).click();await page.getByText('二维码已撤销',{exact:true}).waitFor();release();await page.waitForTimeout(300);assert.equal(await page.getByAltText('抖音开发版预览二维码').count(),0,'late preview must not revive a cancelled task');
  assert.deepEqual(errors,[]);console.log('PASS preview: pairing, auto generation, poll stability, revoke, stale result rejection, error fallback and 390/1440 layouts');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
