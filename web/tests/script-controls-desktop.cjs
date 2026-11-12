const {chromium,fs,path,assert,routeAPI,workflows,scriptRequests}=require('./direct-media-fixture.cjs');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
 const page=await browser.newPage({viewport:{width:1124,height:884},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));let rev=1;
 const templates=['title','copy','image','video-script','video'].map(scope=>({id:'template-'+scope,scope,name:scope+'模板',prompt:scope+'管理员模板',revision:1,is_default:true}));
 await page.route('**/api/v1/**',async route=>{const e=new URL(route.request().url()).pathname.slice(7);
 if(e==='/profile/default')return route.fulfill({json:{}});
 if(e==='/prompt-presets')return route.fulfill({json:templates.map(t=>({...t,revision:rev,prompt:rev===1?t.prompt:t.prompt+'新版'}))});
 return routeAPI(route);});
 await page.goto('http://127.0.0.1:8081/#rewrites');const nav=page.getByRole('navigation',{name:'仿写创作步骤',exact:true});await nav.waitFor();await nav.getByRole('button',{name:'视频仿写',exact:true}).click();
 const script=page.getByRole('group',{name:'视频脚本生成栏',exact:true}),video=page.getByRole('group',{name:'视频生成生成栏',exact:true});await script.waitFor();
 assert.equal(await script.getByRole('button',{name:/目标视频时长/}).count(),1);assert.equal(await video.getByRole('button',{name:/视频时长/}).count(),0);
 await script.getByRole('button',{name:/目标视频时长/}).click();await page.getByRole('spinbutton',{name:'目标视频时长',exact:true}).fill('15');await page.keyboard.press('Tab');await page.keyboard.press('Escape');
 await video.getByText('目标时长：15 秒（来自脚本设置）',{exact:true}).waitFor();
 const prompt=page.getByRole('region',{name:'video-script系统提示词设置',exact:true});
 // A section with an accessible name is exposed as a region by the browser.
 await prompt.getByRole('textbox',{name:'系统提示词',exact:true}).fill('我的脚本修改');await prompt.getByRole('switch',{name:'使用系统提示词',exact:true}).click();assert(await prompt.getByRole('textbox',{name:'系统提示词',exact:true}).isDisabled());
 await script.getByRole('button',{name:'开始生成',exact:true}).click();await page.waitForFunction(()=>document.body.textContent.includes('草稿'));assert.equal(scriptRequests.at(-1).duration,15);
 const draft=workflows['media-project'].drafts['video-script'].data;assert.equal(draft.duration,15);assert.equal(draft.system_prompt_choice.enabled,false);assert.equal(draft.system_prompt_choice.text,'我的脚本修改');
 await page.reload();await nav.waitFor();await nav.getByRole('button',{name:'视频仿写',exact:true}).click();await page.getByText('目标时长：15 秒（来自脚本设置）',{exact:true}).waitFor();
 // Script job is still pending, so check editable template behavior on the title module.
 await nav.getByRole('button',{name:'标题仿写',exact:true}).click();const title=page.getByRole('region',{name:'title系统提示词设置',exact:true});await title.getByRole('textbox',{name:'系统提示词',exact:true}).fill('保存我的标题提示词');await page.waitForTimeout(800);rev=2;await page.reload();await nav.waitFor();await nav.getByRole('button',{name:'标题仿写',exact:true}).click();await title.getByText(/管理员模板已更新/).waitFor();assert.equal(await title.getByRole('textbox',{name:'系统提示词',exact:true}).inputValue(),'保存我的标题提示词');await title.getByRole('button',{name:'恢复模板',exact:true}).click();assert.equal(await title.getByRole('textbox',{name:'系统提示词',exact:true}).inputValue(),'title管理员模板新版');
 const out=path.resolve(__dirname,'../../data/verification/script-controls');await fs.mkdir(out,{recursive:true});await nav.getByRole('button',{name:'视频仿写',exact:true}).click();await script.waitFor();await script.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'script-controls.png')});await video.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'video-controls.png')});assert.deepEqual(errors,[]);console.log('Script duration ownership, inherited video duration, optional editable prompts, persistence and template update preservation: passed.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
