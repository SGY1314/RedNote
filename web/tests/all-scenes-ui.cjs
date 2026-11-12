const { chromium, browserLaunchOptions } = require("./browser.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const out = path.resolve(__dirname, "../../../../../outputs/全部界面验收-20261027-v24/24个场景");
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
  account_profile: {status: "skipped", revision: 1},
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
          publications,
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
        versions: [{id:"v2",number:2,name:"完整发布稿",title:"周末，给生活留一点空白",body,topics:["周末日常"],project_id:"p",created_at:now,status:"confirmed",source_ids:[]}],
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
 if(e==='/miniapp/cloud')return route.fulfill({json:{available:true}});
 if(e.endsWith('/mobile-handoff')) {
  if(route.request().method()==='POST') { mobileSession={id:'handoff',state:'created',expires_at:new Date(Date.now()+120000).toISOString()};return route.fulfill({json:{...mobileSession,ticket:'a'.repeat(32),miniapp_scheme_url:'xhsdiscover://miniapp/123456789012345678901234_trial/pages/publish/index?scene='+'a'.repeat(32)}}); }
  return route.fulfill(mobileSession?{json:mobileSession}:{status:404,json:{error:'尚未创建手机交接'}});
 }

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

const publications=[{id:'pub1',project_id:'p',version_id:'v2',title:'周末，给生活留一点空白',body,topics:['周末日常'],kind:'image',asset_ids:['a1','a2'],ready:true,exported_at:[],target_platform:'xhs',created_at:now}];
let mobileSession;
jobs.push(...['running','succeeded','blocked'].map((state,i)=>({id:'job'+i,kind:['title_rewrite','image_generation','asr'][i],state,target:'p',stage:['正在生成标题','图片已生成','等待配置服务'][i],created_at:now,updated_at:now})));
(async()=>{
 await fs.mkdir(out,{recursive:true});const browser=await chromium.launch(browserLaunchOptions);const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://experience.test/**',routeAll);const captures=[];
 async function go(hash){await page.goto('https://experience.test/?scene='+hash+'#'+hash);await page.waitForTimeout(500);}
 async function capture(id,name){for(const width of [1440,390,320]){await page.setViewportSize({width,height:width<700?844:1000});await page.waitForTimeout(200);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' overflow '+width);await page.screenshot({path:path.join(out,id+'-'+name+'-'+width+'.png'),fullPage:true,animations:'disabled'});captures.push({id,name,width});}}
 try {
  role='login';await go('login');await page.locator('.user-login').waitFor();await capture('01','用户登录');
  role='creator';await go('collections');await page.locator('.collection-card').waitFor();await capture('02','采集库卡片');
  await page.getByTitle('列表视图',{exact:true}).click();await capture('03','采集库列表');
  await page.getByRole('button',{name:'查看笔记 '+note.title,exact:true}).click();await page.locator('.inline-detail-page').waitFor();await capture('04','笔记详情');
  await page.getByRole('button',{name:'仿写库',exact:true}).click();await page.locator('.project-card').waitFor();await capture('05','仿写项目列表');
  await page.locator('.project-title-button').click();await page.locator('.creation-workflow').waitFor();await page.locator('.workflow-candidates article').first().waitFor();await capture('06','标题仿写含发帖角度');
  await page.locator('.workflow-candidates article').first().getByRole('button').click();await page.locator('.workflow-mobile-dock').getByRole('button',{name:'确认标题并继续'}).click();await page.getByRole('textbox',{name:'最终文案',exact:true}).waitFor();await capture('07','文案仿写');
  await page.locator('.workflow-candidates article').first().getByRole('button').click();await page.locator('.workflow-mobile-dock').getByRole('button',{name:'确认文案并继续'}).click();await page.getByRole('heading',{name:/图片仿写/}).waitFor();await page.getByRole('checkbox',{name:'图片生成结果选择第1项',exact:true}).check();await capture('08','图片仿写');
  await page.locator('.workflow-steps').getByRole('button',{name:/视频仿写/}).click();await page.getByText('生成完整脚本',{exact:true}).first().waitFor();await capture('09','视频仿写');
  await page.locator('.workflow-steps').getByRole('button',{name:/发布稿/}).click();await page.locator('.workflow-release-grid').waitFor();assert.equal(await page.locator('.workflow-release-grid .publication-preview-slide').count(),1);await capture('10','整理发布稿与版本');
  await page.getByRole('button',{name:'素材库',exact:true}).click();await page.locator('.media-page-intro').waitFor();await capture('11','素材库');
  await page.getByRole('button',{name:'发布管理',exact:true}).click();await page.getByText(publications[0].title,{exact:true}).first().waitFor();await capture('12','发布管理');
  await page.getByText(publications[0].title,{exact:true}).first().click();await page.locator('.publication-detail-page').waitFor();await capture('13','发布稿详情');
  await page.getByRole('button',{name:'手机扫码发布',exact:true}).click();await page.getByRole('dialog',{name:'手机扫码发布'}).waitFor();await page.getByRole('button',{name:'生成二维码',exact:true}).click();await page.locator('.mobile-publish-qr').waitFor();assert.equal(await page.locator('.mobile-handoff-steps [aria-current="step"]').count(),1);await capture('14','手机发布面板');await page.getByRole('button',{name:/^关\s*闭$/}).click();
  await go('usage');await page.locator('.usage-dashboard').waitFor();await capture('15','用户计费面板');
  await go('settings');await page.locator('.settings-page').waitFor();await capture('16','工作区设置');
  await go('tasks');await page.getByRole('dialog',{name:'后台任务列表',exact:true}).waitFor();await capture('17','用户后台任务');
  role='login';await go('/admin/login');await page.locator('.admin-login').waitFor();await capture('18','管理端登录');
  role='admin';for(const [id,hash,name] of [['19','overview','管理总览'],['20','users','用户管理'],['21','models','模型配置'],['22','prompts','创作提示词管理'],['24','usage','后台用量与计费']]){
   await go('/admin/'+hash);await page.locator('.admin-content').waitFor();await page.waitForTimeout(250);await capture(id,name);
   if(hash==='overview'){assert.equal(await page.locator('.admin-quick-navigation button').count(),4);assert.equal(await page.locator('.admin-recent-tasks,.admin-todo').count(),0);assert.equal(await page.locator('.admin-nav-item').count(),5);}
   if(hash==='prompts'){await page.getByRole('button',{name:'新增方案'}).click();await page.getByRole('dialog').waitFor();await capture('23','编辑创作提示词方案');await page.getByRole('button',{name:/取\s*消/}).click();}
  }
  assert.equal(new Set(captures.map(c=>c.id)).size,24);assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'全部场景验证.json'),JSON.stringify({status:'PASS',scene_count:24,screenshots:captures.length,captures,errors,note:'测试数据截图，验证布局与操作入口，不代表实际发布或生成。'},null,2));
  const items=[...captures].sort((a,b)=>a.id.localeCompare(b.id)||b.width-a.width);await fs.writeFile(path.join(out,'实际界面预览.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>24个场景实际界面</title><style>body{font:16px system-ui;background:#faf9f5;margin:28px;color:#30322b}nav{display:flex;gap:12px;flex-wrap:wrap}article{margin:32px 0}img{max-width:100%;border:1px solid #e0ddd4;border-radius:12px}a{color:#a94f35}</style><h1>实际界面 · 24个场景</h1><p>使用测试数据，含电脑、390和320像素手机布局。</p><nav>'+items.filter(i=>i.width===1440).map(i=>'<a href="#scene'+i.id+'">'+i.id+' '+i.name+'</a>').join('')+'</nav>'+items.map(i=>'<article id="scene'+i.id+'-'+i.width+'"><h2 id="'+(i.width===1440?'scene'+i.id:'phone'+i.id+'-'+i.width)+'">'+i.id+' '+i.name+' · '+i.width+'px</h2><img loading="lazy" src="'+i.id+'-'+i.name+'-'+i.width+'.png"></article>').join('')+'</html>');console.log(JSON.stringify({status:'PASS',scenes:24,screenshots:captures.length,errors}));
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
