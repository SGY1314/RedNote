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
    let saves = 0;
    await page.route("http://workbench.test/**", async (route) => {
      const req = route.request(),
        p = new URL(req.url()).pathname;
      if (p.startsWith("/api/v1")) {
        const e = p.slice(7);
        let body = [],
          status = 200;
        if (e === "/session") body = { csrf_token: "fixture" };
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
        contentType: file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html",
      });
    });
    await page.goto("http://workbench.test/#rewrites");
    const title = page.getByRole("textbox", { name: "创作标题", exact: true }),
      body = page.getByRole("textbox", { name: "创作正文", exact: true });
    await title.waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="创作标题"]')?.value ===
        "后台草稿标题",
    );
    const saved = page.waitForResponse(
      (r) =>
        r.url().includes("/drafts/image") &&
        r.request().postDataJSON().content.body === "最新编辑正文",
    );
    await body.fill("最新编辑正文");
    await saved;
    assert.equal(project.drafts.image.content.body, "最新编辑正文");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="创作正文"]')?.value ===
        "最新编辑正文",
    );
    await page
      .getByRole("button", { name: /保存完整版本$/ })
      .first()
      .click();
    await page.getByLabel("完整版本名称").fill("自然版");
    await page.getByRole("button", { name: "保存版本", exact: true }).click();
    await page.waitForFunction(
      () =>
        !document.querySelector(
          '.ant-modal-wrap:not([style*="display: none"])',
        ),
    );
    await page
      .getByRole("button", { name: /确认并选用完整版本$/ })
      .first()
      .click();
    await page
      .getByText("当前选用：V2 · 自然版 · 图文 · 1 个素材", { exact: true })
      .waitFor();
    assert.equal(project.selected_versions.image, "v2");
    assert.equal(versions.filter((v) => !v.generated).length, 2);
    await page
      .getByRole("button", { name: /保存完整版本$/ })
      .first()
      .click();
    await page.getByRole("button", { name: "保存版本", exact: true }).click();
    await page.getByText("内容未变化，沿用 V2", { exact: true }).waitFor();
    assert.equal(versions.filter((v) => !v.generated).length, 2);
    await page.getByRole("button", { name: "重命名版本", exact: true }).click();
    await page.getByLabel("完整版本名称").fill("最终发布版");
    await page.getByRole("button", { name: "保存版本", exact: true }).click();
    await page
      .getByText("版本名称已更新，版本号不变", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: /完整版本对比$/ }).click();
    await page.getByLabel("版本变化摘要").waitFor();
    assert.ok(
      await page.getByText("右侧相对左侧的变化", { exact: true }).isVisible(),
    );
    assert.deepEqual(errors, []);
    assert.ok(saves >= 1);
    console.log(
      "PASS: browser restores database draft, autosaves edits, saves/names/confirms version, selects it, deduplicates, renames and displays differences; no real services called.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
