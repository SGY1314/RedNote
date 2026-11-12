const {chromium,fs,path,assert,routeAPI,publications,stamp}=require("./direct-media-fixture.cjs");
(async()=>{
 const out=path.resolve(__dirname,"../../data/verification/publication-audit");await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe"});
 const findings=[];
 const base={id:"audit-pub",project_id:"media-project",version_id:"audit-v",target_platform:"xhs",title:"审查发布稿",body:"审查正文",topics:["审查话题"],kind:"image",asset_ids:["source-1"],cover_id:"source-1",ready:true,revision:0,created_at:stamp};
 const make=async(items,override)=>{publications.splice(0,publications.length,...items);const page=await browser.newPage({viewport:{width:1124,height:884},reducedMotion:"reduce"});page.setDefaultTimeout(12000);page.on("pageerror",e=>console.log("Captured page error:",e.message));await page.route("**/api/v1/**",async r=>{if(await override?.(r,new URL(r.request().url()).pathname.slice(7)))return;return routeAPI(r)});return page;};
 try{
  let page=await make([{...base,id:"old",title:"已经被替换的旧稿",workflow_managed:false,updated_at:"2026-11-01T00:00:00Z"},{...base,id:"new",title:"当前新稿",workflow_managed:true,updated_at:"2026-11-02T00:00:00Z"}]);
  await page.goto("http://127.0.0.1:8081/#publications");await page.getByRole("button",{name:"查看发布稿 已经被替换的旧稿",exact:true}).waitFor();assert.equal(await page.getByRole("button",{name:/查看发布稿 /}).count(),2);findings.push({id:"P1",result:"同步数据里的被替换旧稿依然显示在发布列表"});await page.screenshot({path:path.join(out,"replaced-still-visible.png")});await page.close();
  page=await make([{...base,online_state:"prepared"}],async(r,e)=>{if(e.endsWith("/resolve")){await r.fulfill({status:409,json:{error:"该发布稿不需要核实"}});return true}});
  await page.goto("http://127.0.0.1:8081/#publications");await page.getByRole("button",{name:"查看发布稿 "+base.title,exact:true}).click();await page.getByRole("button",{name:"核实未发布",exact:true}).click();await page.getByRole("button",{name:"已核实未发布",exact:true}).click();await page.getByText("该发布稿不需要核实",{exact:true}).first().waitFor();findings.push({id:"P2",result:"prepared状态显示核实入口但后端拒绝，扫码按钮保持禁用"});await page.screenshot({path:path.join(out,"resolve-rejected.png")});await page.close();
  const pub={...base};let session;let cancels=0;
  page=await make([pub],async(r,e)=>{if(e==="/miniapp/cloud"){await r.fulfill({json:{available:true}});return true}if(e.endsWith("/mobile-handoff")){if(r.request().method()==="POST")session={id:"audit-session",state:"created",ticket:"a".repeat(32),expires_at:new Date(Date.now()+600000).toISOString(),miniapp_scheme_url:"xhsdiscover://miniapp/123456789012345678901234_trial/pages/publish/index?scene="+"a".repeat(32)};await r.fulfill(session?{json:session}:{status:404,json:{error:"尚未创建手机交接"}});return true}if(e.endsWith("/mobile-handoff/cancel")){cancels++;await r.fulfill({json:{...session,state:"cancelled"}});return true}if(e.endsWith("/status")){pub.manual_status=r.request().postDataJSON().status;pub.revision++;await r.fulfill({json:pub});return true}});
  await page.goto("http://127.0.0.1:8081/#publications");await page.getByRole("button",{name:"小红书扫码发布",exact:true}).click();await page.getByRole("button",{name:"生成二维码",exact:true}).click();await page.getByText(/用小红书扫一扫/).waitFor();await page.getByRole("button",{name:/关\s*闭/}).click();await page.locator('.ant-table-row .ant-select-selector').click();await page.locator('.ant-select-item-option[title="已发布"]').click();await page.waitForFunction(()=>document.querySelector('.ant-table-row .ant-select-selection-item')?.textContent==="已发布");assert(await page.getByRole("button",{name:"小红书扫码发布",exact:true}).isDisabled());assert.equal(cancels,0);assert.equal(session.state,"created");findings.push({id:"P3",result:"标记已发布未撤销二维码，同时原扫码入口被禁用"});await page.close();
  page=await make([{...base,target_platform:"douyin"}],async(r,e)=>{if(e==="/assets/source-1/file"){await r.fulfill({status:200,contentType:"image/png",body:Buffer.alloc(0)});return true}});
  await page.addInitScript(() => {
    window.__sizes = [];
    window.showDirectoryPicker = async () => ({
      getFileHandle: async (name, options) => {
        if (!options?.create) throw new DOMException("missing", "NotFoundError");
        return { createWritable: async () => ({
          write: async blob => window.__sizes.push(blob.size), close: async () => {}
        }) };
      }
    });
  });
  await page.goto("http://127.0.0.1:8081/#publications");await page.getByRole("button",{name:"抖音手动发布",exact:true}).click();await page.getByRole("button",{name:"选择文件夹并保存素材",exact:true}).click();await page.getByText("已保存 1 个素材到所选文件夹",{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>window.__sizes),[0]);findings.push({id:"P4",result:"文件夹保存对空文件报告成功，实际写入0字节"});await page.screenshot({path:path.join(out,"empty-file-success.png")});await page.close();
  page=await make([{...base,target_platform:"douyin",kind:"video",asset_ids:["missing-video-metadata"],cover_id:""}],async(r,e)=>{if(e==="/assets/missing-video-metadata/file"){await r.fulfill({contentType:"video/mp4",body:await fs.readFile(path.join(__dirname,"fixtures/native-reference.mp4"))});return true}});
  await page.goto("http://127.0.0.1:8081/#publications");await page.getByRole("button",{name:"抖音手动发布",exact:true}).click();const dlPromise=page.waitForEvent("download");await page.getByRole("button",{name:"浏览器下载素材",exact:true}).click();const dl=await dlPromise;assert(dl.suggestedFilename().endsWith(".jpg"));await dl.saveAs(path.join(out,"video-with-wrong-extension.jpg"));findings.push({id:"P5",result:"缺失素材元数据时，视频下载默认命名为.jpg"});await page.close();
  await fs.writeFile(path.join(out,"observations.json"),JSON.stringify(findings,null,2));console.log(JSON.stringify(findings));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
