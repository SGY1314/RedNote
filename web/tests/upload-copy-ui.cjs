const {chromium,browserLaunchOptions,fs,path,assert,base,routeAPI,projects,workflows,assets,jobs,source}=require('./direct-media-fixture.cjs');
const out=path.resolve(__dirname,'../../data/verification/upload-copy');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=','base64');
const uploads=[],stages=[];
let failUpload=false;
assets.push({id:'old-generated',name:'以前的成图',kind:'image',source:'generated',project_id:projects[0].id,status:'ready',created_at:'2026-11-01T08:00:00Z'});
jobs.push({id:'old-job',kind:'image_generation',target:projects[0].id,state:'succeeded',result:'old-generated',created_at:'2026-11-01T08:00:00Z',updated_at:'2026-11-01T08:00:00Z',stage:'完成'});
async function route(route){
 const req=route.request(),url=new URL(req.url()),e=url.pathname.slice(7);
 if(e==='/assets'&&req.method()==='POST'){
  const raw=req.postDataBuffer().toString();if(!raw.includes('reference.png'))assert(raw.includes('name="project_id"\r\n\r\n'+projects[0].id));
  if(failUpload)return route.fulfill({status:500,json:{error:'上传暂时失败'}});
  const asset={id:'uploaded-'+(uploads.length+1),name:'上传图片'+(uploads.length+1)+'.png',kind:'image',source:'upload',project_id:projects[0].id,status:'ready',created_at:new Date().toISOString()};assets.push(asset);uploads.push(asset);return route.fulfill({status:201,json:asset});
 }
 if(e.endsWith('/workflow')&&req.method()==='GET'){
  const w=workflows[e.split('/')[2]];return route.fulfill({json:{workflow:w,basis:{title:w.title,copy:w.copy},reference:source,angles:[],titles:[],copies:[{id:'copy-gen',title_key:w.title.key,copies:[{body:'生成的候选文案',topics:['候选话题']}]}],image_plans:[],title_system_prompts:{},copy_system_prompts:{},media_system_prompts:{}}});
 }
 if(e.endsWith('/workflow/stage')){
  const data=req.postDataJSON();stages.push(data);
  if(data.step==='copy'){const w=workflows[e.split('/')[2]];w.copy={...w.copy,body:data.text,topics:data.topics,generation_id:data.generation_id};}
 }
 return routeAPI(route);
}
async function synced(page){await page.waitForFunction(()=>document.querySelector('.workflow-save-announcement')?.textContent.includes('已自动保存'));}
(async()=>{
 await fs.mkdir(out,{recursive:true});const browser=await chromium.launch(browserLaunchOptions);
 try{
  const page=await browser.newPage({viewport:{width:1157,height:765}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/v1/**',route);
  await page.goto(base+'/#rewrites');await page.locator('.creation-workflow').waitFor();
  const nav=page.getByRole('navigation',{name:'仿写创作步骤',exact:true});
  await nav.getByRole('button',{name:'文案仿写',exact:true}).click();
  const copy=page.locator('.copy-rewrite-panel'),text=copy.getByRole('textbox',{name:'最终文案',exact:true});
  await copy.getByRole('button',{name:'打开文案信笺',exact:true}).click();assert.equal(await text.getAttribute('readonly'),null);
  await text.fill('自行修改的原始文案，不覆盖采集记录。');const topics=copy.getByRole('combobox',{name:'文案话题',exact:true});await topics.fill('自己添加的话题');await topics.press('Enter');await topics.press('Escape');await synced(page);
  await copy.getByRole('button',{name:'查看文案1',exact:true}).click();await copy.getByRole('button',{name:'打开文案信笺',exact:true}).click();await text.fill('编辑后的候选');await copy.getByRole('button',{name:'查看原始文案',exact:true}).click();await copy.getByRole('button',{name:'打开文案信笺',exact:true}).click();assert.equal(await text.inputValue(),'自行修改的原始文案，不覆盖采集记录。');await synced(page);
  await page.reload();await copy.waitFor();await copy.getByRole('button',{name:'打开文案信笺',exact:true}).click();assert.equal(await text.inputValue(),'自行修改的原始文案，不覆盖采集记录。');assert((await copy.locator('.copy-letter-content').innerText()).includes('自己添加的话题'));
  await copy.getByRole('button',{name:/确\s*认$/}).click();await synced(page);assert.equal(stages.at(-1).text,'自行修改的原始文案，不覆盖采集记录。');assert(stages.at(-1).topics.includes('自己添加的话题'));assert.equal(source.body,'先磨豆，再缓慢注水。记录真实生活中的咖啡香气。');
  await nav.getByRole('button',{name:'图片仿写',exact:true}).click();const image=page.locator('.media-rewrite-image'),timeline=image.getByRole('region',{name:'图片生成时间线',exact:true});
  assert.equal(await timeline.locator('input[type=checkbox]:checked').count(),0);
  assert.equal(await timeline.locator('.image-upload-card').count(),1);assert.equal(await timeline.getByRole('button',{name:'添加图片上传位',exact:true}).count(),0);assert.equal(await timeline.getByText('点击或拖入图片',{exact:true}).count(),0);
  const prompt=timeline.locator('.image-upload-prompt');const icon=await prompt.locator('.anticon').boundingBox(),label=await prompt.locator('strong').boundingBox();assert(label.y>icon.y+icon.height);assert(Math.abs(label.x+label.width/2-icon.x-icon.width/2)<2);
  assert.equal(await timeline.getByText('原始图片 1',{exact:true}).count(),1);assert.equal(await timeline.getByText('原始图片 2',{exact:true}).count(),1);
  assert.equal(await image.locator('.media-copy-context').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');assert.equal(await image.locator('.media-copy-context h3').evaluate(el=>getComputedStyle(el).boxShadow),'none');
  await timeline.getByRole('checkbox',{name:'选用原图2',exact:true}).uncheck();await timeline.getByRole('checkbox',{name:'选用原图1',exact:true}).check();await image.getByRole('button',{name:/确\s*认$/}).click();await synced(page);assert.deepEqual(stages.at(-1).media.asset_ids,['source-1']);await page.reload();await image.waitFor();assert(await timeline.getByRole('checkbox',{name:'选用原图1',exact:true}).isChecked());await timeline.getByRole('checkbox',{name:'选用原图1',exact:true}).uncheck();await synced(page);
  await image.locator('.workflow-result-section').screenshot({path:path.join(out,'initial-upload.png'),animations:'disabled'});
  await timeline.locator('[data-upload-slot="0"] input[type=file]').setInputFiles({name:'first.png',mimeType:'image/png',buffer:png});await timeline.locator('[data-upload-id="uploaded-1"]').waitFor();await synced(page);assert.equal(await timeline.locator('.image-upload-card').count(),2);
  await timeline.locator('[data-upload-slot="1"] input[type=file]').setInputFiles({name:'second.png',mimeType:'image/png',buffer:png});await timeline.locator('[data-upload-id="uploaded-2"]').waitFor();await synced(page);
  const types=await timeline.locator('.image-timeline-track > li').evaluateAll(els=>els.map(el=>el.classList.contains('image-timeline-upload')?'upload':'generated'));assert.deepEqual(types,['upload','upload','upload','generated','generated','generated']);
  assert.deepEqual(await timeline.locator('.image-upload-card').evaluateAll(els=>els.map(el=>el.dataset.uploadId||'empty')),['empty','uploaded-2','uploaded-1']);
  const emptyBox=await timeline.locator('.image-upload-card').first().boundingBox(),newBox=await timeline.locator('[data-upload-id="uploaded-2"]').boundingBox();assert(newBox.y>=emptyBox.y+emptyBox.height);
  await timeline.getByRole('checkbox',{name:'选用上传图片1.png',exact:true}).check();await image.getByRole('button',{name:/确\s*认$/}).click();await synced(page);assert.deepEqual(stages.at(-1).media.asset_ids,['uploaded-1']);
  await page.reload();await image.waitFor();assert.equal(await timeline.locator('.image-upload-card').count(),3);assert(await timeline.getByRole('checkbox',{name:'选用上传图片1.png',exact:true}).isChecked());
  failUpload=true;await timeline.locator('[data-upload-slot="1"] input[type=file]').setInputFiles({name:'replacement.png',mimeType:'image/png',buffer:png});await page.getByText('上传暂时失败',{exact:true}).waitFor();assert.equal(await timeline.locator('[data-upload-id="uploaded-2"]').count(),1);failUpload=false;assert.equal(await timeline.locator('.image-upload-card').count(),3);
  for(const width of [1720,1157,823,547,390]){await page.setViewportSize({width,height:765});assert(await image.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await timeline.evaluate(el=>el.scrollTop=0);await image.locator('.workflow-result-section').screenshot({path:path.join(out,'uploads-'+width+'.png'),animations:'disabled'});}
  assets.filter(a=>a.source==='collection').forEach(a=>a.status='error');await page.reload();await image.waitFor();assert.equal(await image.getByRole('button',{name:'上传素材',exact:true}).count(),1);assert.equal(await image.locator('.source-media-empty').count(),0);
  await image.getByRole('button',{name:'上传素材',exact:true}).click();const modal=page.getByRole('dialog');await modal.locator('input[type=file]').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:png});await modal.getByText('reference.png',{exact:true}).waitFor();await modal.getByRole('button',{name:'确认选择',exact:true}).click();await image.locator('.media-source-panel img').waitFor();await synced(page);await page.reload();await image.locator('.media-source-panel img').waitFor();
  await nav.getByRole('button',{name:'视频仿写',exact:true}).click();const video=page.locator('.media-rewrite-video');assert.equal(await video.getByRole('button',{name:'上传素材',exact:true}).count(),1);await video.getByRole('button',{name:'上传素材',exact:true}).click();assert.equal(await modal.locator('input[type=file]').getAttribute('accept'),'video/mp4,video/quicktime,video/webm');await modal.getByRole('button',{name:'Close',exact:true}).click();await modal.waitFor({state:'hidden'});await page.screenshot({path:path.join(out,'empty-video-upload.png'),fullPage:true,animations:'disabled'});
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({status:'PASS',uploads:uploads.length,checks:['one empty slot; auto append after upload; no plus; centered upload label','empty uploader first; new uploaded image directly below; order survives reload','original images available before generation; selection saved across reload','title context background and shadow removed','project upload survives reload and is selectable for publication','failed replacement preserves old image','missing image and video use creation material picker; uploaded reference survives refresh','original text and topics editable; candidates do not overwrite edits; refresh restores; save submits edits','five responsive widths'],errors},null,2));console.log('PASS image timeline uploads, original copy editing, persistence, selection and responsive layout.');
 }catch(e){await browser.contexts()[0]?.pages()[0]?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
