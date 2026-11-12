const {chromium,assert,routeAPI,publications,stamp}=require("./direct-media-fixture.cjs");
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe"});
 try{
  const page=await browser.newPage({viewport:{width:1124,height:884},reducedMotion:"reduce"});const errors=[];page.on("pageerror",e=>errors.push(e.message));
  for(let i=0;i<13;i++)publications.push({id:"flow-"+i,project_id:"media-project",version_id:"v",target_platform:i%2?"douyin":"xhs",title:"流程检查"+String(i).padStart(2,"0"),body:i===4?"唯一正文搜索标记":"完整正文",topics:["咖啡"],kind:"image",asset_ids:["source-1","source-2"],cover_id:"source-1",ready:true,manual_status:i%3===0?"published":"ready",revision:1,created_at:stamp});
  await page.route("**/api/v1/**",async r=>{const e=new URL(r.request().url()).pathname.slice(7);if(e==="/publications/batch-trash"){const d=r.request().postDataJSON();for(const p of publications)if(d.ids.includes(p.id))p.deleted_at=stamp;return r.fulfill({json:{count:1}})}return routeAPI(r)});
  await page.goto("http://127.0.0.1:8081/#publications");await page.getByText("共 13 份发布稿",{exact:true}).waitFor();assert.equal(await page.locator('.ant-table-tbody .ant-table-row').count(),10);
  await page.locator('.ant-pagination-item-2').click();assert.equal(await page.locator('.ant-table-tbody .ant-table-row').count(),3);
  await page.getByRole("searchbox",{name:"搜索发布稿",exact:true}).fill("唯一正文搜索标记");await page.getByRole("button",{name:"查看发布稿 流程检查04",exact:true}).waitFor();assert.equal(await page.locator('.ant-table-tbody .ant-table-row').count(),1);
  await page.getByRole("searchbox",{name:"搜索发布稿",exact:true}).fill("");
  const select=async(name,label)=>{await page.locator('.ant-select').filter({has:page.getByRole('combobox',{name,exact:true})}).click();await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({hasText:new RegExp('^'+label+'$')}).click();};
  await select("筛选发布平台","抖音");await page.getByText("共 6 份发布稿",{exact:true}).waitFor();
  await select("发布状态","已发布");await page.getByText("共 2 份发布稿",{exact:true}).waitFor();
  await select("发布状态","全部发布状态");await select("筛选发布平台","全部平台");
  await page.getByRole("searchbox",{name:"搜索发布稿",exact:true}).fill("流程检查04");await page.getByRole("button",{name:"查看发布稿 流程检查04",exact:true}).click();
  const detail=page.getByRole("region",{name:"发布稿详情",exact:true});await detail.waitFor();await detail.getByRole("button",{name:"下一张发布素材",exact:true}).click();await page.waitForFunction(()=>document.querySelector('.publication-preview-label span')?.textContent==="2 / 2");
  await page.getByRole("button",{name:/返回发布管理/}).click();await page.getByRole("button",{name:"更多操作 流程检查04",exact:true}).click();await page.getByText("移入回收站",{exact:true}).click();const dialog=page.getByRole("dialog");await dialog.getByRole("button",{name:/OK|确 定|确定/}).click();await page.getByText("还没有发布稿",{exact:true}).waitFor();assert(publications.find(p=>p.id==="flow-4").deleted_at);
  assert.deepEqual(errors,[]);console.log("PASS: desktop pagination, title/body search, platform/status combined filter, detail carousel, trash refresh; mocked APIs");
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
