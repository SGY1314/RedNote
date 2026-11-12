const {chromium,assert,fs,path}=require('./direct-media-fixture.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
  const page=await browser.newPage({viewport:{width:1123,height:884}}),errors=[],writes=[],tests=[];
  page.on('pageerror',e=>errors.push(e.message));
  const services={collector_url:'http://127.0.0.1:5557',text:{base_url:'https://text.example.test/v1',model:'text-model',configured:true},ocr:{base_url:'https://ocr.example.test/v1',model:'ocr-before',configured:true},asr:{base_url:'wss://asr.example.test/stream',model:'asr-before',configured:true}};
  let failLoad=true,failSave=false,failTest=false;
  await page.route('**/api/v1/**',async route=>{
   const req=route.request(),endpoint=new URL(req.url()).pathname.slice(7),method=req.method();let json=[];
   if(endpoint==='/auth/me')json={user:{id:'admin',username:'qa',display_name:'管理员',role:'admin',status:'active'}};
   else if(endpoint==='/session')json={csrf_token:'fixture'};
   else if(endpoint==='/admin/overview')json={users:[],usage:[],tasks:[],summary:{active_users:0,calls:0,tokens:0,cost:0,active_tasks:0,failed_tasks:0},price_per_1k:0};
   else if(endpoint==='/admin/settings'){
    if(method==='GET'){
     if(failLoad){failLoad=false;return route.fulfill({status:503,json:{error:'配置读取暂时失败'}});}
     json={services,dependencies:{ffmpeg:true,ffprobe:true},data_dir:'fixture/data'};
    }else if(method==='PUT'){
     const body=req.postDataJSON();writes.push(body);
     const keys=Object.keys(body).filter(k=>k!=='clear');assert.equal(keys.length,1);assert(['ocr','asr'].includes(keys[0]));
     if(failSave){failSave=false;return route.fulfill({status:400,json:{error:'模拟保存校验失败'}});}
     const kind=keys[0],old=services[kind],next=body[kind];
     assert.deepEqual(Object.keys(next).sort(),['base_url','model','secret']);
     services[kind]={base_url:next.base_url.replace(/\/+$/,''),model:next.model.trim(),configured:!body.clear.includes(kind)&&(!!next.secret||old.configured)};
     json={saved:true};
    }else throw Error('Unexpected method '+method);
   }else if(endpoint.startsWith('/admin/settings/test/')){
    assert.equal(method,'POST');tests.push(endpoint);
    if(failTest){failTest=false;return route.fulfill({status:502,json:{error:'模拟连接失败'}});}
    json={message:endpoint.endsWith('/asr')?'WebSocket 握手成功；模型识别能力需使用音频验证':'采集服务连接正常'};
   }else if(endpoint.startsWith('/admin/models/'))json=[{id:'text',name:'原文案模型',model:'text-model',base_url:'https://text.example.test/v1',configured:true}];
   else assert.equal(method,'GET','Unexpected mutation '+endpoint);
   return route.fulfill({json});
  });
  await page.goto('http://127.0.0.1:8081/#admin/models');await page.locator('.admin-model-page').waitFor();
  const select=async label=>page.locator('.admin-capability-tabs .ant-segmented-item').filter({hasText:new RegExp('^'+label+'$')}).click();
  assert.equal(await page.locator('.admin-capability-tabs .ant-segmented-item').count(),8);
  await select('图片 OCR');await page.getByText('配置读取暂时失败',{exact:true}).waitFor();await page.getByRole('button',{name:'重新加载',exact:true}).click();
  let form=page.getByRole('article',{name:'图片 OCR配置',exact:true});await form.getByLabel('模型名称',{exact:true}).waitFor();
  assert.equal(await form.getByLabel('API 密钥',{exact:true}).inputValue(),'');
  assert.equal(await form.getByLabel('API 密钥',{exact:true}).getAttribute('placeholder'),'已保存密钥，留空保持不变');
  await form.getByLabel('模型名称',{exact:true}).fill('ocr-new');
  await select('语音转写');form=page.getByRole('article',{name:'语音转写配置',exact:true});await form.getByLabel('模型名称',{exact:true}).fill('asr-draft');
  await select('通用文案');await page.getByRole('button',{name:'配置模型 原文案模型',exact:true}).waitFor();
  await select('图片 OCR');form=page.getByRole('article',{name:'图片 OCR配置',exact:true});assert.equal(await form.getByLabel('模型名称',{exact:true}).inputValue(),'ocr-new');
  await form.getByRole('button',{name:/保存配置/}).click();await page.getByText('图片 OCR配置已保存',{exact:true}).waitFor();
  assert.equal(services.ocr.model,'ocr-new');assert.equal(services.ocr.configured,true);assert.equal(services.asr.model,'asr-before');assert.equal(writes[0].ocr.secret,'');
  await select('语音转写');form=page.getByRole('article',{name:'语音转写配置',exact:true});assert.equal(await form.getByLabel('模型名称',{exact:true}).inputValue(),'asr-draft');
  failTest=true;await form.getByRole('button',{name:/保存并检测连接/}).click();await form.getByText('配置已保存；连接检测失败：模拟连接失败',{exact:true}).waitFor();
  assert.equal(services.asr.model,'asr-draft');assert.equal(services.ocr.model,'ocr-new');assert.deepEqual(tests,['/admin/settings/test/asr']);
  failSave=true;await form.getByLabel('模型名称',{exact:true}).fill('asr-unsaved');await form.getByRole('button',{name:/保存并检测连接/}).click();await form.getByText('保存失败：模拟保存校验失败',{exact:true}).waitFor();
  assert.equal(tests.length,1);assert.equal(await form.getByLabel('模型名称',{exact:true}).inputValue(),'asr-unsaved');
  await form.getByRole('button',{name:/保存并检测连接/}).click();await form.getByText(/WebSocket 握手成功/).waitFor();assert.equal(tests.length,2);
  await select('图片 OCR');form=page.getByRole('article',{name:'图片 OCR配置',exact:true});
  await form.getByRole('button',{name:'清除密钥',exact:true}).click();await page.getByRole('button',{name:/^确\s*定$/}).click();await form.getByText('待清除密钥',{exact:true}).waitFor();
  await form.getByLabel('API 密钥',{exact:true}).fill('fixture-key-not-real');await form.getByText('已配置',{exact:true}).waitFor();
  await form.getByRole('button',{name:/保存配置/}).click();
  await page.waitForFunction(()=>document.querySelector('#admin-ocr-secret')?.value==='');assert.deepEqual(writes.at(-1).clear,[]);assert.equal(services.ocr.configured,true);
  await form.getByRole('button',{name:'清除密钥',exact:true}).click();await page.getByRole('button',{name:/^确\s*定$/}).click();await form.getByRole('button',{name:/保存配置/}).click();
  await form.getByText('待配置',{exact:true}).waitFor();assert.deepEqual(writes.at(-1).clear,['ocr']);assert.equal(services.asr.configured,true);
  const writeCount=writes.length;await page.getByRole('button',{name:/服务与环境设置/}).click();
  const drawer=page.getByRole('dialog');await drawer.getByRole('tab',{name:'采集服务',exact:true}).waitFor();assert.equal(await drawer.getByRole('tab').count(),2);
  assert.equal(await drawer.getByRole('tab',{name:/图片 OCR|语音转写/}).count(),0);assert.equal(await drawer.getByRole('button',{name:/保存/}).count(),0);
  await drawer.getByRole('button',{name:/检测采集服务/}).click();await page.getByText('采集服务连接正常',{exact:true}).waitFor();assert.equal(writes.length,writeCount);
  await drawer.getByRole('tab',{name:'本地环境',exact:true}).click();await drawer.getByText('本地依赖与存储',{exact:true}).waitFor();await drawer.locator('.ant-drawer-close').click();
  const out=path.resolve(__dirname,'../../data/verification/admin-service-models-20261111');await fs.mkdir(out,{recursive:true});
  for(const width of [1123,1440,823]){
   await page.setViewportSize({width,height:884});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.screenshot({path:path.join(out,'ocr-'+width+'.png'),animations:'disabled',fullPage:true});
  }
  await page.reload();await select('语音转写');form=page.getByRole('article',{name:'语音转写配置',exact:true});await form.getByLabel('模型名称',{exact:true}).waitFor();assert.equal(await form.getByLabel('模型名称',{exact:true}).inputValue(),'asr-unsaved');
  await page.screenshot({path:path.join(out,'asr.png'),animations:'disabled',fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: desktop OCR/ASR main-page tabs, retained edits, isolated saves, blank-key preservation, explicit clearing/replacement, save/test errors, reload, environment drawer, 3 desktop widths. All APIs mocked.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
