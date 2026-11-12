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
    const publications = Array.from({ length: 12 }, (_, i) => ({
      id: `pub-${i}`,
      title: `城市漫游的日常灵感 ${i + 1}`,
      body: "分享值得记录的生活片段",
      topics: ["生活记录"],
      asset_ids: ["img"],
      kind: "image",
      ready: i !== 0,
      target_platform: i % 2 ? "douyin" : "xhs",
      online_state: i === 2 ? "manual_ready" : i === 4 ? "needs_review" : "",
      created_at: "2026-10-23T02:00:00Z",
      published_at: i === 6 ? "2026-10-23T03:00:00Z" : "",
    }));
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
        else if (e === "/collections") body = { items: [], total: 0 };
        else if (e === "/usage") body = { usage: [], price_per_1k: 0.01 };
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
              publications,
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
            services: {
              rewrite: { configured: false },
              ocr: { configured: false },
              asr: { configured: false },
            },
            dependencies: {},
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

    const out =
      process.env.WORKBENCH_UI_QA_OUT ||
      path.resolve(__dirname, "../../verification/responsive-clean");
    await fs.mkdir(out, { recursive: true });
    await page.goto("https://workbench.test/#publications");
    await page.locator(".publication-note").first().waitFor();
    const nav = page.getByRole("navigation", { name: "主导航", exact: true });
    assert.equal(await nav.getByRole("button").count(), 4);
    for (const width of [1440, 820, 390, 320]) {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
      if (width < 700) {
        await page.locator(".publication-mobile-card").first().waitFor();
        assert.equal(
          await page.locator(".publication-mobile-card").count(),
          10,
        );
        assert.equal(await page.locator(".ant-table").count(), 0);
      } else await page.locator(".ant-table").waitFor();
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `No overflow at ${width}`,
      );
      await page.screenshot({
        path: path.join(out, `publications-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .locator(".ant-pagination")
      .getByTitle("2", { exact: true })
      .click();
    assert.equal(await page.locator(".publication-mobile-card").count(), 2);
    await page.getByPlaceholder("搜索发布标题或正文").fill("灵感 12");
    assert.equal(await page.locator(".publication-mobile-card").count(), 1);
    await page
      .getByRole("button", {
        name: "查看发布稿 城市漫游的日常灵感 12",
        exact: true,
      })
      .click();
    await page.getByRole("dialog", { name: "发布稿详情" }).waitFor();
    await page.locator(".ant-drawer-open .ant-drawer-close").click();
    await page.getByPlaceholder("搜索发布标题或正文").fill("灵感 1");
    await page
      .getByRole("button", {
        name: "更多操作 城市漫游的日常灵感 1",
        exact: true,
      })
      .click();
    assert.equal(
      await page
        .getByRole("menuitem", { name: "记录已发布", exact: true })
        .getAttribute("aria-disabled"),
      "true",
    );
    await page.keyboard.press("Escape");
    await page.getByPlaceholder("搜索发布标题或正文").fill("灵感 3");
    await page
      .getByRole("button", {
        name: "更多操作 城市漫游的日常灵感 3",
        exact: true,
      })
      .click();
    await page
      .getByRole("menuitem", { name: "记录已发布", exact: true })
      .click();
    await page.getByRole("dialog", { name: "记录实际发布结果" }).waitFor();
    await page.getByRole("button", { name: /取\s*消/ }).click();
    assert.equal(
      publicationRequests.length,
      0,
      "Browsing cards never creates or publishes content",
    );
    await nav.getByRole("button", { name: "采集库", exact: true }).click();
    const capture = page.getByRole("textbox", {
      name: "笔记链接或分享文字",
      exact: true,
    });
    assert.equal(await capture.isVisible(), false);
    await page.getByRole("button", { name: /添加灵感$/ }).click();
    await capture.fill("https://www.xiaohongshu.com/explore/example");
    await page.getByRole("button", { name: /收起输入$/ }).click();
    await page.getByRole("button", { name: /添加灵感$/ }).click();
    assert.equal(
      await capture.inputValue(),
      "https://www.xiaohongshu.com/explore/example",
    );
    await page.getByRole("button", { name: /收起输入$/ }).click();
    await page.screenshot({
      path: path.join(out, "collections-390.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "账号菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: /设置$/ }).click();
    await page.locator(".ant-drawer-open").waitFor();
    await page.locator(".ant-drawer-open .ant-drawer-close").click();
    await page.getByRole("button", { name: "账号菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: /计费面板$/ }).click();
    await page.waitForURL("**/#usage");
    await nav.getByRole("button", { name: "仿写库", exact: true }).click();
    await page
      .getByRole("textbox", { name: "创作正文", exact: true })
      .waitFor();
    assert.equal(await page.locator(".rewrite-projects").isVisible(), false);
    await page.getByRole("button", { name: /返回项目列表$/ }).click();
    await page.locator(".project-title-button").filter({ hasText: project.name }).waitFor();
    assert.equal(await page.locator(".rewrite-projects").count(), 0);
    assert.equal(await page.locator(".project-card").count(), 1);
    assert.deepEqual(errors, []);
    const result = {
      status: "passed",
      widths: [1440, 820, 390, 320],
      checks: [
        "four primary nav items",
        "mobile publication cards and pagination",
        "search resets page",
        "detail preview",
        "pending record disabled",
        "record dialog",
        "collapsed capture retains input",
        "settings and billing in account menu",
        "mobile project back navigation",
        "no browser exceptions",
      ],
    };
    await fs.writeFile(
      path.join(out, "responsive-clean-verification.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
