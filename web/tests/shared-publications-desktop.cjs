const {chromium,assert,routeAPI,publications,stamp,fs,path} = require('./direct-media-fixture.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
  const page=await browser.newPage({viewport:{width:1124,height:884}}), errors=[], changes=[], creates=[], trashed=[];
  page.on('pageerror',e=>errors.push(e.message));
  const make=(id,extra={})=>({id,project_id:'media-project',version_id:'image-version',title:'同一份双平台图文',body:'共用正文',topics:['话题'],kind:'image',asset_ids:['source-1'],ready:true,revision:1,created_at:stamp,target_platform:'xhs',...extra});
  publications.push(make('pair-xhs',{manual_status:'published',remote_work_id:'xhs-receipt'}),make('pair-dy',{target_platform:'douyin',shared_draft_id:'pair-xhs'}),make('solo-dy',{target_platform:'douyin',version_id:'video-version',title:'视频双平台',kind:'video',asset_ids:['source-video']}));
  let handoff='';
  await page.route('**/api/v1/**',async route=>{
   const req=route.request(), e=new URL(req.url()).pathname.slice(7), body=req.method()==='GET'?null:req.postDataJSON();
   if(e==='/miniapp/cloud')return route.fulfill({json:{available:true}});
   if(e.endsWith('/platform')){
    creates.push({e,...body});const source=publications.find(p=>p.id===e.split('/')[2]);
    const p=make('solo-xhs',{...source,id:'solo-xhs',target_platform:body.platform,shared_draft_id:source.id,manual_status:'ready',remote_work_id:'',published_at:'',online_state:''});publications.push(p);return route.fulfill({status:201,json:p});
   }
   if(e.endsWith('/status')&&e.startsWith('/publications/')){const p=publications.find(p=>p.id===e.split('/')[2]);assert.equal(body.revision,p.revision);p.manual_status=body.status;p.revision++;changes.push(p.id);return route.fulfill({json:p});}
   if(e.endsWith('/mobile-handoff')){
    if(req.method()==='GET')return route.fulfill({status:404,json:{error:'尚未创建手机交接'}});
    handoff=e;return route.fulfill({json:{id:'qr',state:'created',ticket:'x'.repeat(32),expires_at:new Date(Date.now()+600000).toISOString(),miniapp_scheme_url:'xhsdiscover://miniapp/123456789012345678901234_trial/pages/publish/index?scene='+'x'.repeat(32)}});
   }
   if(e==='/publications/batch-trash'){trashed.push(...body.ids);for(const p of publications)if(body.ids.includes(p.id))p.deleted_at=stamp;return route.fulfill({json:{count:body.ids.length}});}
   return routeAPI(route);
  });
  await page.goto('http://127.0.0.1:8081/#publications');
  const rowFor=title=>page.locator('.ant-table-row').filter({has:page.getByRole('button',{name:'查看发布稿 '+title,exact:true})});
  const pair=rowFor('同一份双平台图文'), solo=rowFor('视频双平台');
  await pair.waitFor();assert.equal(await page.locator('.ant-table-row').count(),2);
  assert(await pair.getByRole('button',{name:'小红书扫码发布',exact:true}).isDisabled());
  assert(!(await pair.getByRole('button',{name:'抖音手动发布',exact:true}).isDisabled()));
  await pair.getByRole('button',{name:'抖音手动发布',exact:true}).click();
  await page.getByRole('dialog').getByText('抖音手动发布',{exact:true}).waitFor();
  assert.equal(creates.length,0);await page.getByRole('dialog').getByRole('button',{name:/关\s*闭/}).click();
  const choose=async(name,text)=>{const select=page.locator('.ant-select').filter({has:page.getByRole('combobox',{name,exact:true})});await select.click();const list=await select.getByRole('combobox').getAttribute('aria-controls');await page.locator('[id="'+list+'"]').locator('..').locator('.ant-select-item-option-content').getByText(text,{exact:true}).click();};
  await choose('修改抖音发布状态 同一份双平台图文','已发布');
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.publication-stat')).some(e=>e.textContent.includes('已发布（双平台）')&&e.textContent.endsWith('1')));
  assert.deepEqual(changes,['pair-dy']);assert.equal(publications.find(p=>p.id==='pair-xhs').remote_work_id,'xhs-receipt');
  await choose('修改抖音发布状态 视频双平台','已发布');
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('[aria-label="修改抖音发布状态 视频双平台"]')).some(e=>e.closest('.ant-select').textContent.includes('已发布')));
  assert(!(await solo.getByRole('button',{name:'小红书扫码发布',exact:true}).isDisabled()));
  await solo.getByRole('button',{name:'小红书扫码发布',exact:true}).click();
  await page.getByRole('button',{name:'生成二维码',exact:true}).click();await page.getByText(/用小红书扫一扫/).waitFor();
  assert.equal(handoff,'/publications/solo-xhs/mobile-handoff');assert.equal(creates.length,1);assert.equal(creates[0].platform,'xhs');
  await page.getByRole('dialog').getByRole('button',{name:/关\s*闭/}).click();assert.equal(await page.locator('.ant-table-row').count(),2);
  await choose('发布状态','等待发布');await solo.waitFor();await pair.waitFor({state:'hidden'});
  await choose('发布状态','已发布');await pair.waitFor();await solo.waitFor({state:'hidden'});
  await choose('发布状态','全部发布状态');
  const out=path.resolve(__dirname,'../../data/verification/shared-publications-20261111');await fs.mkdir(out,{recursive:true});
  await page.locator('.panel-toolbar').click({position:{x:5,y:5}});await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').waitFor({state:'hidden'});await page.locator('.ant-message-notice').last().waitFor({state:'hidden'});await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
  const overflow=await page.locator('.publication-management .ant-table-body, .publication-management .ant-table-content').evaluateAll(es=>es.some(e=>e.scrollWidth>e.clientWidth+2));assert.equal(overflow,false);
  await pair.getByRole('button',{name:'查看发布稿 同一份双平台图文',exact:true}).click();
  assert.equal(await page.getByRole('combobox',{name:/修改.*发布状态 同一份双平台图文/}).count(),2);
  await page.getByRole('heading',{name:'发布稿详情',exact:true}).waitFor();await page.screenshot({path:path.join(out,'detail.png'),fullPage:true});await page.getByRole('button',{name:/返回发布管理/}).click();
  await pair.getByRole('button',{name:'更多操作 同一份双平台图文',exact:true}).click();await page.getByRole('menuitem',{name:'移入回收站'}).click();await page.getByRole('dialog').getByRole('button',{name:/确\s*定/}).click();
  await pair.waitFor({state:'hidden'});assert.deepEqual(trashed.sort(),['pair-dy','pair-xhs']);
  assert.deepEqual(errors,[]);console.log('PASS: desktop shared rows, separate platform status/filter/detail, XHS QR from a Douyin video draft, paired deletion. Mocked APIs; no real publication.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
