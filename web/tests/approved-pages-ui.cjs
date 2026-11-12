const { chromium, browserLaunchOptions } = require("./browser.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const out = path.resolve(__dirname, "../../../../../outputs/示例图结构验证-20261027-v23/全部页面");
const now = "2026-10-26T01:00:00Z";
const note = {
  id: "n",
  note_id: "n",
  revision_id: "r",
  platform: "xhs",
  kind: "image",
  title: "把周末过成喜欢的样子",
  body: "走出家门，给生活留一点空白。",
  author: "生活手记",
  tags: ["高赞"],
  topics: ["周末日常"],
  rating: 3,
  likes: 1000,
  favorites: 350,
  comments: 28,
  created_at: now,
  updated_at: now,
};
const project = {
  id: "p",
  name: "周末生活创作",
  note_id: "n",
  revision_id: "r",
  platform: "xhs",
  kind: "image",
  sources: [],
  asset_ids: [],
  created_at: now,
};
const assets = ["a1", "a2", "a3"].map((id, i) => ({
  id,
  name: `图片${i + 1}`,
  kind: "image",
  source: i === 2 ? "generated" : "collection",
  library_state: i === 2 ? "result" : "collected",
  project_id: i === 2 ? "p" : undefined,
  revision_id: i === 2 ? undefined : "r",
  status: "ready",
  width: 600,
  height: 800,
  position: i,
  size: 200,
  duration: 0,
  created_at: now,
}));
const body = Array.from(
  { length: 12 },
  (_, i) =>
    `第${i + 1}个周末小片段：在街角喝一杯咖啡，沿着熟悉的路散步，发现日常也有新的风景。`,
).join("\n\n");
const workflow = {
  id: "p",
  title: { key: "", text: "", angle: "", generation_id: "", confirmed_at: "" },
  copy: {
    key: "",
    title_key: "",
    body: "",
    topics: [],
    generation_id: "",
    confirmed_at: "",
  },
  image_plan_id: "",
  drafts: {},
};
const data = {
  workflow,
  reference: {
    id: "r",
    title: note.title,
    body: note.body,
    topics: note.topics,
  },
  angles: [
    {
      id: "ag",
      model: "角度模型",
      created_at: now,
      notices: [],
      angles: [
        { name: "城市散步", description: "从周末沿途发现的小事切入" },
        { name: "低成本放松", description: "分享普通周末的轻松安排" },
        { name: "留一点空白", description: "从暂停忙碌的片刻展开" },
      ],
    },
  ],
  titles: [
    {
      id: "tg",
      titles: [
        "周末，给生活留一点空白",
        "在熟悉的城市发现新风景",
        "我的低成本周末安排",
      ],
      model: "标题模型",
      created_at: now,
    },
  ],
  copies: [
    {
      id: "cg",
      title_key: "t1",
      copies: [
        { body, topics: ["周末日常"] },
        { body: "一杯咖啡，一段散步，把周末还给自己。", topics: ["生活记录"] },
        { body: "不用安排得很满，在熟悉的街道也能发现新的风景。", topics: [] },
      ],
      model: "文案模型",
      created_at: now,
    },
  ],
  image_plans: [],
};
const calls = [];
const errors = [];
const jobs = [];
const scripts = [];
async function routeApp(route) {
  const req = route.request(),
    u = new URL(req.url()),
    p = u.pathname;
  if (p.startsWith("/api/v1")) {
    const e = p.slice(7);
    let value = [];
    if (e === "/auth/me")
      value = {
        user: {
          id: "user",
          username: "user",
          display_name: "创作用户",
          role: "creator",
          status: "active",
        },
      };
    else if (e === "/session") value = { csrf_token: "test" };
    else if (e === "/sync")
      value = {
        reset: true,
        more: false,
        epoch: "ui",
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
    else if (e === "/assets" && req.method() === "POST") {
      value = {
        ...assets[0],
        id: "local",
        name: "本地图片",
        source: "upload",
        library_state: "saved",
        revision_id: undefined,
      };
      assets.push(value);
      calls.push({ e, upload: true });
    } else if (e === "/rewrites/p/video/plan") {
      const brief = { ...req.postDataJSON(), copy_key: workflow.copy.key };
      scripts.push({
        id: "vs1",
        project_id: "p",
        model: "fixture",
        title: workflow.title.text,
        concept: "周末散步的完整故事",
        style: "自然生活记录",
        brief,
        shots: [
          {
            duration: 30,
            visual: "0–15秒沿街散步，15–30秒在窗边喝咖啡",
            camera: "平稳跟随",
            narration: "",
          },
        ],
        created_at: now,
      });
      jobs.push({
        id: "vs1",
        kind: "video_plan",
        target: "p",
        state: "succeeded",
        stage: "脚本已完成",
        result: "vs1",
        created_at: now,
        updated_at: now,
      });
      value = { job_id: "vs1" };
    } else if (e === "/rewrites/p/video/scripts") value = scripts;
    else if (e === "/rewrites/p/video/scripts/vs1/confirm") {
      scripts[0].confirmed_at = now;
      value = scripts[0];
    } else if (e === "/collections")
      value = { items: [note], total: 1, tags: ["高赞", "高粉", "优质文案"] };
    else if (e === "/collections/n" && req.method() === "PATCH") {
      Object.assign(note, req.postDataJSON());
      calls.push({ e, body: req.postDataJSON() });
      value = note;
    } else if (e === "/collections/n")
      value = {
        note,
        revision: {
          id: "r",
          title: note.title,
          body: note.body,
          topics: note.topics,
        },
        assets: assets.slice(0, 2),
        history: [],
        extractions: [],
        jobs: [],
      };
    else if (e === "/rewrites/p/workflow") value = data;
    else if (e === "/rewrites/p")
      value = {
        project,
        versions: [],
        reference_assets: assets.slice(0, 2),
        reference_videos: [],
      };
    else if (e === "/prompt-presets")
      value = ["angle", "title", "copy"].flatMap((scope) => [
        {
          id: scope + "-natural",
          scope,
          name: "自然分享",
          description: "从真实生活细节展开",
          is_default: true,
          revision: 1,
        },
        {
          id: scope + "-clear",
          scope,
          name: "清晰实用",
          description: "围绕重点直接表达",
          is_default: false,
          revision: 1,
        },
      ]);
    else if (e.endsWith("-models"))
      value = [
        {
          id: "m",
          name: "默认创作模型",
          model: "fixture",
          configured: true,
          vision: true,
          continuous_min: 2,
          continuous_max: 30,
        },
      ];
    else if (e.startsWith("/rewrites/p/workflow/drafts/")) {
      const scope = e.split("/").at(-1),
        b = req.postDataJSON();
      value = { ...b, revision: b.revision + 1, saved_at: now };
      workflow.drafts[scope] = value;
      calls.push({ e, body: b });
    } else if (e === "/rewrites/p/titles/confirm") {
      const b = req.postDataJSON();
      Object.assign(workflow.title, {
        text: b.text,
        angle: b.angle,
        key: "t1",
        confirmed_at: now,
      });
      value = workflow.title;
      calls.push({ e, body: b });
    } else if (e === "/rewrites/p/copies/confirm") {
      const b = req.postDataJSON();
      Object.assign(workflow.copy, {
        body: b.body,
        topics: b.topics,
        key: "c1",
        title_key: b.title_key,
        confirmed_at: now,
      });
      value = workflow.copy;
      calls.push({ e, body: b });
    } else if (
      e.endsWith("/titles/generate") ||
      e.endsWith("/copies/generate")
    ) {
      calls.push({ e, body: req.postDataJSON() });
      value = { job_id: "test-job" };
    } else if (e === "/settings") value = { services: {}, dependencies: {} };
    else if (e.endsWith("/file") || e.endsWith("/preview"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#b5bda6"/><circle cx="400" cy="240" r="140" fill="#e2d9b5"/><path d="M0 720L260 400L600 650V800H0" fill="#6c8067"/></svg>',
      });
    else if (req.method() !== "GET") throw Error("Unexpected mutation " + e);
    return route.fulfill({ json: value });
  }
  const name = p === "/" ? "index.html" : p.slice(1);
  if (name.includes("..")) return route.abort();
  return route.fulfill({
    body: await fs.readFile(path.resolve(__dirname, "../dist", name)),
    contentType: name.endsWith(".js")
      ? "text/javascript"
      : name.endsWith(".css")
        ? "text/css"
        : name.endsWith(".svg")
          ? "image/svg+xml"
          : "text/html",
  });
}

const demoUser={id:'creator',username:'creator',display_name:'创作用户',role:'creator',status:'active',created_at:now};
const usageRows=[{id:'u1',user_id:'creator',user:'创作用户',at:now,kind:'title_rewrite',feature:'标题仿写',model:'默认创作模型',input:1600,output:300,total:1900,cost:0.04,state:'succeeded',stateLabel:'成功',jobID:'job1'}];
const taskRows=[{user_id:'creator',user:'创作用户',job:{id:'j1',kind:'title_rewrite',target:'p',state:'succeeded',stage:'完成',created_at:now,updated_at:now}}];
const services={text:{configured:true,model:'text'},ocr:{configured:true,base_url:'https://example.test/v1',model:'ocr'},asr:{configured:true,base_url:'wss://example.test/asr',model:'asr'}};
let role='creator';
async function routeAll(route){
 const e=new URL(route.request().url()).pathname.replace('/api/v1','');
 if(e==='/auth/me')return route.fulfill(role==='login'?{status:401,json:{error:'请登录'}}:{json:{user:{...demoUser,role,display_name:role==='admin'?'管理员':'创作用户'}}});
 if(e==='/usage')return route.fulfill({json:{usage:usageRows,price_per_1k:0.02}});
 if(e==='/settings')return route.fulfill({json:{services,dependencies:{}}});
 if(e==='/admin/overview')return route.fulfill({json:{users:[demoUser],usage:usageRows,tasks:taskRows,summary:{active_users:1,calls:1,tokens:1900,cost:0.04,active_tasks:0,failed_tasks:0},price_per_1k:0.02}});
 if(e==='/admin/users')return route.fulfill({json:[demoUser]});
 if(e==='/admin/audit')return route.fulfill({json:[{id:1,at:now,actor:'管理员',action:'更新模型',detail:'标题仿写模型'}]});
 if(e==='/admin/settings')return route.fulfill({json:{services,dependencies:{}}});
 if(e==='/admin/prompt-presets')return route.fulfill({json:['angle','title','copy'].map(scope=>({id:scope,scope,name:'自然分享',description:'保留原帖的真实细节，自然表达。',prompt:'围绕参考帖子的真实信息进行创作。',enabled:true,is_default:true,revision:1,updated_at:now}))});
 if(e.startsWith('/admin/models/'))return route.fulfill({json:[{id:'m',name:'默认创作模型',model:'model-id',base_url:'https://example.test/v1',configured:true,vision:true}]});
 return routeApp(route);
}
(async()=>{
 await fs.mkdir(out,{recursive:true});const browser=await chromium.launch(browserLaunchOptions);
 const page=await browser.newPage({viewport:{width:1440,height:1000}}); page.setDefaultTimeout(15000); const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message)); await page.route('http://experience.test/**',routeAll);
 const results=[];
 async function capture(name){
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width<700?844:1000});await page.waitForTimeout(220);
   const geometry=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth}));assert.ok(geometry.document<=width+1,name+' overflow '+JSON.stringify(geometry));
   if(name==='笔记详情') {
     const clipping=await page.locator('.collection-detail-carousel').evaluate(el=>{
       const asset=el.querySelector('.detail-asset');const img=asset.querySelector('img');
       return {bottom:el.getBoundingClientRect().bottom,assetBottom:asset.getBoundingClientRect().bottom,fit:getComputedStyle(img).objectFit};
     });
     assert.ok(clipping.assetBottom<=clipping.bottom+1, 'Detail media and actions clipped: '+JSON.stringify(clipping));assert.equal(clipping.fit,'contain');
   }
   await page.screenshot({path:path.join(out,name+'-'+width+'.png'),fullPage:true,animations:'disabled'});results.push({page:name,width});
  }
 }
 try{
  role='login';await page.goto('http://experience.test/#login');await page.locator('.user-login').waitFor();await capture('用户登录');
  await page.goto('http://experience.test/#/admin/login');await page.locator('.admin-login').waitFor();await capture('管理员登录');
  role='creator';
  for(const [hash,name,ready] of [['collections','采集库','.collection-card'],['media','素材库','.media-page-intro'],['publications','发布管理','.publication-main'],['usage','用户计费','.usage-dashboard']]){
   await page.goto('http://experience.test/?page='+hash+'#'+hash);await page.locator('.rednote-shell').waitFor(); await page.waitForTimeout(800);await capture(name);
   if(hash==='collections'){
    await page.getByTitle('列表视图',{exact:true}).click();await page.locator('.responsive-record-table').waitFor();await capture('采集库列表');
    await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('.responsive-record-table .ant-table-tbody>tr.ant-table-row').evaluate(e=>getComputedStyle(e).display),'grid');
    await page.getByRole('button',{name:'查看笔记 '+note.title,exact:true}).click();await page.getByRole('tab',{name:'原文与媒体'}).waitFor();await capture('笔记详情');await page.locator('.inline-detail-header').getByRole('button',{name:'返回采集库',exact:true}).click();
   }
  }
  role='admin';
  for(const [hash,name] of [['overview','管理总览'],['users','用户管理'],['models','模型配置'],['prompts','创作提示词'],['usage','后台计费']]){
   await page.goto('http://experience.test/?admin='+hash+'#/admin/'+hash);await page.locator('.admin-content').waitFor();await page.waitForTimeout(600);await capture(name);
   if(hash==='models'){
    for(const tab of ['标题仿写','图片生成','视频脚本','音频转写']){await page.locator('.admin-capability-tabs').getByText(tab,{exact:true}).click();assert.equal(await page.locator('.admin-model-group').count(),1);}
    await page.getByRole('button',{name:/配置\s*ASR\s*模型/}).click();await page.getByRole('dialog').waitFor();await capture('音频模型配置');await page.getByRole('button',{name:/取\s*消/}).click();
   }
   if(hash==='prompts'){await page.getByRole('button',{name:'新增方案'}).click();await page.getByRole('dialog').waitFor();await capture('编辑提示词');await page.getByRole('button',{name:/取\s*消/}).click();}
  }
  assert.deepEqual(pageErrors,[]);await fs.writeFile(path.join(out,'验证结果.json'),JSON.stringify({status:'PASS',captures:results,errors:pageErrors},null,2));console.log(JSON.stringify({status:'PASS',screenshots:results.length,errors:pageErrors}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
