const f = require("./direct-media-fixture.cjs");
const out = f.path.resolve(__dirname, "../../data/verification/rose-colors");
const stamp = "2026-11-05T14:00:00Z";
const notes = [0, 1, 2].map((i) => ({
  ...f.source,
  id: i ? "note-" + i : "n-media",
  note_id: i ? "note-" + i : "n-media",
  revision_id: f.source.id,
  title: ["周末的一杯手冲", "城市里的散步", "一段新的创作"][i],
  author: "日常手记",
  platform: "xhs",
  kind: "image",
  tags: [],
  rating: 3,
  created_at: stamp,
  updated_at: stamp,
}));
f.publications.push({
  id: "color-publication",
  project_id: f.projects[0].id,
  title: notes[0].title,
  body: notes[0].body,
  topics: notes[0].topics,
  kind: "image",
  asset_ids: ["source-1", "source-2"],
  target_platform: "xhs",
  ready: true,
  created_at: stamp,
});
f.jobs.push({
  id: "color-job",
  target: "source-1",
  kind: "ocr",
  state: "succeeded",
  stage: "提取图片文字",
  attempts: 1,
  created_at: stamp,
  updated_at: stamp,
  task_project: {
    category: "collect",
    id: "n-media",
    name: notes[0].title,
    item_name: "原始图片",
  },
});
const mutations = [];
f.workflows[f.projects[0].id].drafts.image = {
  revision: 1,
  data: { reference_asset_ids: [] },
};
async function fixture(route) {
  const req = route.request(),
    u = new URL(req.url()),
    e = u.pathname.slice(7);
  if (req.method() !== "GET")
    mutations.push({ method: req.method(), endpoint: e });
  if (e === "/collections")
    return route.fulfill({
      json: {
        items: u.searchParams.get("deleted") === "true" ? [] : notes,
        total: u.searchParams.get("deleted") === "true" ? 0 : notes.length,
        tags: [],
      },
    });
  if (e === "/usage")
    return route.fulfill({ json: { usage: [], price_per_1k: 0 } });
  return f.routeAPI(route);
}
async function inspect(page, name) {
  const result = await page.evaluate(() => {
    const found = new Map();
    const unwanted = (color) => {
      const rgb = color.match(/[\d.]+/g)?.map(Number);
      if (!rgb || rgb.length < 3 || (rgb.length > 3 && rgb[3] < 0.1))
        return false;
      const [r, g, b] = rgb.map((x) => x / 255),
        max = Math.max(r, g, b),
        min = Math.min(r, g, b),
        d = max - min;
      if (!d || d / max < 0.08) return false;
      let h =
        max === r
          ? ((g - b) / d) % 6
          : max === g
            ? (b - r) / d + 2
            : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
      return h >= 80 && h <= 250;
    };
    for (const el of document.querySelectorAll(
      ".rednote-shell *, .ant-modal *, .ant-drawer *",
    )) {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
        continue;
      for (const pseudo of [null, "::before", "::after"]) {
        const style = getComputedStyle(el, pseudo);
        if (pseudo && ["none", "normal"].includes(style.content)) continue;
        for (const prop of [
          "color",
          "backgroundColor",
          "backgroundImage",
          "borderTopColor",
          "outlineColor",
          "boxShadow",
          "scrollbarColor",
        ]) {
          if (
            prop === "borderTopColor" &&
            parseFloat(style.borderTopWidth) === 0
          )
            continue;
          if (prop === "outlineColor" && style.outlineStyle === "none")
            continue;
          const value = style[prop];
          if (
            ![...value.matchAll(/rgba?\([^)]+\)/g)].some((m) => unwanted(m[0]))
          )
            continue;
          const cls =
            typeof el.className === "string" ? el.className : el.tagName;
          const key = [cls, pseudo, prop, value].join("|");
          if (!found.has(key))
            found.set(key, {
              cls,
              pseudo,
              prop,
              value,
              text: el.textContent?.trim().slice(0, 40),
            });
        }
      }
    }
    return [...found.values()];
  });
  await f.fs.writeFile(
    f.path.join(out, name + ".json"),
    JSON.stringify(result, null, 2),
  );
  console.log(name + ": " + result.length + " green/blue style entries");
}
(async () => {
  await f.fs.mkdir(out, { recursive: true });
  const b = await f.chromium.launch(f.browserLaunchOptions);
  try {
    const c = await b.newContext({
      viewport: { width: 1144, height: 751 },
      reducedMotion: "reduce",
    });
    await c.addInitScript(() =>
      localStorage.setItem("rednote.appearance.theme", "rose"),
    );
    await c.route("**/api/v1/**", fixture);
    const p = await c.newPage();
    p.setDefaultTimeout(12000);
    for (const page of [
      "collections",
      "publications",
      "media",
      "trash",
      "usage",
      "settings",
      "rewrites",
    ]) {
      await p.goto(f.base + "/#" + page);
      await p.locator(".page-" + page).waitFor();
      if (page === "collections")
        await p
          .getByText(notes[0].title, { exact: true })
          .filter({ visible: true })
          .first()
          .waitFor();
      if (page === "publications")
        await p
          .getByText(notes[0].title, { exact: true })
          .filter({ visible: true })
          .first()
          .waitFor();
      if (page === "rewrites") {
        const nav = p.getByRole("navigation", { name: "仿写创作步骤" });
        for (const step of [
          "基本信息",
          "标题仿写",
          "文案仿写",
          "图片仿写",
          "视频仿写",
        ]) {
          await nav.getByRole("button", { name: step, exact: true }).click();
          const stageSelectors = {
            基本信息: ".workflow-account-heading",
            标题仿写: ".title-wheel-panel",
            文案仿写: ".copy-letter-panel",
            图片仿写: ".media-rewrite-image",
            视频仿写: ".media-rewrite-video",
          };
          await p.locator(stageSelectors[step]).waitFor();
          if (step === "图片仿写") {
            const panel = p.locator(".media-rewrite-image");
            f.assert.equal(
              await panel
                .getByRole("status")
                .filter({ hasText: "请选择原始图片" })
                .count(),
              0,
            );
            f.assert(
              await panel
                .getByRole("button", { name: "开始生成", exact: true })
                .isDisabled(),
            );
            const timeline = panel.locator(".image-result-timeline");
            await timeline.hover();
            f.assert(
              (
                await timeline.evaluate(
                  (el) => getComputedStyle(el).scrollbarColor,
                )
              ).startsWith("rgb(178, 121, 150)"),
            );
          }
          await inspect(p, "rewrite-" + step);
          await p.screenshot({
            path: f.path.join(out, "rewrite-" + step + ".png"),
          });
        }
      } else {
        await inspect(p, page);
        if (page === "publications") {
          await p
            .locator(".page-publications")
            .getByRole("button", {
              name: "查看发布稿 " + notes[0].title,
              exact: true,
            })
            .filter({ visible: true })
            .first()
            .click();
          const preview = p.locator(".publication-confirmation");
          await preview.locator(".publication-editor-media").waitFor();
          await preview.screenshot({
            path: f.path.join(out, "publication-preview.png"),
          });
          await inspect(p, "publication-preview");
          await preview
            .getByRole("button", { name: "暂不确认", exact: true })
            .click();
        }
      }
    }
    await p.getByRole("button", { name: /后台任务/ }).click();
    await p.locator(".task-modal .task-project-card").first().waitFor();
    await p
      .locator(".task-modal")
      .screenshot({ path: f.path.join(out, "tasks.png") });
    await inspect(p, "task-dialog");
    await p.locator(".task-modal .ant-modal-close").click();
    await p.goto(f.base + "/#collections");
    const card = p.locator(".collection-card").first();
    await card.waitFor();
    await card.getByRole("button", { name: /删除/ }).click();
    await p.locator(".ant-modal-confirm").waitFor();
    await p.getByRole("img", { name: "蝴蝶", exact: true }).waitFor();
    await p.locator('.ant-modal-confirm').evaluate(async el => {
      await new Promise(requestAnimationFrame);
      await Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})));
    });
    await p
      .locator(".ant-modal-confirm")
      .screenshot({ path: f.path.join(out, "delete.png"), animations:'disabled' });
    f.assert.equal(
      await p
        .locator(".confirm-butterfly")
        .evaluate((el) => getComputedStyle(el).color),
      "rgb(178, 121, 150)",
    );
    await inspect(p, "collection-delete");
    await p
      .locator(".ant-modal-confirm")
      .getByRole("button", { name: /取\s*消$/ })
      .click();
    f.assert.deepEqual(mutations, [], "Audit must not mutate user content");
    for (const theme of ["forest", "pixel"]) {
      const next = await b.newContext({
        viewport: { width: 1144, height: 751 },
        reducedMotion: "reduce",
      });
      await next.addInitScript(
        (theme) => localStorage.setItem("rednote.appearance.theme", theme),
        theme,
      );
      await next.route("**/api/v1/**", fixture);
      const other = await next.newPage();
      await other.goto(f.base + "/#collections");
      const card = other.locator(".collection-card").first();
      await card.waitFor();
      await card.getByRole("button", { name: /删除/ }).click();
      const dialog = other.locator(".ant-modal-confirm");
      await dialog.waitFor();
      f.assert.equal(await dialog.locator(".confirm-butterfly").count(), 0);
      await dialog.getByRole("img", { name: "delete", exact: true }).waitFor();
      await next.close();
    }
    console.log(
      "PASS rose scrollbars, missing-reference hint removal with validation retained, butterfly confirmations, page audit and other-theme icon fallback. All API traffic mocked.",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
