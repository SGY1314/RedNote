const {chromium,browserLaunchOptions}=require('./browser.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch(browserLaunchOptions);
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 const videoBytes=await fs.readFile(path.join(__dirname,'fixtures/reference-preview.webm'));
 const stamp='2026-10-23T04:00:00Z';let cursor=0,serial=0;
 const project={id:'p-stage',name:'咖啡日常的灵感仿写',platform:'xhs',kind:'image',note_id:'n-single',revision_id:'r-single',sources:[{id:'original',label:'原始笔记',text:'原始标题\n正文'}],asset_ids:[],cover_id:'',media_selections:{image:{asset_ids:[],cover_id:''}},selected_versions:{},created_at:stamp};
 const assets=[0,1].map(i=>({id:'ref-'+i,name:'参考图片 '+(i+1),kind:'image',source:'collection',library_state:'collected',revision_id:project.revision_id,status:'ready',position:i,created_at:stamp}));
 assets.push({id:'ref-video',name:'参考视频测试',kind:'video',source:'collection',library_state:'collected',revision_id:project.revision_id,status:'ready',duration:1.2,created_at:stamp});
 const workflow={id:project.id,account_profile:{status:'skipped',revision:1},title:{key:'',text:''},copy:{key:'',title_key:'',body:'',topics:[]},image_plan_id:'',drafts:{}};
 const reference={id:project.revision_id,title:'原始标题：把一杯咖啡的日常过成喜欢的样子',body:'原始正文只在文案步骤展示。\n从磨豆、注水到品尝，记录自己的慢生活。',topics:['咖啡日常']};
 const angles=[],titles=[],copies=[],plans=[],versions=[],jobs=[],scripts=[];
 await page.route('https://workbench.test/**',async route=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname;if(p.startsWith('/api/v1')){
   const e=p.slice(7);const body=req.method()==='GET'||e==='/assets'?null:req.postDataJSON();if(body)requests.push({path:e,body});let result=[];
   if(e==='/auth/me')result={user:{id:'qa',username:'qa',display_name:'创作测试',role:'creator',status:'active'}};
   else if(e==='/assets'&&req.method()==='POST'){result={id:'uploaded-local',name:'本地图片.png',kind:'image',source:'upload',library_state:'upload',status:'ready',created_at:stamp};assets.push(result);}
   else if(e==='/session')result={csrf_token:'fixture'};
   else if(e==='/sync')result={reset:true,more:false,epoch:'staged',cursor:++cursor,changes:Object.entries({projects:[project],assets,jobs,publications:[]}).flatMap(([entity,values])=>values.map(value=>({entity,id:value.id,value})))};
   else if(e==='/rewrites')result=[project];
   else if(e===`/rewrites/${project.id}`)result={project,versions,reference_assets:assets.filter(a=>a.source==='collection'&&a.kind==='image'),reference_videos:assets.filter(a=>a.kind==='video')};
   else if(e===`/rewrites/${project.id}/workflow`)result={workflow,reference,titles,copies,image_plans:plans,angles};
   else if(e.includes('/workflow/drafts/')){const scope=e.split('/').at(-1);assert.equal(body.revision,workflow.drafts[scope]?.revision||0);result=workflow.drafts[scope]={revision:body.revision+1,data:body.data,saved_at:stamp};}
   else if(e.endsWith('/angles/recommend')){assert.equal(body.model_id,'angle-models');angles.unshift({id:'angle-'+(++serial),model:'独立角度模型',notices:[],created_at:stamp,angles:[{name:'咖啡制作顺序',description:reference.title+'：根据原帖磨豆、注水到品尝的顺序展开。'},{name:'慢生活的仪式感',description:'从正文提到的慢生活解释制作过程。'},{name:'新手操作细节',description:'围绕磨豆和注水说明具体步骤。'}]});result={job_id:'a1',notices:[]};}
   else if(e.endsWith('/titles/generate')){titles.unshift({id:'tg-'+(++serial),titles:['咖啡日常的三个小确幸','一杯咖啡，把日子慢下来','记录属于自己的咖啡时光'],model:'独立标题模型',created_at:stamp,prompt:body.prompt,requirements:body.requirements});result={job_id:'t1'};}
   else if(e.endsWith('/titles/confirm')){if(body.text!==workflow.title.text)workflow.title={key:'title-'+(++serial),text:body.text,angle:body.angle,generation_id:body.generation_id,confirmed_at:stamp};result=workflow;}
   else if(e.endsWith('/copies/generate')){assert(workflow.title.key);copies.unshift({id:'cg-'+(++serial),title_key:workflow.title.key,model:'独立文案模型',created_at:stamp,copies:[1,2,3].map(i=>({body:`候选文案 ${i}：为自己留一杯咖啡的时间。\n从磨豆开始，慢慢感受生活的小细节。`,topics:['生活记录']}))});result={job_id:'c1'};}
   else if(e.endsWith('/copies/confirm')){assert.equal(body.title_key,workflow.title.key);workflow.copy={key:'copy-'+(++serial),title_key:body.title_key,body:body.body,topics:body.topics,generation_id:body.generation_id,confirmed_at:stamp};result=workflow;}
   else if(e.endsWith('/plan-images')){plans.unshift({id:'plan-'+(++serial),model:'独立画面模型',copy_key:workflow.copy.key,scenes:Array.from({length:body.count},(_,i)=>`第${i+1}张：暖色自然光里的咖啡桌，主体白色咖啡杯，${i===0?'俯拍构图':i===1?'手部注水特写':'桌面远景'}，统一米白背景。`),reference_asset_ids:body.reference_asset_ids,created_at:stamp});result={job_id:'ip1'};}
   else if(e.endsWith('/image-plans/confirm')){result={id:'confirmed-plan-'+(++serial),...body,model:'独立画面模型',confirmed_at:stamp,created_at:stamp};plans.unshift(result);workflow.image_plan_id=result.id;}
   else if(e.endsWith('/generate-image')){assert(body.plan_id);const ids=[];for(let i=0;i<body.count;i++){const id='generated-'+(++serial);ids.push(id);assets.push({id,name:'生成画面 '+(i+1),kind:'image',source:'generated',library_state:'result',project_id:project.id,status:'ready',position:i,created_at:stamp});}const id='image-job-'+(++serial),created_at=new Date(Date.parse(stamp)+serial*1000).toISOString();jobs.push({id,target:project.id,kind:'image_generation',state:'succeeded',stage:'已完成',result:ids[0],created_at,updated_at:created_at,payload:body.count>1?{series:{asset_ids:ids,completed:ids,scenes:body.scenes}}:{}});result={job_id:id};}
   else if(e.endsWith('/save-to-library')){const asset=assets.find(asset=>asset.id===e.split('/')[2]);assert(asset);asset.library_state='saved';result=asset;}
   else if(e.endsWith('/video/plan')){const script={id:'script-'+(++serial),project_id:project.id,title:workflow.title.text,concept:'从咖啡制作到品尝的完整故事',style:'暖色自然光',shots:[{duration:body.duration,visual:'0到10秒磨豆；10到20秒注水；20到30秒品尝，镜头连贯',camera:'从手部特写拉远',narration:'慢下来，感受生活'}],subtitle_plan:'按叙事时间出现字幕',music:'轻音乐及注水音效',brief:{...body,copy_key:workflow.copy.key},model:'独立脚本模型',created_at:stamp};scripts.unshift(script);jobs.push({id:'video-plan-'+serial,target:project.id,kind:'video_plan',state:'succeeded',stage:'已完成',result:script.id,created_at:stamp,updated_at:stamp,payload:{}});result={job_id:script.id};}
   else if(e.endsWith('/video/scripts'))result=scripts;
   else if(e.endsWith('/workflow/release')){assert.equal(body.copy_key,workflow.copy.key);assert(body.media_reviewed);result={id:'release-'+(++serial),number:versions.length+1,title:workflow.title.text,body:workflow.copy.body,topics:workflow.copy.topics,project_id:project.id,media:body.media,status:'confirmed',created_at:stamp};versions.unshift(result);project.selected_versions[body.media.kind]=result.id;}
   else if(e==='/publications'&&body)result={id:'publication'};
   else if(/-models$/.test(e))result=[{id:e.slice(1),name:e.slice(1)+' 独立模型',model:'fixture',base_url:'https://fixture.test',configured:true,vision:true,reference_limit:10,continuous_min:2,continuous_max:30}];
   else if(e==='/assets/ref-video/file'||e==='/assets/ref-video/preview')return route.fulfill({contentType:'video/webm',body:videoBytes});
   else if(e.includes('/assets/')&&(e.endsWith('/file')||e.endsWith('/preview')))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#c3b49a"/><circle cx="300" cy="340" r="140" fill="#f6eee0"/><text x="235" y="355" fill="#80583d" font-size="36">Coffee</text></svg>'});
   return route.fulfill({json:result});
  }
  const file=p==='/'?'index.html':p.slice(1);return route.fulfill({body:await fs.readFile(path.join(__dirname,'../dist',file)),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html'});
 });
 const out=path.resolve(__dirname,'../../verification/staged-workflow');await fs.mkdir(out,{recursive:true});
 await page.goto('https://workbench.test/#rewrites');
 await page.locator('.creation-workflow').waitFor();
 const nav=page.getByRole('navigation',{name:'仿写创作步骤'});
 assert(await nav.getByRole('button',{name:/文案仿写/}).isDisabled());
 assert(!(await page.locator('.workflow-reference').innerText()).includes(reference.body));
 for(const width of [1440,820,390,320]){await page.setViewportSize({width,height:width<700?844:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`title-${width}.png`),fullPage:true});}
 await page.setViewportSize({width:1440,height:1000});
 assert.equal(await page.locator('.workflow-settings details').getAttribute('open'),null);assert.equal(requests.filter(r=>r.path.endsWith('/angles/recommend')).length,0);await page.getByRole('button',{name:'推荐角度',exact:true}).click();await page.locator('.workflow-angle-options button').first().waitFor();for(const width of [1440,390,320]){await page.setViewportSize({width,height:width<700?844:1000});await page.locator('.workflow-angle-options').first().scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`angles-${width}.png`),fullPage:true});}await page.setViewportSize({width:1440,height:1000});await page.locator('.workflow-angle-options button').first().click();assert((await page.getByRole('textbox',{name:'发帖角度',exact:true}).inputValue()).includes(reference.title));assert.equal(requests.filter(r=>r.path.endsWith('/angles/recommend')).length,1);await page.locator('.workflow-settings details>summary').click();
 await page.getByRole('textbox',{name:'标题仿写提示词',exact:true}).fill('自然、简短、有画面感');
 await page.getByRole('button',{name:'生成 3 个标题',exact:true}).click();
 await page.locator('.workflow-candidates>button').nth(1).click();
 await page.getByRole('textbox',{name:'最终标题',exact:true}).fill('中'.repeat(21));assert(await page.getByRole('button',{name:/确认标题，进入文案/}).isDisabled());
 await page.getByRole('textbox',{name:'最终标题',exact:true}).fill('中'.repeat(19)+'😊');assert(await page.getByRole('button',{name:/确认标题，进入文案/}).isEnabled());
 await page.locator('.workflow-candidates>button').nth(1).click();
 await page.getByRole('button',{name:/确认标题，进入文案/}).click();
 await page.getByRole('textbox',{name:'文案仿写补充要求',exact:true}).waitFor();assert(workflow.title.angle.includes(reference.title));assert.equal(await page.locator('.workflow-reference').getAttribute('open'),null);
 await page.locator('.workflow-reference>summary').click();assert((await page.locator('.workflow-reference').innerText()).includes(reference.body));
 await page.getByRole('button',{name:'生成 3 份文案',exact:true}).click();await page.locator('.workflow-candidates>button').nth(2).click();
 await page.getByRole('button',{name:/确认文案，进入素材制作/}).click();
 await page.getByRole('button',{name:'自动规划画面',exact:true}).waitFor();
 const referenceBox=page.locator('.workflow-media-box').filter({has:page.locator('.workflow-media-head>strong').filter({hasText:'参考图片'})});
 await referenceBox.getByRole('checkbox').first().check();await page.getByRole('button',{name:'参考图片下一张',exact:true}).click();

 await page.getByRole('button',{name:'从素材库选择',exact:true}).click();
 let picker=page.getByRole('dialog',{name:'从素材库选择',exact:true});
 assert.equal(await picker.locator('video').count(),0);
 await picker.getByRole('checkbox',{name:'参考图片 2',exact:true}).check();
 await picker.getByRole('button',{name:/确定选择/}).click();await picker.waitFor({state:'hidden'});
 await page.locator('input[type=file]').setInputFiles({name:'本地图片.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});
 await page.getByRole('status').filter({hasText:'草稿 · 已自动保存'}).waitFor();
 await page.waitForFunction(()=>document.body.textContent.includes('本地图片.png'));
 await page.getByRole('button',{name:'自动规划画面',exact:true}).click();
 assert.equal(await page.locator('.workflow-steps button').count(),5);
 await page.getByRole('textbox',{name:'第1张画面',exact:true}).waitFor();assert(requests.find(r=>r.path.endsWith('/plan-images')).body.reference_asset_ids.includes('uploaded-local'));assert((await page.getByRole('textbox',{name:'第1张画面',exact:true}).inputValue()).includes('咖啡'));
 assert(await page.getByRole('button',{name:'按已确认规划生成全部图片',exact:true}).isDisabled());
 await page.getByRole('button',{name:'确认画面规划',exact:true}).click();
 await page.getByRole('button',{name:'按已确认规划生成全部图片',exact:true}).click();
 const results=page.locator('.workflow-compact-media[aria-label="图片生成结果"]');
 await results.getByRole('checkbox').first().check();
 await results.getByRole('button',{name:'图片生成结果下一项',exact:true}).click();
 assert((await results.locator('.workflow-compact-current').innerText()).includes('2 / 3'));
 assert.equal(await results.locator('img').nth(1).evaluate(image=>getComputedStyle(image).objectFit),'contain');
 await results.getByRole('button',{name:'图片生成结果预览第2项',exact:true}).click();
 const modal=page.getByRole('dialog');await modal.waitFor();assert.equal(await modal.locator('img').evaluate(image=>getComputedStyle(image).objectFit),'contain');await modal.getByRole('button',{name:/^关\s*闭$/}).click();await modal.waitFor({state:'hidden'});
 await results.getByRole('button',{name:/^更\s*多$/}).click();
 assert((await page.getByRole('link',{name:/^下\s*载$/}).getAttribute('href')).endsWith('?download=1'));
 const savedResponse=page.waitForResponse(response=>response.url().includes('/save-to-library')&&response.status()===200);await page.getByRole('button',{name:'存入素材库',exact:true}).click();await savedResponse;assert.equal(assets.filter(asset=>asset.library_state==='saved').length,1);
 await page.getByRole('button',{name:'生成第 1 张',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="图片生成结果"] .workflow-compact-current')?.textContent.includes('1 / 1'));
 const history=page.locator('.workflow-result-history');assert.equal(await history.getAttribute('open'),null);assert((await history.locator('summary').innerText()).includes('3张'));
 await history.locator('summary').click();assert(await history.getByRole('checkbox').first().isChecked());await history.locator('summary').click();
 await results.getByRole('checkbox').first().check();
 for(const width of [1440,820,390,320]){await page.setViewportSize({width,height:width<700?844:1000});await results.scrollIntoViewIfNeeded();assert((await results.boundingBox()).height<300);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`images-${width}.png`),fullPage:true});}
 await nav.getByRole('button',{name:/发布稿/}).click();
 const selectedMedia=page.locator('.workflow-compact-media[aria-label="已选发布素材"]');
 assert.equal(await selectedMedia.locator('.workflow-compact-card').count(),2);
 const originalChosen=[...workflow.drafts.publish.data.asset_ids];
 await selectedMedia.getByRole('button',{name:'已选发布素材下一项',exact:true}).click();
 await selectedMedia.getByRole('button',{name:'设为封面',exact:true}).click();
 assert.equal(await selectedMedia.locator('.workflow-compact-cover').count(),1);
 await selectedMedia.getByRole('button',{name:/^前\s*移$/}).click();
 await page.getByRole('status').filter({hasText:'草稿 · 已自动保存'}).waitFor();
 assert.deepEqual(workflow.drafts.publish.data.asset_ids,[originalChosen[1],originalChosen[0]]);assert.equal(workflow.drafts.publish.data.cover_id,originalChosen[1]);
 await selectedMedia.getByRole('button',{name:/^移\s*除$/}).click();
 assert.equal(await selectedMedia.locator('.workflow-compact-card').count(),1);
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:width<700?844:1000});await selectedMedia.scrollIntoViewIfNeeded();assert((await selectedMedia.boundingBox()).height<320);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`publish-${width}.png`),fullPage:true});}

 await page.getByRole('button',{name:'发布封面',exact:true}).click();
 picker=page.getByRole('dialog',{name:'选择发布封面',exact:true});
 await picker.locator('img').first().waitFor();assert(await picker.locator('img').first().evaluate(img=>img.complete&&img.naturalWidth>0));
 await picker.getByRole('checkbox',{name:'参考图片 2',exact:true}).check();
 await page.waitForFunction(()=>document.querySelector('.workflow-asset-grid img')?.getBoundingClientRect().height>=100);await page.waitForTimeout(350);
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:width<700?844:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`cover-picker-${width}.png`),fullPage:true});}
 await picker.getByRole('button',{name:/确定选择/}).click();await picker.waitFor({state:'hidden'});
 assert((await page.getByRole('img',{name:'当前发布封面',exact:true}).getAttribute('src')).includes('ref-1'));
 await page.getByRole('button',{name:'从素材库选择',exact:true}).click();
 picker=page.getByRole('dialog',{name:'从素材库选择',exact:true});await picker.getByRole('checkbox',{name:'本地图片.png',exact:true}).check();await picker.getByRole('button',{name:/确定选择/}).click();await picker.waitFor({state:'hidden'});
 await page.locator('.workflow-publish-target .ant-select-selector').click();await page.getByText('两个平台都发',{exact:true}).last().click();
 await page.waitForFunction(()=>document.body.textContent.includes('抖音目前可预览发布内容'));
 await page.waitForFunction(()=>document.querySelector('.workflow-publish-target .ant-select-selection-item')?.textContent.includes('两个平台都发'));
 await page.getByRole('status').filter({hasText:'草稿 · 已自动保存'}).waitFor();assert.equal(workflow.drafts.publish.data.target_platform,'both');
 await page.getByRole('checkbox',{name:'已检查素材与当前标题、文案匹配',exact:true}).check();
 await page.getByRole('button',{name:'保存发布稿',exact:true}).click();
 await page.getByRole('button',{name:'将 V1 加入发布管理',exact:true}).waitFor();assert.equal(versions[0].title,'一杯咖啡，把日子慢下来');assert(versions[0].body.includes('候选文案 3'));
 await nav.getByRole('button',{name:/视频仿写/}).click();await page.locator('summary').filter({hasText:'高级设置 · 脚本提示词'}).click();await page.getByRole('textbox',{name:'视频脚本提示词',exact:true}).waitFor();
 await page.getByRole('textbox',{name:'视频脚本提示词',exact:true}).fill('完整连续故事，镜头自然衔接');
 const videoRefs=page.locator('.workflow-compact-media[aria-label="参考视频"]');assert.equal(await videoRefs.locator('video[controls]').count(),0);
 await videoRefs.getByRole('button',{name:'参考视频预览第1项',exact:true}).click();
 const videoModal=page.getByRole('dialog');await videoModal.locator('video[controls]').waitFor();try{await videoModal.locator('video').evaluate(video=>video.play());}catch(error){console.log(JSON.stringify({bytes:videoBytes.length,header:[...videoBytes.subarray(0,20)],video:await videoModal.locator('video').evaluate(video=>({src:video.currentSrc,network:video.networkState,ready:video.readyState,error:video.error?.message,types:[video.canPlayType('video/webm;codecs=vp8'),video.canPlayType('video/webm')]}))}));throw error;}await page.waitForFunction(()=>{const video=document.querySelector('.workflow-media-modal video');return video&&video.currentTime>0;});
 await videoModal.getByRole('button',{name:/^关\s*闭$/}).click();await videoModal.waitFor({state:'hidden'});assert.equal(await page.locator('.workflow-media-modal video').count(),0);
 await page.getByRole('button',{name:'从素材库选择',exact:true}).click();
 picker=page.getByRole('dialog',{name:'从素材库选择',exact:true});
 await picker.getByRole('checkbox',{name:'参考视频测试',exact:true}).check();await picker.getByRole('button',{name:/确定选择/}).click();await picker.waitFor({state:'hidden'});
 assert(await videoRefs.getByRole('checkbox').isChecked());

 for(const width of [1440,390,320]){await page.setViewportSize({width,height:width<700?844:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`video-${width}.png`),fullPage:true});}
 await page.getByRole('button',{name:'生成完整脚本',exact:true}).click();
 await page.getByRole('textbox',{name:'脚本字幕方案',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'脚本配乐音效',exact:true}).inputValue(),'轻音乐及注水音效');
 await nav.getByRole('button',{name:/标题仿写/}).click();await page.getByRole('textbox',{name:'最终标题',exact:true}).fill('修改后的标题');await page.getByRole('button',{name:/确认标题，进入文案/}).click();
 await page.getByText('标题或发帖角度已变化，已有文案保留，请检查后重新确认。',{exact:true}).waitFor();assert(await nav.getByRole('button',{name:/图片仿写/}).isDisabled());assert.equal(versions[0].title,'一杯咖啡，把日子慢下来');
 await page.getByRole('status').filter({hasText:'草稿 · 已自动保存'}).waitFor();
 await page.reload();await page.locator('.creation-workflow').waitFor();assert.equal(await page.getByRole('textbox',{name:'最终标题',exact:true}).inputValue(),'修改后的标题');
 assert.deepEqual(errors,[]);
 const summary={status:'passed',checks:['thumbnail cover selection with full image preview','image/video/publish library selectors','local upload included in image plan','single original title only','full-post model angle recommendations only on click','confirmed angle forwarded and saved with recommendation history','advanced prompts and histories collapsed','separate optional image and video stages','three title and three copy candidates','server draft autosave and reload','step gating and upstream invalidation','reference image carousel and selection','automatic scene planning and explicit confirmation','image results selected into final release','latest image batch and collapsed selectable history','compact image cards with modal preview and More actions','publication material reordering, cover and removal','reference video plays in modal and stops on close','full script with subtitles/music and independent models','immutable publication history','320/390/820/1440 responsive layouts'],requests:requests.map(r=>r.path),errors};await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

