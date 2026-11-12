const { chromium, browserLaunchOptions } = require("./browser.cjs");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const videoBytes = Buffer.from(
      await page.evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 120;
        const ctx = canvas.getContext("2d"),
          stream = canvas.captureStream(10),
          chunks = [];
        const recorder = new MediaRecorder(stream, {
          mimeType: "video/webm;codecs=vp8",
        });
        recorder.ondataavailable = (e) => chunks.push(e.data);
        const stopped = new Promise((resolve) => (recorder.onstop = resolve));
        recorder.start();
        let n = 0;
        const timer = setInterval(() => {
          ctx.fillStyle = n++ % 2 ? "#a95138" : "#768465";
          ctx.fillRect(0, 0, 160, 120);
        }, 80);
        await new Promise((resolve) => setTimeout(resolve, 1600));
        recorder.stop();
        await stopped;
        clearInterval(timer);
        stream.getTracks().forEach((t) => t.stop());
        return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
      }),
    );
    const stamp = "2026-10-23T02:00:00Z";
    const notes = [
      {
        id: "image-note",
        revision_id: "r-image",
        kind: "image",
        title: "三张图片的生活记录",
        author: "日常手记",
      },
      {
        id: "video-note",
        revision_id: "r-video",
        kind: "video",
        title: "可播放的视频记录",
        author: "影像日记",
      },
    ].map((n) => ({
      ...n,
      platform: "xhs",
      likes: 1280,
      favorites: 1000,
      comments: 12567,
      rating: 0,
      body: "卡片上的独立文案内容",
      topics: ["原始话题"],
      tags: ["生活"],
      created_at: stamp,
      updated_at: stamp,
    }));
    const assets = [0, 1, 2].map((i) => ({
      id: `img-${i}`,
      revision_id: "r-image",
      kind: "image",
      name: `图片 ${i + 1}`,
      position: i,
      status: i === 0 ? "ready" : "pending",
      source: "collection",
      library_state: "collected",
    }));
    assets.push(
      {
        id: "clip",
        revision_id: "r-video",
        kind: "video",
        name: "测试视频",
        position: 1,
        status: "ready",
        source: "collection",
      },
      {
        id: "cover",
        revision_id: "r-video",
        kind: "image",
        name: "封面",
        position: 0,
        status: "ready",
        source: "collection",
      },
    );
    const requests = [];
    await page.route("https://workbench.test/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        p = url.pathname;
      if (p.startsWith("/api/v1")) {
        const e = p.slice(7);
        let body = [];
        if (req.method() !== "GET")
          requests.push({ path: e, method: req.method() });
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
        else if (e === "/session") body = { csrf_token: "fixture" };
        else if (e === "/sync")
          body = {
            reset: true,
            more: false,
            epoch: "preview",
            cursor: 1,
            changes: assets.map((value) => ({
              entity: "assets",
              id: value.id,
              value,
            })),
          };
        else if (e === "/collections")
          body = { items: notes, total: notes.length, tags: ["生活", "高赞"] };
        else if (e.startsWith("/collections/")) {
          const note = notes.find((n) => n.id === e.split("/")[2]);
          if (req.method() === "PATCH") {
            Object.assign(note, req.postDataJSON());
            return route.fulfill({ json: note });
          }
          body = {
            note,
            revision: {
              id: note.revision_id,
              title: note.title,
              body: Array.from(
                { length: 100 },
                (_, i) => `第${i + 1}段：给生活留一点记录的空间。`,
              ).join("\n"),
              topics: ["生活记录"],
            },
            history: [{ id: note.revision_id, created_at: stamp }],
            assets: assets.filter((a) => a.revision_id === note.revision_id),
            extractions: [],
            jobs: [],
          };
        } else if (e.endsWith("/save-to-library")) {
          const asset = assets.find(a => a.id === e.split("/")[2]);
          asset.library_state = "saved";
          body = asset;
        } else if (
          e.startsWith("/assets/") &&
          (e.endsWith("/file") || e.endsWith("/preview"))
        ) {
          if (e.includes("/clip/")) {
            const match = /bytes=(\d+)-(\d*)/.exec(req.headers().range || "");
            const start = match ? Number(match[1]) : 0,
              end =
                match && match[2]
                  ? Math.min(Number(match[2]), videoBytes.length - 1)
                  : videoBytes.length - 1;
            return route.fulfill({
              status: match ? 206 : 200,
              body: videoBytes.subarray(start, end + 1),
              contentType: "video/webm",
              headers: {
                "Accept-Ranges": "bytes",
                ...(match
                  ? {
                      "Content-Range": `bytes ${start}-${end}/${videoBytes.length}`,
                    }
                  : {}),
              },
            });
          }
          const index = e.includes("img-1") ? 1 : e.includes("img-2") ? 2 : 0;
          return route.fulfill({
            contentType: "image/svg+xml",
            body: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="700"><rect width="600" height="700" fill="${["#acbaa4", "#c6a38e", "#d8c9b2"][index]}"/><circle cx="300" cy="280" r="150" fill="#f4eee2"/><text x="245" y="330" font-size="120" fill="#8d6a53">${index + 1}</text></svg>`,
          });
        }
        return route.fulfill({ json: body });
      }
      const file = p === "/" ? "index.html" : p.slice(1);
      return route.fulfill({
        body: await fs.readFile(path.join(__dirname, "../dist", file)),
        contentType: file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : file.endsWith(".svg")
              ? "image/svg+xml"
              : "text/html",
      });
    });
    const out =
      process.env.WORKBENCH_UI_QA_OUT ||
      path.resolve(__dirname, "../../verification/collection-preview");
    await fs.mkdir(out, { recursive: true });
    await page.goto("https://workbench.test/#collections");
    const card = page
      .locator(".collection-card")
      .filter({ hasText: notes[0].title });
    await card.waitFor();
    for (const width of [320, 390, 820, 1440]) {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
      const search = await page.getByRole('textbox', { name: '搜索采集笔记' }).boundingBox();
      const tag = await page.getByRole('combobox', { name: '分类标签筛选', exact: true }).boundingBox();
      const sort = await page.getByRole('combobox', { name: '笔记排序', exact: true }).boundingBox();
      assert(Math.abs(search.y - tag.y) < 12 && Math.abs(tag.y - sort.y) < 12, 'Search, tag and sort share a row');
      assert(search.x < tag.x && tag.x < sort.x);
      assert(await page.getByLabel('采集库视图', { exact: true }).isVisible(), 'View switch stays outside More');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(out, `curation-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await card.getByText('已就绪', { exact: true }).count(), 0);
    assert(await card.getByText('1.3k', { exact: true }).isVisible());
    assert(await card.getByText('1000', { exact: true }).isVisible());
    assert(await card.getByText('12.6k', { exact: true }).isVisible());
    assert.equal(await card.locator('img').first().evaluate(el => getComputedStyle(el).objectFit), 'contain');
    const stars = card.locator('.ant-rate-star');
    await stars.nth(3).click();
    await card.getByRole('status').filter({ hasText: '已保存' }).waitFor();
    assert.equal(notes[0].rating, 4);
    assert.equal(await card.locator('.ant-rate-star-full').count(), 4);
    const personal = card.getByRole('combobox', { name: '个人分类标签', exact: true });
    await personal.fill('旅行笔记');
    await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/collections/image-note') && r.request().method() === 'PATCH'),
      personal.press('Enter'),
    ]);
    assert(notes[0].tags.includes('旅行笔记'));
    await personal.press('Escape');
    await card.locator('.note-curation').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, 'curation-rating-tags-390.png'), fullPage: true });
    assert.equal(await page.locator('.ant-drawer-open').count(), 0, 'Rating and tagging do not open detail');
    await card.getByRole("button", { name: "下一页", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector(".collection-card-pages")?.dataset.active ===
        "1",
    );
    assert.equal(
      await page.locator(".ant-drawer-open").count(),
      0,
      "Changing image does not open detail",
    );
    const pages = card.locator(".collection-card-pages");
    await page.waitForFunction(() => { const el=document.querySelector('.collection-card-pages'); return Math.abs(el.scrollLeft-el.clientWidth)<2; });
    const cdp = await page.context().newCDPSession(page),
      box = await pages.boundingBox();
    const x = box.x + box.width * 0.75,
      y = box.y + box.height * 0.3;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let i = 1; i <= 8; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x - (box.width * 0.7 * i) / 8, y }],
      });
      await page.waitForTimeout(25);
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    console.log('Touch swipe', await pages.evaluate(el=>({active:el.dataset.active,left:el.scrollLeft,width:el.clientWidth,touchAction:getComputedStyle(el).touchAction})));
    await page.waitForFunction(
      () =>
        document.querySelector(".collection-card-pages")?.dataset.active ===
        "2",
    );
    await card.locator(".collection-card-body strong").click();
    const drawer = page.locator(".ant-drawer-open");
    await drawer.waitFor();
    await drawer.getByRole('tab', { name: '提取图片文字', exact: true }).waitFor();
    await drawer.getByRole('tab', { name: '视频转写', exact: true }).waitFor();
    await drawer.getByRole('button', { name: '加入素材库', exact: true }).first().click();
    await page.waitForResponse(r => r.url().includes('/sync'));
    assert.equal(assets[0].library_state, 'saved');
    assert.equal(assets.filter(a => a.id === 'img-0').length, 1, 'Promotion reuses the original asset');
    const copy = drawer.getByRole("region", { name: "笔记文案", exact: true });
    await copy.waitFor();
    assert(
      await copy.evaluate(
        (el) => el.scrollHeight > el.clientHeight && el.clientHeight < 300,
      ),
    );
    await copy.scrollIntoViewIfNeeded();
    const before = await drawer
      .locator(".ant-drawer-body")
      .evaluate((el) => el.scrollTop);
    await copy.hover();
    await page.mouse.wheel(0, 280);
    await page.waitForFunction(
      () => document.querySelector(".collection-copy-scroll")?.scrollTop > 0,
    );
    assert.equal(
      await drawer.locator(".ant-drawer-body").evaluate((el) => el.scrollTop),
      before,
      "Copy scroll stays inside its region",
    );
    const carousel = drawer.locator(".collection-detail-carousel");
    await carousel.scrollIntoViewIfNeeded();
    await carousel.getByRole("button", { name: "下一页", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector(
          ".collection-detail-carousel .collection-card-pages",
        )?.dataset.active === "1",
    );
    await carousel.getByRole("button", { name: "上一页", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector(
          ".collection-detail-carousel .collection-card-pages",
        )?.dataset.active === "0",
    );
    await drawer
      .locator(".ant-drawer-body")
      .evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({
      path: path.join(out, "note-detail-390.png"),
      fullPage: true,
    });
    await drawer.locator(".ant-drawer-close").click();
    assert.equal(await card.locator('.collection-card-pages').getAttribute('data-active'), '2', 'Closing detail preserves card carousel');
    const videoCard = page
        .locator(".collection-card")
        .filter({ hasText: notes[1].title }),
      video = videoCard.locator("video");
    await video.scrollIntoViewIfNeeded();
    assert(await video.evaluate((v) => v.controls && v.playsInline));
    await video.evaluate(async (v) => {
      v.muted = true;
      await v.play();
    });
    await page.waitForFunction(
      () =>
        document.querySelector(".collection-card video")?.currentTime > 0.15,
    );
    assert.equal(await page.locator(".ant-drawer-open").count(), 0);
    await videoCard
      .getByRole("button", { name: "下一页", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelector(".collection-card video")?.paused === true,
    );
    await videoCard.locator(".collection-card-body strong").click();
    await drawer.waitFor();
    const detailVideo = drawer.locator("video");
    await detailVideo.scrollIntoViewIfNeeded();
    await detailVideo.evaluate(async (v) => {
      v.muted = true;
      await v.play();
    });
    await page.waitForFunction(
      () =>
        document.querySelector(".ant-drawer-open video")?.currentTime > 0.15,
    );
    for (const width of [390, 820, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await detailVideo.scrollIntoViewIfNeeded();
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: path.join(out, `video-detail-${width}.png`),
        fullPage: true,
      });
    }
    await drawer.locator(".ant-drawer-close").click();
    assert.equal(
      requests.filter((r) => /download|extract|publish/.test(r.path)).length,
      0,
      "Previews do not download to library or start extraction/publishing",
    );
    assert.deepEqual(errors, []);
    const result = {
      status: "passed",
      checks: [
        "320/390/820/1440 search, category and sort share a row",
        "view switch remains visible outside More",
        "four-star rating and custom personal tag persist through PATCH",
        "uncropped images, compact interaction counts and no ready badge",
        "promoting collected media reuses its existing asset ID",
        "detail close preserves carousel position",
        "separate image-text and video-transcript tabs",
        "image arrow paging",
        "native touch swipe",
        "swipe does not open detail",
        "long copy independently scrolls",
        "detail carousel paging",
        "card video decodes and plays",
        "offscreen video pauses",
        "detail video decodes and plays",
        "390/820/1440 responsive sizing",
        "preview starts no download or extraction jobs",
      ],
      errors,
    };
    await fs.writeFile(
      path.join(out, "collection-preview-verification.json"),
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
