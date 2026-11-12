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
    assets.push({
      id: "clip",
      name: "生活片段",
      kind: "video",
      status: "ready",
      source: "upload",
      category: "生活",
      size: 100,
      width: 10,
      height: 10,
      created_at: project.created_at,
    });
    assets.push({
      id: "result",
      name: "未入库生成结果",
      kind: "image",
      status: "ready",
      source: "generated",
      library_state: "result",
      size: 100,
      created_at: project.created_at,
    });
    let uploads = 0,
      edits = 0,
      trashChanges = 0;
    let releaseUpload;
    const uploadGate = new Promise((resolve) => {
      releaseUpload = resolve;
    });
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
        else if (e === "/assets" && req.method() === "POST") {
          uploads++;
          await uploadGate;
          body = {
            id: "uploaded",
            name: "uploaded.png",
            kind: "image",
            source: "upload",
            status: "ready",
            category: "",
            size: 100,
            width: 10,
            height: 10,
            created_at: project.created_at,
          };
          assets.push(body);
        } else if (e === "/assets/batch-trash") {
          const data = req.postDataJSON();
          trashChanges++;
          for (const asset of assets)
            if (data.ids.includes(asset.id))
              asset.deleted_at = data.deleted ? new Date().toISOString() : "";
          body = { count: data.ids.length };
        } else if (e.startsWith("/assets/") && req.method() === "PATCH") {
          body = assets.find((a) => a.id === e.split("/")[2]);
          Object.assign(body, req.postDataJSON());
          edits++;
        } else if (e === "/assets") body = assets;
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

    const out =
      process.env.WORKBENCH_UI_QA_OUT ||
      path.resolve(__dirname, "../../verification/standalone-media");
    await fs.mkdir(out, { recursive: true });
    await page.goto("https://workbench.test/#/media");
    await page
      .getByRole("heading", { name: "素材库", exact: true, level: 1 })
      .waitFor();
    await page
      .getByRole("button", { name: "预览 测试图片", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "预览 未入库生成结果", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.locator(".ant-drawer:visible").count(),
      0,
      "Independent page has no drawer",
    );
    await page.reload();
    await page
      .getByRole("button", { name: "预览 测试图片", exact: true })
      .waitFor();
    await page.getByPlaceholder("搜索名称、原文件名或分类").fill("生活");
    await page
      .getByRole("button", { name: "预览 生活片段", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "预览 测试图片", exact: true })
        .count(),
      0,
    );
    await page.getByPlaceholder("搜索名称、原文件名或分类").fill("");
    await page.getByRole("button", { name: /展开素材筛选/ }).click();
    await page
      .locator('[aria-label="素材类型筛选"]')
      .getByText("视频", { exact: true })
      .click();
    assert.equal(await page.locator(".local-media-card").count(), 1);
    await page.getByRole("button", { name: "重置筛选", exact: true }).click();
    await page.getByRole("button", { name: /收起素材筛选/ }).click();
    await page
      .getByRole("button", { name: "预览 测试图片", exact: true })
      .click();
    await page.getByRole("dialog", { name: "测试图片", exact: true }).waitFor();
    // Browser navigation closes library portals while the page remains mounted.
    await page.evaluate(() => {
      location.hash = "collections";
    });
    await page
      .getByRole("dialog", { name: "测试图片", exact: true })
      .waitFor({ state: "hidden" });
    const nav = page.getByRole("navigation", { name: "主导航", exact: true });
    await nav.getByRole("button", { name: "仿写库", exact: true }).click();
    await page
      .locator(".project-rail-open")
      .filter({ hasText: project.name })
      .click();
    const body = page.getByRole("textbox", { name: "创作正文", exact: true });
    await body.fill("切换素材库后仍保留的编辑草稿");
    assert.equal(
      await page.getByRole("tab", { name: "素材库", exact: true }).count(),
      0,
      "Management tab removed from rewrite editor",
    );
    await page.getByRole("button", { name: "打开素材库", exact: true }).click();
    await page.waitForURL((url) => url.hash === "#media");
    await page.getByRole("button", { name: /返回当前仿写$/ }).click();
    await body.waitFor();
    assert.equal(await body.inputValue(), "切换素材库后仍保留的编辑草稿");
    await page.getByRole("button", { name: "打开素材库", exact: true }).click();
    // Keep an upload alive during page navigation, then use its result in a rewrite.
    await page.getByRole("button", { name: /上传素材$/ }).click();
    await page.locator(".media-upload-box input[type=file]").setInputFiles({
      name: "uploaded.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await page
      .getByText("正在上传或排队：1 份，请保持工作台页面打开。", {
        exact: true,
      })
      .waitFor();
    await nav.getByRole("button", { name: "仿写库", exact: true }).click();
    releaseUpload();
    await nav.getByRole("button", { name: "素材库", exact: true }).click();
    await page
      .getByRole("button", { name: "预览 uploaded.png", exact: true })
      .waitFor();
    assert.equal(uploads, 1);
    await page
      .getByRole("button", { name: "预览 uploaded.png", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "uploaded.png", exact: true })
      .getByRole("button", { name: /重命名 \/ 分类$/ })
      .click();
    const edit = page.getByRole("dialog", {
      name: "重命名与分类",
      exact: true,
    });
    await edit
      .getByRole("textbox", { name: "素材名称", exact: true })
      .fill("整理好的封面");
    await edit
      .getByRole("combobox", { name: "素材分类", exact: true })
      .fill("封面");
    await edit.getByRole("button", { name: /保\s*存$/ }).click();
    await edit.waitFor({ state: "hidden" });
    await page
      .getByRole("dialog", { name: "整理好的封面", exact: true })
      .locator(".ant-modal-close")
      .click();
    assert.equal(edits, 1);
    await page
      .getByRole("button", { name: "素材操作 整理好的封面", exact: true })
      .click();
    await page.getByRole("menuitem", { name: /删除$/ }).click();
    await page
      .getByRole("dialog")
      .filter({ hasText: "删除 1 份素材？" })
      .getByRole("button", { name: "移入回收站", exact: true })
      .click();
    await page
      .getByRole("button", { name: "预览 整理好的封面", exact: true })
      .waitFor({ state: "hidden" });
    await page
      .locator('[aria-label="素材库范围"]')
      .getByText(/回收站/)
      .click();
    await page
      .getByRole("button", { name: "素材操作 整理好的封面", exact: true })
      .click();
    await page.getByRole("menuitem", { name: /恢复素材$/ }).click();
    await page
      .getByRole("button", { name: "预览 整理好的封面", exact: true })
      .waitFor({ state: "hidden" });
    assert.equal(trashChanges, 2);
    await page
      .locator('[aria-label="素材库范围"]')
      .getByText("素材库", { exact: true })
      .click();
    await page
      .getByRole("button", { name: "预览 整理好的封面", exact: true })
      .waitFor();
    await page
      .locator(".ant-message-notice")
      .first()
      .waitFor({ state: "hidden" });
    await page.getByRole("button", { name: /收起上传$/ }).click();
    assert.equal(await page.locator(".media-upload-box").isVisible(), false);
    for (const width of [1440, 820, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.locator(".page-content").evaluate((el) => {
        el.scrollTop = 0;
      });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "No document overflow",
      );
      assert(
        await nav
          .getByRole("button", { name: "素材库", exact: true })
          .isVisible(),
      );
      if (width === 390) {
        const labels = ["采集库", "仿写库", "素材库", "发布管理"];
        for (const label of labels) {
          const b = await nav
            .getByRole("button", { name: label, exact: true })
            .boundingBox();
          assert(b.x >= 0 && b.x + b.width <= width);
        }
      }
      await page.screenshot({
        path: path.join(out, `standalone-media-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: /返回当前仿写$/ }).click();
    await page.getByRole("tab", { name: /发布素材/ }).click();
    await page.getByRole("button", { name: /添加素材/ }).click();
    const picker = page.getByRole("dialog", {
      name: "选择图片素材（可单选或多选）",
      exact: true,
    });
    await picker
      .getByRole("button", { name: "选择素材 整理好的封面", exact: true })
      .click();
    await picker.getByRole("button", { name: "完成选择", exact: true }).click();
    await picker.waitFor({ state: "hidden" });
    assert(
      project.asset_ids.includes("uploaded"),
      "Independent library material remains selectable for rewriting",
    );
    assert.equal(
      await page.locator('[aria-label="创作正文"]').inputValue(),
      "切换素材库后仍保留的编辑草稿",
    );
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(out, "standalone-media-verification.json"),
      JSON.stringify(
        {
          checks: [
            "direct route and reload",
            "search and type filters",
            "preview closes on navigation",
            "management tab removed",
            "draft preserved on return",
            "upload survives navigation",
            "rename and category",
            "trash and restore",
            "1440/820/390 layout and navigation",
            "select library material in rewrite",
          ],
          uploads,
          edits,
          trashChanges,
          errors,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS independent media page, navigation, draft preservation, management and rewrite material selection",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
