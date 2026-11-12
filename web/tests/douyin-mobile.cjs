const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {buildSync}=require('esbuild');
const {chromium,browserLaunchOptions}=require('./browser.cjs');
const built=buildSync({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{App}from'antd';import Mobile from'./src/MobilePublishDialog';createRoot(document.getElementById('root')).render(<App><Mobile publication={{id:'dy',target_platform:'douyin',kind:'video',ready:true,title:'抖音视频测试',body:'完整正文',asset_ids:['a']}} onClose={()=>{}}/></App>);`,resolveDir:path.resolve(__dirname,'..'),loader:'tsx'},bundle:true,write:false,outdir:'out',platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"production"'}});
(async()=>{
const browser=await chromium.launch(browserLaunchOptions);
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let session,creates=0,mode='development';
 await page.route('http://127.0.0.1:18886/**',route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/f.css"><div id="root"></div><script src="/f.js"></script>'});
  if(u.pathname==='/f.js')return route.fulfill({contentType:'text/javascript',body:built.outputFiles.find(f=>f.path.endsWith('.js')).text});
  if(u.pathname==='/f.css')return route.fulfill({contentType:'text/css',body:built.outputFiles.find(f=>f.path.endsWith('.css')).text});
  if(u.pathname==='/api/v1/session')return route.fulfill({json:{csrf_token:'fixture'}});
  if(u.pathname.endsWith('/miniapp/douyin/cloud'))return route.fulfill({json:{available:true,launch_environment:mode}});
  if(u.pathname.endsWith('/cancel')){session={...session,state:'cancelled'};return route.fulfill({json:session});}
  if(u.pathname.endsWith('/douyin-handoff')){
   if(req.method()==='POST'){
    creates++;session={id:'task-'+creates,state:'created',expires_at:new Date(Date.now()+120000).toISOString()};
    return route.fulfill({status:201,json:{...session,...(mode==='development'?{launch_path:'pages/publish/index?ticket='+'a'.repeat(43)}:{qr_image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1kAAAAASUVORK5CYII='})}});
   }
   return route.fulfill(session?{json:session}:{status:404,json:{error:'尚未创建'}});
  }
  throw Error('unexpected request '+u.pathname);
 });
 await page.goto('http://127.0.0.1:18886');
 await page.getByRole('button',{name:'创建调试任务',exact:true}).waitFor();
 await page.getByRole('button',{name:'创建调试任务',exact:true}).evaluate(el=>{el.click();el.click()});
 const input=page.getByRole('textbox',{name:'抖音调试启动参数'});
 await input.waitFor();assert.match(await input.inputValue(),/^ticket=a{43}&manualClaim=1$/);assert.equal(creates,1);
 await page.waitForTimeout(2300);assert.equal(await input.count(),1,'poll lost launch parameter');
 assert.equal(await page.locator('.mobile-publish-qr').count(),0,'development mode showed production QR');
 const output=path.resolve(__dirname,'../test-results/douyin-mobile');fs.mkdirSync(output,{recursive:true});
 for(const width of [390,1440]){await page.setViewportSize({width,height:900});await page.screenshot({path:path.join(output,`development-${width}.png`),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.getByRole('button',{name:'撤销任务',exact:true}).click();await page.getByText('二维码已撤销',{exact:true}).waitFor();
 mode='production';session=undefined;await page.reload();
 await page.getByRole('button',{name:'生成二维码',exact:true}).click();await page.getByAltText('抖音扫码发布二维码').waitFor();
 session={...session,state:'editor_opened',client_event:'client_publish_success'};
 await page.getByText('手机返回发布成功，尚未取得平台核验结果；请在抖音核对作品后手动记录。').waitFor({timeout:6000});
 assert.equal(await page.getByAltText('抖音扫码发布二维码').count(),0,'consumed QR stayed visible');
 assert.deepEqual(errors,[]);
 console.log('PASS Douyin: development/production isolation, parameters survive polling, duplicate prevention, revoke, unverified callback, desktop/mobile layouts');
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
