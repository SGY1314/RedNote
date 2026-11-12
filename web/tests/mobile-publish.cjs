const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { chromium, browserLaunchOptions } = require('./browser.cjs');
const bundle = buildSync({
  stdin: { contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{App}from'antd';import Mobile,{canPublishOnPhone}from'./src/MobilePublishDialog';import{cloudMiniappSchemeURL}from'./src/mobile-model';
const publication={id:'p',title:'手机发布测试',body:'完整正文',topics:['生活'],kind:'image',ready:true,asset_ids:['a'],target_platform:'xhs'};
window.checkPhone=canPublishOnPhone;window.checkQR=cloudMiniappSchemeURL;
function Fixture(){const[open,setOpen]=useState(true);return <App><button onClick={()=>setOpen(true)}>打开手机发布</button>{open&&<Mobile publication={publication} onClose={()=>setOpen(false)}/>}</App>};createRoot(document.getElementById('root')).render(<Fixture/>);`, resolveDir: path.resolve(__dirname,'..'),loader:'tsx' },
  bundle:true,write:false,outdir:'out',platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"production"'},
});
const js=bundle.outputFiles.find(x=>x.path.endsWith('.js')).text;
const css=bundle.outputFiles.find(x=>x.path.endsWith('.css')).text;
const ticket='a'.repeat(32);
const launch='xhsdiscover://miniapp/123456789012345678901234_trial/pages/publish/index?scene='+ticket;
const launchURL='https://www.xiaohongshu.com/miniapp/status?'+new URLSearchParams({fullscreen:'true',link:launch});
(async()=>{
  const browser=await chromium.launch(browserLaunchOptions);
  try {
    const page=await browser.newPage();
    await page.addInitScript(()=>{window.__hidden=false;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__hidden});});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    let session,uploads=0,polls=0,cancels=0;const calls=[];
    await page.route('http://127.0.0.1:18885/**',async route=>{
      const req=route.request(),url=new URL(req.url());
      calls.push(req.method()+' '+url.pathname);
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>'});
      if(url.pathname==='/fixture.js')return route.fulfill({contentType:'text/javascript',body:js});
      if(url.pathname==='/fixture.css')return route.fulfill({contentType:'text/css',body:css});
      if(url.pathname==='/api/v1/session')return route.fulfill({json:{csrf_token:'fixture'}});
      if(url.pathname==='/api/v1/miniapp/cloud')return route.fulfill({json:{available:true}});
      if(url.pathname.endsWith('/cancel')){cancels++;session={...session,state:'cancelled'};return route.fulfill({json:session});}
      if(url.pathname.endsWith('/mobile-handoff')){
        if(req.method()==='POST'){
          uploads++;assert.match(req.postDataJSON().request_id,/^[a-f0-9]{32}$/);
          session={id:'s',state:'created',expires_at:new Date(Date.now()+120000).toISOString()};
          return route.fulfill({status:201,json:{...session,ticket,miniapp_scheme_url:launchURL}});
        }
        polls++;return route.fulfill(session?{json:session}:{status:404,json:{error:'尚未创建手机交接'}});
      }
      throw Error('Unexpected request '+req.method()+' '+url.pathname);
    });
    await page.goto('http://127.0.0.1:18885');
    await page.getByRole('button',{name:'生成二维码',exact:true}).waitFor();
    await page.waitForTimeout(350);
    await page.getByRole('button',{name:'生成二维码',exact:true}).evaluate(el=>{el.click();el.click();});
    await page.locator('.mobile-publish-qr').waitFor({timeout:10000}).catch(async e=>{console.error({uploads,polls,errors,calls,button:await page.getByRole('button',{name:'生成二维码',exact:true}).evaluate(el=>el.outerHTML),secure:await page.evaluate(()=>[isSecureContext,typeof crypto.randomUUID]),body:await page.locator('body').innerText()});throw e;});
    assert.equal(uploads,1);
    const output=path.resolve(__dirname,'../test-results/mobile-publish');fs.mkdirSync(output,{recursive:true});
    for(const width of [1720,823,547,390]){
      await page.setViewportSize({width,height:900});
      await page.screenshot({path:path.join(output,`phone-${width}.png`),fullPage:true});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflow '+width);
      const bounds=await page.locator('.ant-modal').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1,'modal overflow '+width);
    }
    await page.evaluate(()=>{window.__hidden=true;document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForTimeout(150);const before=polls;await page.waitForTimeout(2300);assert.equal(polls,before,'hidden tab polled');
    session={...session,state:'scanned'};
    await page.evaluate(()=>{window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'));});
    await page.getByText('手机已打开稿件',{exact:true}).waitFor();
    assert.equal(await page.locator('.mobile-publish-qr').count(),0,'QR not hidden after scan');
    assert.equal(uploads,1,'status change uploaded again');
    await page.getByRole('button',{name:'撤销二维码',exact:true}).click();
    await page.getByText('二维码已撤销',{exact:true}).waitFor();assert.equal(cancels,1);
    await page.getByRole('button',{name:'重新生成二维码',exact:true}).click();
    await page.locator('.mobile-publish-qr').waitFor();assert.equal(uploads,2);
    await page.getByRole('button',{name:/^关\s*闭$/}).click();
    const closedPolls=polls;await page.waitForTimeout(2300);assert.equal(polls,closedPolls,'closed dialog polled');
    await page.getByRole('button',{name:'打开手机发布',exact:true}).click();
    await page.getByText('当前交接已有二维码，关闭或刷新后不会恢复。请撤销后重新生成。').waitFor();
    assert.equal(await page.locator('.mobile-publish-qr').count(),0,'reopened dialog recovered credential');
    const checks=await page.evaluate(({ticket,launchURL})=>{
      const valid={id:'s',state:'created',expires_at:new Date(Date.now()+60000).toISOString(),ticket,miniapp_scheme_url:launchURL};
      const base={target_platform:'xhs',kind:'image',ready:true};
      return [!!window.checkQR(valid),!window.checkQR({...valid,miniapp_scheme_url:'https://evil.test/?link=x'}),!window.checkQR({...valid,ticket:'b'.repeat(32)}),window.checkPhone(base),!window.checkPhone({...base,target_platform:'douyin'}),!window.checkPhone({...base,kind:'video'}),!window.checkPhone({...base,published_at:'now'}),!window.checkPhone({...base,online_state:'preparing'})];
    },{ticket,launchURL});
    assert.ok(checks.every(Boolean));assert.deepEqual(errors,[]);
    console.log('PASS: phone QR flow; duplicate clicks; revoke/regenerate; hidden/closed polling; credential recovery rules; platform gates; URL validation; 1720/823/547/390 layout.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
