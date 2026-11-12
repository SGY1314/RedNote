const {chromium,fs,path,assert,routeAPI,workflows,publications,stamp}=require('./direct-media-fixture.cjs');
(async()=>{
const out=path.resolve(__dirname,'../../data/verification/site-fixes');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try {
const p={id:'fixed-published',project_id:'media-project',version_id:'v-fixed',title:'手动已发布的稿件',body:'正文',topics:[],kind:'image',asset_ids:['source-1'],ready:true,manual_status:'published',revision:2,target_platform:'xhs',created_at:stamp};publications.push(p);
const page=await browser.newPage({viewport:{width:1124,height:884},reducedMotion:'reduce'});let failures=0,reviewReads=0,confirmations=[];
workflows['media-project'].drafts['video-script']={revision:1,data:{duration:10,text:'白天在咖啡馆拍摄，主角冲泡咖啡。'}};
workflows['media-project'].drafts.video={revision:1,data:{requirements:'不要夜晚场景'}};
await page.route('**/api/v1/**',async route=>{
 const req=route.request(),e=new URL(req.url()).pathname.slice(7),data=req.method()==='GET'?null:req.postDataJSON();
 if(e==='/profile/default')return route.fulfill({json:{}});
 if(e==='/prompt-presets')return route.fulfill({json:[]});
 if(e.includes('/workflow/drafts/')){const w=workflows[e.split('/')[2]],scope=e.split('/').at(-1);if(data.revision!==(w.drafts[scope]?.revision||0)){failures++;return route.fulfill({status:409,json:{error:'草稿已在其他页面更新'}});}}
 if(e.endsWith('/workflow/stage'))return route.fulfill({json:{workflow:workflows['media-project'],version:{id:'fixed-version',number:1},publications:[{...p,id:'fixed-proposal',version_id:'fixed-version',title:'核对标题',revision:1,manual_status:undefined}]}});
 if(e==='/publications/preview'){reviewReads++;return route.fulfill({json:{items:[{...p,id:'fixed-proposal',version_id:'fixed-version',title:'服务器内容',revision:2,manual_status:undefined}]}});}
 if(e==='/publications/confirm'){confirmations.push(data);return data.items[0].revision===1?route.fulfill({status:409,json:{error:'发布稿已更新，请重新核对最新内容后确认'}}):route.fulfill({json:{items:[]}});}
 return routeAPI(route);
});
await page.goto('http://127.0.0.1:8081/#publications');const row=page.getByRole('row').filter({has:page.getByRole('button',{name:'查看发布稿 '+p.title,exact:true})});await row.waitFor();assert(await row.getByRole('button',{name:'小红书扫码发布',exact:true}).isDisabled());
await page.goto('http://127.0.0.1:8081/#rewrites');const nav=page.getByRole('navigation',{name:'仿写创作步骤',exact:true});await nav.waitFor();await nav.getByRole('button',{name:'视频仿写',exact:true}).click();const video=page.getByRole('group',{name:'视频生成生成栏',exact:true});assert(await video.getByRole('button',{name:'开始生成',exact:true}).isEnabled());assert.equal(await video.getByText(/设置冲突/).count(),0);
await nav.getByRole('button',{name:'标题仿写',exact:true}).click();const panel=page.locator('.title-rewrite-panel:not(.copy-rewrite-panel)');await panel.getByRole('textbox',{name:'自定义标题',exact:true}).fill('核对标题');await panel.getByRole('button',{name:/准备发布/}).click();const dialog=page.getByRole('dialog',{name:'确认发布稿',exact:true});await dialog.waitFor();await dialog.getByRole('button',{name:'确认，加入发布管理',exact:true}).click();await dialog.getByText('发布稿已更新，请重新核对最新内容后确认',{exact:true}).waitFor();await dialog.getByRole('button',{name:'重新核对',exact:true}).click();await dialog.getByText('已重新读取发布状态，弹窗中的文字修改已保留，请再次核对后确认。',{exact:true}).waitFor();await dialog.getByRole('button',{name:'确认，加入发布管理',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(reviewReads,1);assert.equal(confirmations[1].items[0].revision,2);assert.equal(confirmations[1].items[0].edit.title,'核对标题');
await page.waitForTimeout(1000);const w=workflows['media-project'];w.drafts.title={revision:(w.drafts.title?.revision||0)+1,data:{...w.drafts.title?.data,custom_title:'服务器新标题'}};
await panel.getByRole('textbox',{name:'自定义标题',exact:true}).fill('本页未保存标题');let conflict=page.getByRole('dialog',{name:'核对未保存的草稿',exact:true});await conflict.waitFor();await conflict.getByRole('textbox',{name:'冲突的服务器草稿',exact:true}).waitFor();assert((await conflict.getByRole('textbox',{name:'冲突的本页草稿',exact:true}).inputValue()).includes('本页未保存标题'));await conflict.getByRole('button',{name:'稍后处理',exact:true}).click();
await page.reload();conflict=page.getByRole('dialog',{name:'核对未保存的草稿',exact:true});await conflict.waitFor();assert((await conflict.getByRole('textbox',{name:'冲突的本页草稿',exact:true}).inputValue()).includes('本页未保存标题'));await conflict.getByRole('button',{name:'保留本页修改并保存',exact:true}).click();await conflict.waitFor({state:'hidden'});await page.waitForTimeout(800);assert.equal(w.drafts.title.data.custom_title,'本页未保存标题');assert.equal(failures,1);assert.equal(await page.evaluate(()=>sessionStorage.getItem('rednote.draft-recovery.media-project')),null);
await nav.getByRole('button',{name:'标题仿写',exact:true}).click();w.drafts.title={revision:w.drafts.title.revision+1,data:{...w.drafts.title.data,custom_title:'采用服务器标题'}};await panel.getByRole('textbox',{name:'自定义标题',exact:true}).fill('第二次本页修改');await conflict.waitFor();await conflict.getByRole('button',{name:'使用服务器版本',exact:true}).click();await conflict.waitFor({state:'hidden'});await page.waitForTimeout(800);assert.equal(await panel.getByRole('textbox',{name:'自定义标题',exact:true}).inputValue(),'采用服务器标题');assert.equal(w.drafts.title.data.custom_title,'采用服务器标题');
await page.screenshot({path:path.join(out,'recovered-draft.png')});console.log('PASS: manual publication guard, negated video requirement, preview refresh, draft conflict and reload recovery');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
