const {chromium,fs,path,assert,routeAPI,assets,publications,stamp}=require('./direct-media-fixture.cjs');
(async()=>{
 const pub={id:'manual-publication',project_id:'media-project',version_id:'v1',target_platform:'xhs',title:'已确认的新标题',body:'已确认的新正文',topics:['手冲咖啡','周末日常'],kind:'image',asset_ids:['source-1','source-2'],cover_id:'source-1',ready:true,revision:1,created_at:stamp};
 publications.push(pub,{...pub,id:'legacy-pending',title:'旧的未准备稿',ready:false});
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
 const page=await browser.newPage({viewport:{width:1124,height:884},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));let mutations=[];let failAsset=false;const downloads=[];page.on('download',d=>downloads.push(d));
 const waitDownloads=async count=>{for(let i=0;i<100&&downloads.length<count;i++)await page.waitForTimeout(50);assert.equal(downloads.length,count);};
 await page.addInitScript(()=>{
  window.__copies=[];window.__files=[];window.__pickerMode='ok';
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.__copies.push(text)}});
  window.showDirectoryPicker=async()=>{
   if(window.__pickerMode==='cancel')throw new DOMException('cancel','AbortError');
   if(window.__pickerMode==='failure')throw new Error('模拟文件夹权限失效');
   return {getFileHandle:async(name,options)=>{
    if(!options?.create) {if(name==='01-source-1.jpg')return {};throw new DOMException('missing','NotFoundError');}
    return {createWritable:async()=>({write:async blob=>window.__files.push({name,size:blob.size}),close:async()=>{}})};
   }};
  };
 });
 await page.route('**/api/v1/**',async route=>{const req=route.request(),e=new URL(req.url()).pathname.slice(7);if(req.method()!=='GET')mutations.push(e);
 if(failAsset&&e==='/assets/source-2/file')return route.fulfill({status:500,json:{error:'test failure'}});
 if(e.endsWith('/status')){const data=req.postDataJSON();assert.equal(data.revision,pub.revision);pub.manual_status=data.status;pub.revision++;return route.fulfill({json:pub});}
 if(e.endsWith('/mobile-handoff/capability'))return route.fulfill({json:{available:false,reason:'测试未连接扫码服务'}});
 if(e.endsWith('/mobile-handoff'))return route.fulfill({json:{}});
 return routeAPI(route);});
 await page.goto('http://127.0.0.1:8081/#publications');
 const row=page.getByRole('row').filter({has:page.getByRole('button',{name:'查看发布稿 '+pub.title,exact:true})});await row.waitFor();
 assert.equal(await page.getByText('待准备',{exact:true}).count(),0);assert.equal(await page.getByText('旧的未准备稿',{exact:true}).count(),0);
 assert.equal(await row.getByRole('button',{name:'小红书扫码发布',exact:true}).count(),1);
 const geometry=await row.getByRole('button',{name:'抖音手动发布',exact:true}).boundingBox();assert(geometry.x+geometry.width<=1124);
 assert(await page.locator('.ant-table-content').evaluate(el=>el.scrollWidth<=el.clientWidth));
 await row.getByRole('button',{name:'抖音手动发布',exact:true}).click();const dialog=page.getByRole('dialog',{name:'抖音手动发布',exact:true});

 await dialog.getByRole('button',{name:'复制标题',exact:true}).click();await dialog.getByRole('button',{name:'复制正文（含话题）',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.__copies),[pub.title,pub.body+'\n\n#手冲咖啡 #周末日常']);
 assert.equal(await dialog.getByRole('link',{name:'打开抖音发布页面',exact:true}).getAttribute('target'),'_blank');
 await dialog.getByRole('button',{name:'选择文件夹并保存素材',exact:true}).click();await dialog.getByText('已保存 2 个素材到所选文件夹',{exact:true}).waitFor();
 const files=await page.evaluate(()=>window.__files);assert.equal(files.length,2);assert.equal(files[0].name,'01-source-1-1.jpg');assert(files.every(f=>f.size>0));
 assert.equal(await dialog.getByRole('img',{name:'原图1',exact:true}).count(),1);
 assert.equal(await dialog.getByRole('img',{name:'原图2',exact:true}).count(),1);
 await dialog.getByRole('checkbox',{name:'保存原图2',exact:true}).uncheck();
 await dialog.getByRole('button',{name:'选择文件夹并保存素材',exact:true}).click();await dialog.getByText('已保存 1 个素材到所选文件夹',{exact:true}).waitFor();
 const selectedFiles=await page.evaluate(()=>window.__files);assert.equal(selectedFiles.length,3);assert.equal(selectedFiles[2].name,'01-source-1-1.jpg');
 assert.equal(await dialog.getByRole('link',{name:/下载 02/}).count(),0);
 await dialog.getByRole('checkbox',{name:'保存原图1',exact:true}).uncheck();
 assert(await dialog.getByRole('button',{name:'选择文件夹并保存素材',exact:true}).isDisabled());
 assert(await dialog.getByRole('button',{name:'浏览器下载素材',exact:true}).isDisabled());
 await dialog.getByRole('checkbox',{name:'保存原图1',exact:true}).check();await dialog.getByRole('checkbox',{name:'保存原图2',exact:true}).check();

 await page.evaluate(()=>window.__pickerMode='cancel');await dialog.getByRole('button',{name:'选择文件夹并保存素材',exact:true}).click();await dialog.getByText(/未选择文件夹，尚未保存素材/).waitFor();
 await page.evaluate(()=>window.__pickerMode='failure');await dialog.getByRole('button',{name:'选择文件夹并保存素材',exact:true}).click();await dialog.getByText(/模拟文件夹权限失效/).waitFor();assert.deepEqual(mutations,[]);
 await dialog.getByRole('button',{name:'浏览器下载素材',exact:true}).click();await dialog.getByText(/已向浏览器发起 2 个素材下载/).waitFor();await waitDownloads(2);assert.equal(downloads[0].suggestedFilename(),'01-source-1.jpg');assert.equal(downloads[1].suggestedFilename(),'02-source-2.jpg');
 failAsset=true;await dialog.getByRole('button',{name:'浏览器下载素材',exact:true}).click();await dialog.getByText(/已发起 1 \/ 2 个下载：素材下载失败（500）/).waitFor();await waitDownloads(3);failAsset=false;
 const out=path.resolve(__dirname,'../../data/verification/publication-manual');await fs.mkdir(out,{recursive:true});for(let i=0;i<2;i++){const target=path.join(out,'browser-download-'+i+'.jpg');await downloads[i].saveAs(target);assert((await fs.stat(target)).size>0);}await page.screenshot({path:path.join(out,'douyin-dialog.png')});
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();const select=row.locator('.ant-select-selector');await select.click();await page.locator('.ant-select-item-option[title="已发布"]').click();await page.waitForFunction(()=>document.querySelector('.ant-table-row .ant-select-selection-item')?.textContent==='已发布');
 assert.equal(pub.manual_status,'published');await select.click();await page.locator('.ant-select-item-option[title="等待发布"]').click();await page.waitForFunction(()=>document.querySelector('.ant-table-row .ant-select-selection-item')?.textContent==='等待发布');assert.equal(pub.manual_status,'ready');
 await page.screenshot({path:path.join(out,'publication-list.png')});
 // Unsupported picker: individual downloads remain usable, with an explanation.
 await page.addInitScript(()=>{window.showDirectoryPicker=undefined;});await page.reload();await page.getByRole('button',{name:'抖音手动发布',exact:true}).click();await page.getByText(/当前浏览器不支持选择文件夹/).waitFor();assert.equal(await page.getByRole('link',{name:/下载 0/}).count(),2);
 await page.getByRole('dialog',{name:'抖音手动发布',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();pub.asset_ids=['source-video'];pub.kind='video';await page.reload();await page.getByRole('button',{name:'抖音手动发布',exact:true}).click();assert.equal(await page.locator('.ant-modal video[controls]').count(),1);await page.getByRole('button',{name:'浏览器下载素材',exact:true}).click();await page.getByText(/已向浏览器发起 1 个素材下载/).waitFor();await waitDownloads(4);assert(downloads[3].suggestedFilename().endsWith('.mp4'));const videoPath=path.join(out,'browser-download-video.mp4');await downloads[3].saveAs(videoPath);assert((await fs.stat(videoPath)).size>1000);
 assert.deepEqual(errors,[]);console.log('Desktop publication status, legacy filtering, action layout, title/body copy, directory save/cancel/failure, no overwrite and download fallback: passed.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
