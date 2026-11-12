const {chromium,assert,fs,path,routeAPI,publications,stamp}=require("./direct-media-fixture.cjs");
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe"});
 try {
  const out=path.resolve(__dirname,"../../data/verification/publication-replacement");await fs.mkdir(out,{recursive:true});
  const old={id:"replacement-old",project_id:"media-project",version_id:"v-old",target_platform:"xhs",title:"旧的等待发布稿",body:"保留的旧正文",topics:[],kind:"image",asset_ids:["source-1"],cover_id:"source-1",ready:true,revision:1,created_at:stamp,updated_at:stamp,workflow_managed:true};
  const current={...old,id:"replacement-current",version_id:"v-new",title:"新确认的发布稿",body:"新的正文",created_at:"2026-11-08T12:00:00Z",updated_at:"2026-11-08T12:00:00Z"};
  const history={...old,id:"replacement-history",title:"已发布的历史稿",manual_status:"published"};
  publications.push(old,current,history);
  const page=await browser.newPage({viewport:{width:1124,height:884},reducedMotion:"reduce"});const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/api/v1/**",async r=>{
   const e=new URL(r.request().url()).pathname.slice(7);
   if(e==="/collections")return r.fulfill({json:{items:[],total:0}});
   if(e==="/publications/batch-trash")return r.fulfill({status:409,json:{error:"同一项目和平台已有等待发布稿，请先处理当前稿件再恢复旧稿"}});
   return routeAPI(r);
  });
  await page.goto("http://127.0.0.1:8081/#publications");await page.getByRole("button",{name:"查看发布稿 新确认的发布稿",exact:true}).waitFor();
  assert.equal(await page.getByRole("button",{name:"查看发布稿 旧的等待发布稿",exact:true}).count(),0);
  assert.equal(await page.getByRole("button",{name:"查看发布稿 已发布的历史稿",exact:true}).count(),1);
  // Model the committed archive delivered by /sync. Refreshing must not resurrect it.
  old.deleted_at="2026-11-08T12:00:00Z";old.revision++;
  await page.reload();await page.getByRole("button",{name:"查看发布稿 新确认的发布稿",exact:true}).waitFor();
  assert.equal(await page.getByRole("button",{name:"查看发布稿 旧的等待发布稿",exact:true}).count(),0);
  await page.screenshot({path:path.join(out,"current-and-history.png")});
  await page.goto("http://127.0.0.1:8081/#trash");await page.getByText("旧的等待发布稿",{exact:true}).waitFor();
  await page.getByRole("button",{name:"恢复到发布管理",exact:true}).click();await page.getByText("同一项目和平台已有等待发布稿，请先处理当前稿件再恢复旧稿",{exact:true}).waitFor();
  assert(old.deleted_at);assert.equal(current.deleted_at,undefined);await page.screenshot({path:path.join(out,"restore-conflict.png")});
  assert.deepEqual(errors,[]);
  console.log("PASS: legacy replacement hidden on sync, committed archive stays hidden after reload, published history retained, archived snapshot visible in trash, restore conflict feedback; desktop mocked APIs");
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
