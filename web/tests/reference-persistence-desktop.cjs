const { chromium, assert, routeAPI, workflows, source, publications } = require("./direct-media-fixture.cjs");
const scopes = ["title", "copy", "image", "video-script"];
const labels = ["标题仿写", "文案仿写", "图片仿写", "视频仿写"];
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe"});
  const baseline = JSON.stringify(workflows);
  try {
    for (const confirmed of [false, true]) {
      Object.assign(workflows, JSON.parse(baseline));
      const w = workflows["media-project"];
      if (!confirmed) { w.title = {key:"",text:""}; w.copy = {key:"",body:"",topics:[]}; }
      else {
        w.copy.generation_id = "old-copy";
        w.drafts.copy = {revision:1,data:{text:w.copy.body,topics:w.copy.topics,generation_id:"old-copy",candidate_index:0,selection_kind:"candidate",source_copy:{body:source.body,topics:source.topics}}};
      }
      const oldBody = confirmed ? w.copy.body : source.body;
      const oldTitle = confirmed ? w.title.text : source.title;
      const posts = [], errors = [];
      let serial = 0;
      const page = await browser.newPage({viewport:{width:1124,height:884},reducedMotion:"reduce"});
      page.on("pageerror", e=>errors.push(e.message));
      await page.route("**/api/v1/**", async route => {
        const req=route.request(), e=new URL(req.url()).pathname.slice(7);
        if(e==="/profile/default") return route.fulfill({json:{}});
        if(e.endsWith("/workflow")) return route.fulfill({json:{workflow:w,basis:{title:w.title,copy:{...w.copy,title_key:w.title.key}},reference:source,titles:[],copies:[{id:"old-copy",title_key:"title-key",copies:[{body:oldBody,topics:["新文案"]}]}],image_plans:[],angles:[]}});
        if(e.endsWith("/workflow/stage")) {
          const d=req.postDataJSON(); posts.push(d);
          if(d.step==="title") w.title={key:"title-"+(++serial),text:d.text};
          if(d.step==="copy") w.copy={key:"copy-"+(++serial),title_key:w.title.key,body:d.text,topics:d.topics,generation_id:d.generation_id};
          for(const scope of scopes){if(scope===d.step)continue;const draft=w.drafts[scope];draft.data.reference_input={...draft.data.reference_input,...(d.step==="title"?{title:d.text,title_source:"rewritten"}:{body:d.text,topics:d.topics,body_source:"rewritten"})};draft.revision++;}
        }
        if(e.endsWith("/titles/generate")) return route.fulfill({status:503,json:{error:"模拟生成失败"}});
        return routeAPI(route);
      });
      const nav=page.getByRole("navigation",{name:"仿写创作步骤",exact:true});
      const reference=()=>page.getByRole("region",{name:"参考内容",exact:true});
      const field=name=>reference().getByRole("textbox",{name,exact:true});
      const go=async label=>{await nav.getByRole("button",{name:label,exact:true}).click();await reference().waitFor();};
      const check=async(title,body)=>{assert.equal(await field("参考标题").inputValue(),title);assert.equal(await field("参考文案").inputValue(),body);};
      await page.goto("http://127.0.0.1:8081/#rewrites");await nav.waitFor();
      for(const label of labels){await go(label);await check(label==="标题仿写"?source.title:oldTitle,label==="文案仿写"?source.body:oldBody);}
      await go("标题仿写");
      await field("参考文案").fill("手动参考正文");
      await page.locator('.title-rewrite-panel:not(.copy-rewrite-panel)').getByRole("textbox",{name:"自定义标题",exact:true}).fill("再次确认标题");
      // Editing a candidate must not update the reference before confirmation.
      await check(source.title,"手动参考正文");
      await page.locator('.title-rewrite-panel:not(.copy-rewrite-panel)').getByRole("button",{name:/确认/}).last().click();
      await page.waitForTimeout(400);
      await check(source.title,"手动参考正文");
      await go("文案仿写");await check("再次确认标题",source.body);
      const copy=page.locator('.copy-rewrite-panel');
      await copy.getByRole("button",{name:"打开文案信笺",exact:true}).click();
      assert.equal(await copy.getByRole("textbox",{name:"最终文案",exact:true}).inputValue(),oldBody);
      await copy.getByRole("button",{name:/确认/}).last().click();
      await page.waitForFunction(body=>document.querySelector('textarea[aria-label="参考文案"]')?.value===body,source.body);
      assert.equal(posts.at(-1).text,oldBody);
      assert.equal(posts.at(-1).generation_id,"");
      await field("参考标题").fill("手动参考标题");
      await copy.getByRole("textbox",{name:"最终文案",exact:true}).fill("新确认正文");
      await check("手动参考标题",source.body);
      await copy.getByRole("button",{name:/确认/}).last().click();
      await page.waitForTimeout(400);
      await check("手动参考标题",source.body);
      await go("标题仿写");await check(source.title,"新确认正文");
      await field("参考标题").fill("保留手写标题");await field("参考文案").fill("保留手写正文");
      await page.waitForTimeout(900);
      await page.locator('.title-rewrite-panel:not(.copy-rewrite-panel)').getByRole("button",{name:"开始生成",exact:true}).click();
      await page.getByText("模拟生成失败",{exact:true}).first().waitFor();
      await check("保留手写标题","保留手写正文");
      await page.reload();await nav.waitFor();await go("标题仿写");await check("保留手写标题","保留手写正文");
      await go("图片仿写");await check("再次确认标题","新确认正文");
      assert.equal(publications.length,0);
      assert.deepEqual(errors,[]);
      await page.close();
    }
    console.log("PASS: original defaults, confirmed defaults, detached copy, independent confirmations, manual persistence, failed generation; mocked APIs, desktop Chrome");
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
