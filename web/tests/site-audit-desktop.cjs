const {chromium,fs,path,assert,routeAPI,assets,workflows,publications,stamp}=require('./direct-media-fixture.cjs');
(async()=>{
const out=path.resolve(__dirname,'../../data/verification/site-audit');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const observations=[];
try {
 const p={id:'audit-published',project_id:'media-project',version_id:'v-audit',title:'手动标记为已发布的稿件',body:'正文',topics:[],kind:'image',asset_ids:['source-1'],ready:true,manual_status:'published',revision:2,target_platform:'xhs',created_at:stamp};publications.push(p);
 const page=await browser.newPage({viewport:{width:1124,height:884},reducedMotion:'reduce'});let stageCalls=0,confirmationBodies=[],publicationReads=0,draftFailures=[];
 workflows['media-project'].drafts['video-script']={revision:1,data:{duration:10,text:'白天在咖啡馆拍摄，主角冲泡咖啡。'}};
 workflows['media-project'].drafts.video={revision:1,data:{requirements:'不要夜晚场景'}};
 let rejectDraft=false;
 await page.route('**/api/v1/**',async route=>{
 const req=route.request(),e=new URL(req.url()).pathname.slice(7),data=req.method()==='GET'?null:req.postDataJSON();
 if(e==='/profile/default')return route.fulfill({json:{}});
 if(e==='/prompt-presets')return route.fulfill({json:[]});
 if(e==='/publications')publicationReads++;
 if(e.endsWith('/workflow/drafts/title')&&rejectDraft){draftFailures.push(data.revision);return route.fulfill({status:409,json:{error:'草稿已在其他页面更新，请刷新后继续'}});}
 if(e.endsWith('/workflow/stage')){stageCalls++;return route.fulfill({json:{workflow:workflows['media-project'],version:{id:'audit-version',number:1},publications:[{...p,id:'audit-proposal',version_id:'audit-version',title:'核对标题',revision:1,manual_status:undefined}]}});}
 if(e==='/publications/confirm'){confirmationBodies.push(data);return route.fulfill({status:409,json:{error:'发布稿已更新，请重新核对最新内容后确认'}});}
 return routeAPI(route);
 });
 await page.goto('http://127.0.0.1:8081/#publications');const row=page.getByRole('row').filter({has:page.getByRole('button',{name:'查看发布稿 '+p.title,exact:true})});await row.waitFor();
 const enabled=await row.getByRole('button',{name:'小红书扫码发布',exact:true}).isEnabled();assert(enabled);observations.push({id:'A1',finding:'手动已发布仍启用扫码发布按钮',reproduced:true});await page.screenshot({path:path.join(out,'published-still-enabled.png')});
 await page.goto('http://127.0.0.1:8081/#rewrites');const nav=page.getByRole('navigation',{name:'仿写创作步骤',exact:true});await nav.waitFor();await nav.getByRole('button',{name:'视频仿写',exact:true}).click();const video=page.getByRole('group',{name:'视频生成生成栏',exact:true});await video.getByText(/白天／夜晚设置冲突/).waitFor();assert(await video.getByRole('button',{name:'开始生成',exact:true}).isDisabled());observations.push({id:'A2',finding:'脚本白天加补充要求不要夜晚被误判冲突',reproduced:true});await video.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'negated-requirement-blocked.png')});
 await nav.getByRole('button',{name:'标题仿写',exact:true}).click();const panel=page.locator('.title-rewrite-panel:not(.copy-rewrite-panel)');await panel.getByRole('textbox',{name:'自定义标题',exact:true}).fill('核对标题');await panel.getByRole('button',{name:/准备发布/}).click();const dialog=page.getByRole('dialog',{name:'确认发布稿',exact:true});await dialog.waitFor();await dialog.getByRole('button',{name:'确认，加入发布管理',exact:true}).click();await dialog.getByText('发布稿已更新，请重新核对最新内容后确认',{exact:true}).waitFor();const before={stageCalls,publicationReads};await dialog.getByRole('button',{name:'重新核对',exact:true}).click();await dialog.getByRole('button',{name:'确认，加入发布管理',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.publication-confirm-retry'));
 assert.deepEqual(before,{stageCalls,publicationReads});assert.equal(confirmationBodies.length,2);assert.deepEqual(confirmationBodies[0],confirmationBodies[1]);observations.push({id:'A3',finding:'发布确认冲突后重新核对没有刷新内容，重复旧请求',reproduced:true});await page.screenshot({path:path.join(out,'review-retry-no-refresh.png')});await dialog.getByRole('button',{name:'暂不确认',exact:true}).click();
 rejectDraft=true;await panel.getByRole('textbox',{name:'自定义标题',exact:true}).fill('冲突后尚未保存的新标题');await page.waitForTimeout(850);await panel.getByRole('textbox',{name:'自定义标题',exact:true}).fill('冲突后再次编辑的新标题');await page.waitForTimeout(850);assert(draftFailures.length>=2);assert.equal(new Set(draftFailures).size,1);observations.push({id:'A4',finding:'草稿冲突后再次编辑仍用同一旧版本号保存，无法自行恢复',reproduced:true,submittedRevisions:draftFailures});await page.screenshot({path:path.join(out,'draft-conflict-stale-revision.png')});
 await fs.writeFile(path.join(out,'observations.json'),JSON.stringify(observations,null,2));console.log(JSON.stringify(observations));
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
