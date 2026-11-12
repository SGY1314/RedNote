const { chromium, browserLaunchOptions } = require("./browser.cjs");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const page = await browser.newPage({
        viewport: { width: 1500, height: 1100 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const media = { kind: "image", asset_ids: ["img"], cover_id: "" };
    const project = {
      id: "p-workflow",
      name: "版本流程验证",
      platform: "xhs",
      sources: [],
      kind: "image",
      asset_ids: ["img"],
      media_selections: { image: media },
      selected_versions: { image: "v1" },
      created_at: "2026-10-15T01:00:00Z",
      drafts: {
        image: {
          revision: 1,
          saved_at: "2026-10-15T03:00:00Z",
          edited_at: "2026-10-15T03:00:00Z",
          content: {
            title: "后台草稿标题",
            body: "服务器保存的正文",
            topics: [],
          },
          versionID: "v1",
          sourceIDs: [],
          media,
          creative: {},
          length: "简短一些",
        },
      },
    };
    const versions = [
      {
        id: "trial",
        project_id: project.id,
        number: 0,
        generated: true,
        title: "AI试写标题",
        body: "AI试写正文",
        topics: [],
        media,
        source_ids: [],
        status: "draft",
        created_at: project.created_at,
      },
      {
        id: "v1",
        project_id: project.id,
        number: 1,
        name: "第一版",
        title: "旧标题",
        body: "旧正文",
        topics: [],
        media,
        source_ids: [],
        status: "confirmed",
        created_at: project.created_at,
      },
    ];
    const assets = [
      {
        id: "img",
        name: "测试图片",
        kind: "image",
        status: "ready",
        source: "upload",
        size: 100,
        width: 10,
        height: 10,
        created_at: project.created_at,
      },
    ];
    let failDraft = false;
    let saves = 0,
      publicationRequests = [];
    await page.route("https://workbench.test/**", async (route) => {
      const req = route.request(),
        p = new URL(req.url()).pathname;
      if (p.startsWith("/api/v1")) {
        const e = p.slice(7);
        let body = [],
          status = 200;
        if (e === "/auth/me")
          body = {
            user: {
              id: "qa",
              username: "qa",
              display_name: "测试创作者",
              role: "creator",
              status: "active",
            },
          };
        else if (e === "/publications" && req.method() === "POST") {
          publicationRequests.push(req.postDataJSON());
          body = { id: "publication-qa" };
        } else if (e === "/session") body = { csrf_token: "fixture" };
        else if (e === "/sync")
          body = {
            reset: true,
            more: false,
            epoch: "fixture",
            cursor: 1,
            changes: Object.entries({
              jobs: [],
              assets,
              projects: [project],
              publications: [],
            }).flatMap(([entity, values]) =>
              values.map((value) => ({ entity, id: value.id, value })),
            ),
          };
        else if (e === "/rewrites") body = [project];
        else if (e === "/assets") body = assets;
        else if (e.startsWith("/assets/") && e.endsWith("/file"))
          return route.fulfill({
            body: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=",
              "base64",
            ),
            contentType: "image/png",
          });
        else if (e === "/rewrites/" + project.id && req.method() === "PATCH") {
          Object.assign(project, req.postDataJSON());
          body = project;
        } else if (e === "/rewrites/" + project.id)
          body = {
            project,
            versions,
            reference_assets: [],
            reference_videos: [],
          };
        else if (e.endsWith("/drafts/image")) {
          if (failDraft)
            return route.fulfill({
              status: 503,
              json: { error: "模拟网络中断" },
            });
          const d = req.postDataJSON();
          if (d.revision !== project.drafts.image.revision) {
            status = 409;
            body = { error: "草稿冲突" };
          } else {
            body = {
              ...d,
              revision: d.revision + 1,
              saved_at: new Date().toISOString(),
            };
            project.drafts.image = body;
            saves++;
          }
        } else if (e.endsWith("/versions")) {
          const d = req.postDataJSON(),
            old = versions.find(
              (v) => !v.generated && v.title === d.title && v.body === d.body,
            );
          if (old) body = { ...old, reused: true };
          else {
            body = {
              ...d,
              id: "v2",
              project_id: project.id,
              number: 2,
              status: "draft",
              created_at: new Date().toISOString(),
            };
            versions.unshift(body);
            status = 201;
          }
        } else if (e.endsWith("/confirm")) {
          const id = e.split("/").at(-2),
            v = versions.find((v) => v.id === id);
          v.status = "confirmed";
          project.selected_versions.image = id;
          body = v;
        } else if (e.endsWith("/name")) {
          const id = e.split("/").at(-2),
            v = versions.find((v) => v.id === id);
          v.name = req.postDataJSON().name;
          body = v;
        } else if (e === "/settings")
          body = {
            rewrite: { configured: false },
            ocr: { configured: false },
            asr: { configured: false },
            data_dir: "fixture",
          };
        return route.fulfill({ status, json: body });
      }
      const file = p === "/" ? "index.html" : p.slice(1);
      if (file.includes("..")) return route.abort();
      return route.fulfill({
        body: await fs.readFile(path.join(__dirname, "../dist", file)),
        contentType: file.endsWith(".svg")
          ? "image/svg+xml"
          : file.endsWith(".png")
            ? "image/png"
            : file.endsWith(".js")
              ? "text/javascript"
              : file.endsWith(".css")
                ? "text/css"
                : "text/html",
      });
    });

    project.kind="video";
    project.asset_ids=[];
    project.selected_versions={video:"v1"};
    const videoMedia={kind:"video",asset_ids:[],cover_id:""};
    project.media_selections={video:videoMedia};
    project.drafts={video:{...project.drafts.image,media:videoMedia}};
    versions.forEach(v=>{v.media=videoMedia});
    const out=process.env.WORKBENCH_UI_QA_OUT || path.resolve(__dirname,"../../verification/rewrite-cleanup");
    await fs.mkdir(out,{recursive:true});
    await page.goto("https://workbench.test/#rewrites");
    await page.getByRole("textbox",{name:"创作正文",exact:true}).waitFor();
    await page.locator(".generation-panel > summary").click();
    assert.equal(await page.getByLabel("本次视频模型",{exact:true}).count(),0);
    await page.getByRole("combobox",{name:"本次文案模型",exact:true}).waitFor();
    await page.getByRole("button",{name:"生成文案",exact:true}).waitFor();
    assert.equal(await page.getByRole("button",{name:/生成试写文案|生成视频文案|生成图文文案/}).count(),0);
    await page.getByRole("tab",{name:"视频仿写",exact:true}).click();
    await page.getByRole("combobox",{name:"视频生成模型",exact:true}).waitFor();
    await page.getByRole("tab",{name:"文案编辑",exact:true}).click();
    await page.setViewportSize({width:390,height:844});
    await page.getByRole("button",{name:/返回项目列表$/}).click();
    for(const width of [320,390,700]){
      await page.setViewportSize({width,height:844});
      assert.equal(await page.locator(".rewrite-projects").count(),0,"Mobile does not mount a duplicate rail");
      assert.equal(await page.locator(".project-card").count(),1);
      assert.equal(await page.getByRole("button",{name:project.name,exact:true}).count(),1);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`No overflow ${width}`);
      await page.locator(".page-content").evaluate(el=>el.scrollTop=0);
      await page.screenshot({path:path.join(out,`project-list-${width}.png`),fullPage:true});
    }
    await page.getByRole("button",{name:`置顶项目 ${project.name}`,exact:true}).click();
    await page.getByRole("button",{name:`取消置顶 ${project.name}`,exact:true}).waitFor();
    await page.getByPlaceholder("搜索项目").fill("不会匹配");
    assert.equal(await page.locator(".project-card").count(),0);
    await page.getByPlaceholder("搜索项目").fill("");
    await page.getByRole("button",{name:project.name,exact:true}).click();
    await page.getByRole("textbox",{name:"创作正文",exact:true}).waitFor();
    for(const width of [820,1440]){
      await page.setViewportSize({width,height:1000});
      await page.locator(".rewrite-projects").waitFor();
      assert.equal(await page.locator(".project-rail-open").count(),1);
    }
    if (!(await page.locator(".generation-panel").evaluate(el=>el.open))) await page.locator(".generation-panel > summary").click();
    await page.getByRole("button",{name:"生成文案",exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,"copy-editor-video-project-1440.png"),fullPage:true});
    assert.deepEqual(errors,[]);
    const result={status:"passed",checks:["copy editor has no video model selector","video model available in video workspace","generate copy label with existing versions","one mobile project list at 320/390/700","pin and search on project cards","project card opens editor","desktop rail preserved at 820/1440","no browser exceptions"]};
    await fs.writeFile(path.join(out,"rewrite-cleanup-verification.json"),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
