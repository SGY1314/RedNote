const {chromium, assert, fs, path, routeAPI, assets, requests, stamp} = require('./direct-media-fixture.cjs');
(async () => {
  for (let i = 0; i < 7; i++) assets.push({id:'polish-image-'+i, name:'生成图'+i, kind:'image', source:'generated', project_id:'media-project', status:'ready', created_at:stamp});
  assets.push({id:'library-video', name:'素材库视频', kind:'video', source:'upload', project_id:'another-project', library_state:'saved', status:'ready', created_at:stamp});
  const saves=[];
  const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try {
    const page = await browser.newPage({viewport:{width:1124,height:884},reducedMotion:'reduce'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    let uploaded=false;
    await page.route('**/api/v1/**', async route => {
      const req=route.request(), endpoint=new URL(req.url()).pathname.slice(7);
      if(endpoint==='/profile/default') return route.fulfill({json:{}});
      if(endpoint.endsWith('/workflow/stage')) saves.push(req.postDataJSON());
      if(endpoint==='/assets' && req.method()==='POST') {
        uploaded=true;
        const isVideo=req.postDataBuffer().includes(Buffer.from('test-video.mp4'));
        const asset={id:isVideo?'plus-upload-video':'plus-upload',name:isVideo?'加号上传视频':'加号上传图片',kind:isVideo?'video':'image',source:'upload',project_id:'media-project',status:'ready',created_at:stamp};
        assets.push(asset);return route.fulfill({json:asset});
      }
      return routeAPI(route);
    });
    await page.goto('http://127.0.0.1:8081/#rewrites');
    const nav=page.getByRole('navigation',{name:'仿写创作步骤',exact:true});await nav.waitFor();
    for (const label of ['标题仿写','文案仿写','图片仿写','视频仿写']) {
      await nav.getByRole('button',{name:label,exact:true}).click();
      const ref=page.getByRole('region',{name:'参考内容',exact:true});await ref.waitFor();
      assert.equal(await ref.getByRole('button',{name:'确认参考内容',exact:true}).count(),0);assert(!/仅勾选内容会发送给模型/.test(await ref.innerText()));
      assert.equal(await ref.getByRole('checkbox',{name:label==='标题仿写'?'原标题':'仿写后的标题',exact:true}).count(),1);
      assert.equal(await ref.getByRole('checkbox',{name:label==='文案仿写'?'原文案':'仿写后的文案',exact:true}).count(),1);
      assert.equal(await ref.getByRole('combobox',{name:'标签',exact:true}).count(),1);
      const modelButtons=page.locator('.generation-option-button[aria-label*="模型："]');
      assert(await modelButtons.count()>0);
      for(const button of await modelButtons.all()) assert.equal((await button.innerText()).trim(), (await button.getAttribute('aria-label')).split('：').slice(1).join('：'));
      if(label==='图片仿写') {
        const results=page.getByRole('region',{name:'图片生成时间线'}), plus=results.getByRole('button',{name:'添加图片',exact:true});
        await plus.scrollIntoViewIfNeeded();const before=await plus.boundingBox();
        await results.locator('.image-timeline-track').evaluate(el=>{el.scrollLeft=el.scrollWidth});await page.waitForTimeout(300);
        const after=await plus.boundingBox();assert(Math.abs(before.x-after.x)<1);assert(after.x+after.width<=1124);
        assert.equal(await results.locator('.image-timeline-dropzone').count(),0);
        assert.equal(await results.locator('[data-result-id="source-1"]').count(),0);
        await plus.click();await page.locator('.ant-popover:visible').getByRole('button',{name:'从素材库选择',exact:true}).click();
        const picker=page.getByRole('dialog',{name:'从素材库选择图片',exact:true});await picker.waitFor();
        assert.equal(await picker.getByRole('checkbox',{name:'素材库视频',exact:true}).count(),0);
        await picker.getByRole('checkbox',{name:'原图1',exact:true}).check();await picker.getByRole('button',{name:'添加素材',exact:true}).click();
        const libraryCard=results.locator('[data-result-id="source-1"]');await libraryCard.waitFor();assert(!(await libraryCard.getByRole('checkbox').isChecked()));
        await libraryCard.getByRole('checkbox').check();
        await plus.click();assert.equal(await page.locator('.ant-popover:visible').getByRole('button',{name:'上传图片',exact:true}).count(),1);await page.keyboard.press('Escape');
        const add=results.locator('.image-results-add input[type=file]');
        await add.setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});
        await page.waitForFunction(()=>!!document.querySelector('[data-upload-id="plus-upload"]'));
        assert(uploaded);assert(await plus.isVisible());
        assert(!(await results.locator('[data-upload-id="plus-upload"]').getByRole('checkbox').isChecked()));
        await page.locator('.media-rewrite-image').getByRole('button',{name:/确认$/}).click();
        await page.waitForTimeout(350);assert.deepEqual(saves.at(-1).media.asset_ids,['source-1']);
        const out=path.resolve(__dirname,'../../data/verification/workflow-polish');await fs.mkdir(out,{recursive:true});await page.screenshot({path:path.join(out,'image.png')});
      }
      if(label==='视频仿写') {
        const results=page.getByRole('region',{name:'视频结果轮播',exact:true});
        assert.equal(await results.locator('[data-video-id="source-video"]').count(),0);
        const plus=page.getByRole('button',{name:'添加视频',exact:true});await plus.click();
        await page.locator('.ant-popover:visible').getByRole('button',{name:'从素材库选择',exact:true}).click();
        const picker=page.getByRole('dialog',{name:'从素材库选择视频',exact:true});await picker.waitFor();
        assert.equal(await picker.getByRole('checkbox',{name:'原图1',exact:true}).count(),0);
        await picker.getByRole('checkbox',{name:'素材库视频',exact:true}).check();await picker.getByRole('button',{name:'添加素材',exact:true}).click();
        const card=results.locator('[data-video-id="library-video"]');await card.waitFor();assert(!(await card.getByRole('checkbox').isChecked()));await card.getByRole('checkbox').check();
        await page.locator('.media-rewrite-video').getByRole('button',{name:/确认$/}).click();await page.waitForTimeout(350);assert.deepEqual(saves.at(-1).media.asset_ids,['library-video']);
        await plus.click();assert.equal(await page.locator('.ant-popover:visible').getByRole('button',{name:'上传视频',exact:true}).count(),1);await page.keyboard.press('Escape');
        await page.locator('.media-rewrite-video input[type=file]').last().setInputFiles({name:'test-video.mp4',mimeType:'video/mp4',buffer:await fs.readFile(path.join(__dirname,'fixtures/native-reference.mp4'))});
        await page.waitForFunction(()=>!!document.querySelector('[data-video-id="plus-upload-video"]'));assert.equal(await results.locator('[data-video-id="source-video"]').count(),0);

        const video=page.getByRole('group',{name:'视频生成生成栏',exact:true});
        assert(!/目标时长：|请填写视频脚本/.test(await video.innerText()));
        const generate=video.getByRole('button',{name:'开始生成',exact:true});assert(await generate.isEnabled());
        await generate.click();await page.getByText('请填写视频脚本',{exact:true}).waitFor();
        assert.equal(requests.length,0);
        assert(await page.getByRole('textbox',{name:'视频脚本',exact:true}).evaluate(el=>el===document.activeElement));
      }
    }
    assert.equal(await page.getByText(/已保存版本 V/).count(),0);
    const out=path.resolve(__dirname,'../../data/verification/workflow-polish');await fs.mkdir(out,{recursive:true});await page.screenshot({path:path.join(out,'video.png')});
    assert.deepEqual(errors,[]);
    console.log('PASS: desktop source labels, tag editor, model text, fixed add plus, library/upload menus, explicit media selection, no automatic original video, video empty-script validation; mocked APIs.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
