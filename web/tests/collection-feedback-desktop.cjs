const {
  chromium,
  fs,
  path,
  assert,
  routeAPI,
  jobs,
  assets,
  stamp,
} = require("./direct-media-fixture.cjs");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    const errors = [];
    page.on(
      "pageerror",
      (e) => (errors.push(e.message), console.error(e.message)),
    );
    let serial = 0;
    const note = {
      id: "feedback-note",
      note_id: "feedback-note",
      revision_id: "r-media",
      title: "反馈验证笔记",
      body: "测试参考文案",
      topics: [],
      tags: [],
      author: "测试",
      platform: "xhs",
      kind: "image",
      created_at: stamp,
      updated_at: stamp,
    };
    await page.route("**/api/v1/**", async (route) => {
      const req = route.request(),
        p = new URL(req.url()).pathname.slice(7);
      if (p === "/collections" && req.method() === "GET")
        return route.fulfill({ json: { items: [note], total: 1, tags: [] } });
      if (p === "/collections/feedback-note")
        return route.fulfill({
          json: {
            note,
            revision: {
              id: note.revision_id,
              title: note.title,
              body: note.body,
              topics: [],
            },
            assets: assets.filter((a) =>
              ["source-1", "source-video"].includes(a.id),
            ),
            history: [],
            extractions: [],
            jobs,
          },
        });
      if (p.endsWith("/extract")) {
        const id = "extract-" + ++serial,
          target = p.split("/")[2];
        jobs.push({
          id,
          kind: target === "source-1" ? "ocr" : "asr",
          target,
          state: "queued",
          stage: "排队中",
          created_at: stamp,
          updated_at: stamp,
          attempts: 0,
        });
        return route.fulfill({ json: { job_id: id } });
      }
      if (p === "/collections" && req.method() === "POST") {
        jobs.push({
          id: "collect-feedback",
          kind: "collect",
          target: "url",
          state: "running",
          stage: "正在读取笔记",
          created_at: stamp,
          updated_at: stamp,
        });
        return route.fulfill({
          json: {
            items: [
              { job_id: "collect-feedback", url: "https://example.test/note" },
            ],
          },
        });
      }
      return routeAPI(route);
    });
    await page.goto("http://127.0.0.1:8081/#collections");
    await page.locator(".collection-card").first().press("Enter");
    const modal = page.locator(".collection-note-modal");
    await modal.waitFor();
    await modal.getByRole("button", { name: /提取文字/ }).click();
    await page.getByText("文字提取处理中…", { exact: true }).waitFor();
    jobs.find((j) => j.id === "extract-1").state = "succeeded";
    await page.getByText("文字提取成功，请查看结果", { exact: true }).waitFor();
    await modal.getByRole("button", { name: "下一页" }).click();
    await modal.getByRole("button", { name: /转写音频/ }).click();
    jobs.find((j) => j.id === "extract-2").state = "failed";
    jobs.find((j) => j.id === "extract-2").error = "转写服务未配置";
    await page
      .getByText("音频转写未完成：转写服务未配置", { exact: true })
      .waitFor();
    await modal.locator(".ant-modal-close").click();
    await page
      .locator("textarea:visible")
      .first()
      .fill("https://www.xiaohongshu.com/explore/feedback");
    await page.getByRole("button", { name: /开始采集/ }).click();
    await page.getByRole("dialog", { name: "本次采集进度" }).waitFor();
    await page.getByText("正在读取笔记", { exact: true }).waitFor();
    const out = path.resolve(
      __dirname,
      "../../data/verification/reference-input",
    );
    await fs.mkdir(out, { recursive: true });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(out, "collection-feedback.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "OCR completion, ASR failure, and collection progress dialog passed.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
