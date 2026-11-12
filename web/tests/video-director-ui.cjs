const { chromium, browserLaunchOptions } = require("./browser.cjs");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1080 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const project = {
      id: "p-video",
      name: "视频导演流程验证",
      platform: "xhs",
      sources: [],
      created_at: "2026-10-11T04:00:00Z",
      asset_ids: [],
      kind: "video",
    };
    const model = {
      id: "vision",
      name: "脚本视觉模型",
      model: "vision-fixture",
      base_url: "https://example.com/v1",
      configured: true,
      vision: true,
    };
    const videoModel = {
      ...model,
      id: "video",
      name: "视频模型",
      model: "doubao-seedance-2-5-260628",
      continuous_min: 4,
      continuous_max: 30,
    };
    const original = {
      title: "咖啡日常",
      body: "磨豆、注水，享受慢生活。",
      topics: [],
    };
    const copy = original.title + "\n" + original.body;
    const assets = [
      { id: "ref-img", name: "参考画面", kind: "image", status: "ready" },
      {
        id: "ref-video",
        name: "参考视频",
        kind: "video",
        status: "ready",
        duration: 5,
      },
    ];
    const scripts = [];
    const jobs = [];
    let planInput;
    let videoCalls = 0;
    let confirmCalls = 0;
    let composeCalls = 0;
    const versions = [
      {
        ...original,
        id: "v1",
        project_id: project.id,
        number: 1,
        status: "draft",
        media: { kind: "video", asset_ids: [], cover_id: "" },
        created_at: project.created_at,
      },
    ];
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+c1uoAAAAASUVORK5CYII=",
      "base64",
    );
    await page.route("http://workbench.test/**", async (route) => {
      const req = route.request(),
        u = new URL(req.url()),
        p = u.pathname;
      if (p.startsWith("/api/v1")) {
        const e = p.slice(7);
        let body = [];
        let status = 200;
        if (e === "/session") body = { csrf_token: "fixture" };
        else if (e === "/sync")
          body = {
            reset: true,
            more: false,
            epoch: "fixture",
            cursor: 1,
            changes: Object.entries({
              jobs,
              assets,
              projects: [project],
              publications: [],
            }).flatMap(([entity, values]) =>
              values.map((value) => ({ entity, id: value.id, value })),
            ),
          };
        else if (e === "/rewrite-models") body = [model];
        else if (e === "/video-models")
          body = [
            videoModel,
            { ...videoModel, id: "video-second", name: "备用视频模型" },
          ];
        else if (e === "/rewrites") body = [project];
        else if (e === "/jobs") body = jobs;
        else if (e === "/assets") body = assets;
        else if (e.startsWith("/assets/") && e.endsWith("/file"))
          return route.fulfill({ body: png, contentType: "image/png" });
        else if (e === "/rewrites/" + project.id && req.method() === "PATCH") {
          Object.assign(project, req.postDataJSON());
          body = project;
        } else if (e === "/rewrites/" + project.id)
          body = {
            project,
            versions,
            reference_assets: [assets[0]],
            reference_videos: [assets[1]],
          };
        else if (e.endsWith("/video/scripts") && req.method() === "GET")
          body = scripts;
        else if (e.endsWith("/video/plan")) {
          planInput = req.postDataJSON();
          scripts.unshift({
            id: "plan1",
            project_id: project.id,
            title: "完整咖啡脚本",
            concept: "开场磨豆，中段注水，结尾品尝",
            style: "统一白杯，暖色自然光",
            brief: planInput,
            shots: [
              {
                duration: planInput.duration,
                visual: "0-6秒磨豆；6-17秒接着注水；17-23秒品尝",
                camera: "近景跟随手部动作，最后自然拉远",
                narration: "磨豆、注水，享受慢生活",
              },
            ],
            model: model.model,
            created_at: project.created_at,
          });
          jobs.unshift({
            id: "plan1",
            kind: "video_plan",
            target: project.id,
            state: "succeeded",
            stage: "完成",
            result: "plan1",
            updated_at: new Date().toISOString(),
          });
          scripts.push({
            ...scripts[0],
            id: "older",
            title: "历史脚本",
            created_at: "2026-10-10T04:00:00Z",
          });
          body = { job_id: "plan1" };
          status = 202;
        } else if (e.endsWith("/confirm")) {
          confirmCalls++;
          scripts[0].confirmed_at = new Date().toISOString();
          body = scripts[0];
        } else if (e.endsWith("/video/generate")) {
          videoCalls++;
          assets.push({
            id: "shot-1",
            name: "生成视频",
            kind: "video",
            status: "ready",
          });
          assert.equal(req.postDataJSON().script_id, "plan1");
          assert.equal(req.postDataJSON().model_id, "video-second");
          jobs.unshift({
            id: "generation",
            kind: "video_generate",
            target: project.id,
            state: "succeeded",
            stage: "完整视频已生成",
            created_at: project.created_at,
            updated_at: new Date().toISOString(),
            payload: {
              model_name: videoModel.name,
              production: {
                script_id: "plan1",
                audio: true,
                shots: [1].map((n) => ({
                  remote_id: "cgt-" + n,
                  state: "succeeded",
                  asset_id: "shot-" + n,
                })),
              },
            },
          });
          body = { job_id: "generation" };
          status = 202;
        } else if (e.endsWith("/compose")) {
          composeCalls++;
          assets.push(
            { id: "final", name: "成片", kind: "video", status: "ready" },
            { id: "cover", name: "封面", kind: "image", status: "ready" },
          );
          jobs.unshift({
            id: "compose",
            kind: "video_compose",
            target: project.id,
            state: "succeeded",
            result: "final",
            updated_at: new Date().toISOString(),
            payload: {
              generation_id: "generation",
              cover_id: "cover",
              asset_id: "final",
            },
          });
          body = { job_id: "compose" };
          status = 202;
        } else if (e === "/settings")
          body = {
            services: { ocr: {}, asr: {} },
            dependencies: {},
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
    await page.addInitScript(() => {
      localStorage.setItem(
        "gin.draft.p-video.video",
        JSON.stringify({
          content: { title: "", body: "", topics: [] },
          versionID: "",
          sourceIDs: [],
          media: { kind: "video", asset_ids: [], cover_id: "" },
        }),
      );
    });
    await page.goto("http://workbench.test/#xhs/rewrites");
    await page
      .getByRole("textbox", { name: "创作标题", exact: true })
      .waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="创作标题"]')?.value === "咖啡日常",
    );
    assert.equal(
      await page
        .getByRole("textbox", { name: "创作正文", exact: true })
        .inputValue(),
      original.body,
      "empty media draft must not mask existing generated text",
    );
    await page
      .getByRole("combobox", { name: "本次文案模型", exact: true })
      .waitFor();
    await page
      .getByRole("combobox", { name: "本次视频模型", exact: true })
      .locator("../..")
      .click();
    await page
      .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
      .getByText("备用视频模型 · doubao-seedance-2-5-260628", { exact: true })
      .click();
    await page.locator("details.reference-panel > summary").click();
    const imageReference = page.getByRole("checkbox", {
      name: "来源图片 1",
      exact: true,
    });
    await imageReference.check();
    await page
      .getByRole("checkbox", { name: "参考视频 参考视频", exact: true })
      .check();
    await page.getByRole("tab", { name: "视频仿写", exact: true }).click();
    assert.equal(
      await page.getByRole("button", { name: "移除参考", exact: true }).count(),
      2,
      "editor selection must enter the director without selecting twice",
    );
    await page
      .getByRole("button", { name: "移除参考", exact: true })
      .first()
      .click();
    assert.equal(
      await page
        .getByRole("checkbox", { name: "来源图片 1", exact: true })
        .isChecked(),
      false,
      "director removal must update the editor",
    );
    const generate = page.getByRole("button", {
      name: "根据确认脚本生成完整视频",
      exact: true,
    });
    assert.equal(await generate.isDisabled(), true);
    const seconds = page.getByRole("spinbutton", { name: "视频总时长" });
    await seconds.fill("23");
    await page
      .getByRole("button", { name: "从素材库选择", exact: true })
      .click();
    const referencePicker = page.getByRole("dialog", {
      name: "从素材库选择参考图片和视频",
    });
    await referencePicker.getByRole("checkbox").first().check();
    await referencePicker.getByRole("checkbox").nth(1).check();
    await referencePicker
      .getByRole("button", { name: "确定参考素材", exact: true })
      .click();
    await page
      .getByRole("button", { name: "生成完整脚本", exact: true })
      .click();
    await page
      .getByRole("button", { name: "确认完整脚本", exact: true })
      .waitFor();
    assert.equal(videoCalls, 0);
    assert.equal(planInput.copy_text, copy);
    assert.equal(planInput.duration, 23);
    assert.equal(planInput.mode, "continuous");
    await page.getByText("完整视频时间线 · 23 秒", { exact: true }).waitFor();
    assert.equal(planInput.reference_asset_ids.length, 2);
    assert.equal(await generate.isDisabled(), true);
    const title = page.getByLabel("作品标题", { exact: true });
    await title.fill("未保存的脚本修改");
    const switchScript = async (name) => {
      await page
        .getByRole("combobox", { name: "视频脚本版本" })
        .locator("../..")
        .click();
      await page
        .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
        .getByText(name, { exact: false })
        .click();
    };
    await switchScript("历史脚本");
    await page.getByRole("button", { name: "返回保存", exact: true }).click();
    assert.equal(await title.inputValue(), "未保存的脚本修改");
    await page
      .getByRole("button", { name: "生成完整脚本", exact: true })
      .click();
    await page.getByRole("button", { name: "返回保存", exact: true }).click();
    assert.equal(await title.inputValue(), "未保存的脚本修改");
    await switchScript("历史脚本");
    await page
      .getByRole("button", { name: "放弃修改并继续", exact: true })
      .click();
    assert.equal(await title.inputValue(), "历史脚本");
    await switchScript("完整咖啡脚本");
    await page
      .getByRole("button", { name: "确认完整脚本", exact: true })
      .click();
    await page.getByText("脚本已确认", { exact: true }).waitFor();
    await generate.click();
    assert.equal(
      await page.getByRole("button", { name: /预览满意/ }).count(),
      0,
    );
    const selectionSaved = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith("/rewrites/" + project.id) &&
        response.request().postDataJSON().asset_ids?.includes("shot-1"),
    );
    await page
      .getByRole("button", { name: "加入发布素材", exact: true })
      .last()
      .click();
    await selectionSaved;
    assert.equal(videoCalls, 1);
    assert.equal(confirmCalls, 1);
    assert.equal(composeCalls, 0);
    assert.deepEqual(project.asset_ids, ["shot-1"]);
    assert.equal(
      project.cover_id,
      "",
      "XHS online publishing must use platform default cover",
    );
    await page.screenshot({
      path: path.join(__dirname, "../../data/tmp/video-director-smoke.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: shared editor model/reference selection -> continuous script -> explicit confirmation -> single video -> direct whole-version media (no composition) (mock services).",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
