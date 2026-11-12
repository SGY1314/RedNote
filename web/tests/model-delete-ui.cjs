const {chromium,browserLaunchOptions}=require('./browser.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch(browserLaunchOptions);try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],deletions=[];let failDelete=false; const settingsWrites=[]; let services={text:{base_url:"https://text.test/v1",model:"text"},ocr:{base_url:"https://ocr.test/v1",model:"ocr",configured:true},asr:{base_url:"wss://dashscope.aliyuncs.com/api-ws/v1/inference",model:"paraformer-realtime-v2",configured:true}};
 page.on('pageerror',e=>errors.push(e.message));
 const caps=['angle','title','copy','image-plan','video-script','rewrite','image','video'];
 const catalogs=Object.fromEntries(caps.map(cap=>[cap,[{id:'shared',name:'测试模型',model:'test-model',base_url:'https://fixture.test/v1',configured:true,vision:true}]]));
 await page.route('https://workbench.test/**',async route=>{
  const req=route.request(),p=new URL(req.url()).pathname;
  if(p.startsWith('/api/v1')){
   const e=p.slice(7);let result={};
   if(e==='/auth/me')result={user:{id:'admin',username:'admin',display_name:'管理员',role:'admin',status:'active'}};
   else if(e==='/auth/session')result={csrf_token:'qa'};
   else if(e==='/admin/settings'){if(req.method()==='PUT'){const body=req.postDataJSON();settingsWrites.push(body);services={text:body.text,ocr:body.ocr,asr:{...body.asr,secret:''}};}result={services};}
   else if(e.startsWith('/admin/models/')){
    const [,cap,id]=e.match(/^\/admin\/models\/([^/]+)(?:\/([^/]+))?$/)||[];
    if(req.method()==='DELETE'){
     if(failDelete)return route.fulfill({status:500,json:{error:'模拟删除失败'}});
     deletions.push({cap,id});catalogs[cap]=catalogs[cap].filter(m=>m.id!==id);result={deleted:true,id};
    }else result=catalogs[cap]||[];
   }else if(e==='/admin/overview')result={users:[],recent_tasks:[],metrics:[],summary:{}};
   else if(e.includes('audit'))result=[];
   return route.fulfill({json:result});
  }
  const file=p==='/'?'index.html':p.slice(1);return route.fulfill({body:await fs.readFile(path.join(__dirname,'../dist',file)),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
 });
 const out=path.resolve(__dirname,'../../verification/model-delete');await fs.mkdir(out,{recursive:true});
 await page.goto('https://workbench.test/#/admin/models');await page.locator('.admin-model-entry').first().waitFor();
 const group=name=>page.locator('.admin-model-group').filter({has:page.locator('.admin-model-group-head strong').filter({hasText:name})});
 const title=group('标题仿写模型'),copy=group('文案仿写模型');
 assert.equal(await page.getByText('旧版文案模型',{exact:true}).count(),0);
 await page.getByText('音频转写',{exact:true}).click();
 await page.getByRole('button',{name:/配置\s*ASR\s*模型/}).click();
 let asrDialog=page.getByRole('dialog',{name:'配置音频转写模型',exact:true});
 await asrDialog.locator('input').nth(1).fill('paraformer-realtime-v2');
 await asrDialog.getByRole('button',{name:/^保\s*存$/}).click();await asrDialog.waitFor({state:'hidden'});
 assert.equal(settingsWrites.length,1);assert.equal(settingsWrites[0].asr.secret,'');assert.equal(settingsWrites[0].ocr.model,'ocr');assert.equal(settingsWrites[0].text.model,'text');
 await page.locator('.admin-capability-tabs').getByText('视频脚本',{exact:true}).click();
 await group('视频脚本模型').locator('.admin-model-row').click();
 const modelDrawer=page.locator('.admin-model-editor');await modelDrawer.getByText('自动识别（保留已有设置）',{exact:true}).click();
 await page.getByTitle('文字 + 图片 + 视频',{exact:true}).click();
 assert((await modelDrawer.innerText()).includes('保存后按所选输入能力使用'));

 await page.locator('.admin-capability-tabs').getByText('标题仿写',{exact:true}).click();
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:width<700?844:1000});await title.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`models-${width}.png`),fullPage:true});}
 await title.getByRole('button',{name:'删除模型 测试模型',exact:true}).click();
 let dialog=page.getByRole('dialog').last();await dialog.locator('.ant-modal-confirm-title').waitFor();assert.equal(deletions.length,0);
 await dialog.getByRole('button',{name:/取\s*消/}).click();assert.equal(deletions.length,0);assert.equal(await title.locator('.admin-model-entry').count(),1);
 await title.getByRole('button',{name:'删除模型 测试模型',exact:true}).click();dialog=page.getByRole('dialog').last();await dialog.getByRole('button',{name:/删\s*除/}).click();
 await title.getByText('还没有模型配置',{exact:true}).waitFor();assert.deepEqual(deletions,[{cap:'title',id:'shared'}]);assert.equal(catalogs.copy.length,1);
 await page.locator('.admin-capability-tabs').getByText('文案仿写',{exact:true}).click();
 failDelete=true;await copy.getByRole('button',{name:'删除模型 测试模型',exact:true}).click();dialog=page.getByRole('dialog').last();await dialog.getByRole('button',{name:/删\s*除/}).click();await page.getByText('模拟删除失败',{exact:true}).waitFor();assert.equal(catalogs.copy.length,1);await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.reload();await page.locator('.admin-capability-tabs').getByText('标题仿写',{exact:true}).click();await title.getByText('还没有模型配置',{exact:true}).waitFor();await page.locator('.admin-capability-tabs').getByText('文案仿写',{exact:true}).click();await copy.getByRole('button',{name:'删除模型 测试模型',exact:true}).waitFor();assert.equal(catalogs.copy.length,1);
 assert.deepEqual(errors,[]);const result={status:'passed',checks:['ASR editor preserves OCR/text and blank saved secret','legacy model group hidden','explicit multimodal input selector','explicit confirmation','cancel sends no deletion','only selected group/model removed','last model leaves empty group','failed deletion retains model','reload keeps server result','320/390/1440 layouts'],deletions,errors};await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
