import {chromium} from 'playwright';
import readline from 'node:readline';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {videoURL,canonicalVideoURL,normalizeVideo,verifiedAccount,accountProgress,signature,receiptFrom,workID} from './protocol.mjs';
import {readRenderedVideo,responseVideo} from './collect-page.mjs';
import {allowedRequest} from './network-policy.mjs';
import {captureLoginQR,qrState} from './login-qr.mjs';
import {ensureLoginPage} from './session-page.mjs';
import {readPublicationState} from './publication-status.mjs';
import {openPublishingEntry,waitUploadInput} from './publish-entry.mjs';
import {publicFailure} from './errors.mjs';
import {setVisibility,readVisibility,visibilityDiagnostics} from './visibility.mjs';
import {normalizeEditorText,readEditorMedia,inspectEditorMedia,assertEditorMatches,waitForEditorMatch} from './editor-verification.mjs';
import {readCaptionDOM} from './editor-caption.mjs';
import {manualEditorResult,openDraftEditor} from './editor-handoff.mjs';
import {assertUploadNotFailed,recordNetworkIssue,networkSummary} from './upload-state.mjs';

let browser,context,page,mainPage,visible=false,loginAt=0,prepared;
let mainIdentity,creatorIdentity;
let prepareStage='';
let editorPublicationID='';
const empty=()=>({is_logged_in:false,main_verified:false,creator_verified:false,user_id:'',username:'',state:'logged_out'});
const blockedResources=new WeakMap();
const observedIdentities=new WeakMap();
const publicIP=ip=> isIP(ip)===4 ? !/^(0|10|127|169\.254|172\.(1[6-9]|2\d|3[01])|192\.168|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])|22[4-9]|23\d|24\d|25[0-5])\./.test(ip) : isIP(ip)===6 && !/^(::|f[cd]|fe[89ab])/i.test(ip);
async function safeContext(storage){
 const c=await browser.newContext({storageState:storage,viewport:{width:1280,height:900},serviceWorkers:'block'});
 const blocked={scripts:0,issues:[]};blockedResources.set(c,blocked);
 c.on('requestfailed',request=>recordNetworkIssue(blocked.issues,request.url(),request.resourceType(),'request'));
 c.on('response',response=>{
  if(response.status()>=400)recordNetworkIssue(blocked.issues,response.url(),response.request().resourceType(),'http',response.status());
 });
 const cache=new Map();
 await c.route('**/*',async route=>{
  try {const request=route.request();const u=new URL(request.url());if(!allowedRequest(u.href,request.resourceType())){if(request.resourceType()==='script')blocked.scripts++;recordNetworkIssue(blocked.issues,u.href,request.resourceType(),'policy');return route.abort();}
   let ips=cache.get(u.hostname);if(!ips){try{ips=await lookup(u.hostname,{all:true});cache.set(u.hostname,ips)}catch{recordNetworkIssue(blocked.issues,u.href,request.resourceType(),'dns');return route.abort();}}
   if(!ips.length||ips.some(x=>!publicIP(x.address))){recordNetworkIssue(blocked.issues,u.href,request.resourceType(),'address');return route.abort();}await route.continue();
  } catch {await route.abort().catch(()=>{})}
 });return c;
}
async function start(storage){
 if(browser?.isConnected()){page=await ensureLoginPage(context,page,p=>observeIdentity(p,'creator'));return;}
 prepared=undefined;editorPublicationID='';mainIdentity=creatorIdentity=undefined;
 try {browser=await chromium.launch({...(process.env.WORKBENCH_BROWSER ? {executablePath:process.env.WORKBENCH_BROWSER} : process.platform==='win32' ? {channel:'msedge'} : {}),headless:process.env.WORKBENCH_HEADLESS==='1'||!visible,chromiumSandbox:true});context=await safeContext(storage);page=await context.newPage();observeIdentity(page,'creator');}catch{throw Error('browser_unavailable')}
}
function observeIdentity(p,where){
 const observed=observedIdentities.get(p)||new Set();if(observed.has(where))return;observed.add(where);observedIdentities.set(p,observed);
 p.on('response',async response=>{
  try {const u=new URL(response.url());
   if(where==='main' && u.hostname==='www.douyin.com' && u.pathname==='/aweme/v1/web/user/profile/self/'){
    const b=await response.json();if(b.status_code===0 && b.user?.uid) mainIdentity={uid:b.user.uid};
   }
   if(where==='creator' && u.hostname==='creator.douyin.com' && /^\/web\/api\/(media\/user\/info|user\/info)\/?$/.test(u.pathname)){
    const b=await response.json();const d=b.user || b.data?.user || b.data;
    if(b.status_code===0&&d?.uid&&d?.nickname)creatorIdentity={uid:d.uid,nickname:d.nickname};
   }
  } catch {} // Never log page bodies, tokens or storage.
 });
}
async function human(p){
 const text=await p.locator('body').innerText().catch(()=>'');
 if(/请完成验证|拖动滑块|实名认证|请先同意|人机验证/.test(text))throw Error('human_required');
}
async function creatorHome(){
 editorPublicationID='';
 creatorIdentity=undefined;
 await page.goto('https://creator.douyin.com/',{waitUntil:'domcontentloaded',timeout:45000});
}
async function account(force=false){
 if(force||!creatorIdentity){
  creatorIdentity=undefined;const probe=await context.newPage();observeIdentity(probe,'creator');
  try {await probe.goto('https://creator.douyin.com/',{waitUntil:'domcontentloaded',timeout:45000});await human(probe);for(let i=0;i<15&&!creatorIdentity;i++)await probe.waitForTimeout(300)}finally{await probe.close()}
 }
 // Do not navigate to the main site during login/upload verification. A
 // creator-center scan is sufficient; collection has its own browser context.
 return verifiedAccount(mainIdentity,creatorIdentity);
}
async function checkAccount(force=false){
 try{return await account(force)}catch(e){if(e.message!=='identity_unverified')throw e;return accountProgress(mainIdentity,creatorIdentity)}
}
async function qr(){
 await human(page);
 const img=await captureLoginQR(page);
 await human(page);
 loginAt=Date.now();return {...empty(),state:'waiting_scan',img};
}
async function loginStatus(){
 if(!page||page.isClosed()||page.url()==='about:blank')return {...empty(),state:'unverified'};
 try{await human(page)}catch(e){if(e.message==='human_required')return {...empty(),state:'verification_required'};throw e}
 const text=await page.locator('body').innerText();
 const state=qrState(text,!!await page.getByRole('img',{name:'二维码',exact:true}).filter({visible:true}).count(),loginAt);
 if(creatorIdentity)return accountProgress(mainIdentity,creatorIdentity);
 if(state)return {...empty(),state};
 return {...empty(),state:'verifying'};
}
async function clickUnique(locator,code='page_changed'){
 const matches=locator.filter({visible:true});if(await matches.count()!==1)throw Error(code);await matches.click();
}
async function publishingEntry(kind){
 prepareStage='creator_home';
 await creatorHome();await human(page);
 prepareStage='publish_entry';
 await openPublishingEntry(page,kind,human);
}
function editor(){return page.locator('[contenteditable="true"]').filter({visible:true});}
async function readEditor(kind){
 await assertUploadNotFailed(page);
 const title=page.getByPlaceholder(/填写作品标题|填写标题/).filter({visible:true});
 if(await title.count()!==1||await editor().count()!==1)throw Error('page_changed');
 const visibility=await readVisibility(page);
 const media=await page.locator(kind==='video'?'video':'[class*="image-item"] img').evaluateAll(readEditorMedia,kind);
 const mediaRead=await page.locator(kind==='video'?'video':'[class*="image-item"] img').evaluateAll(inspectEditorMedia);
 // Retain the existing before-submit guard for visible cover/preview images,
 // but do not count these pictures as evidence that the video itself uploaded.
 const previewImages=await page.locator('[class*="preview"] img').evaluateAll(readEditorMedia,'image');
 const captionRead=await editor().evaluate(readCaptionDOM);
 return {title:normalizeEditorText(await title.inputValue()),caption:normalizeEditorText(captionRead.dom),captionRead,visibility,media,mediaRead,previewImages};
}
async function checkFiles(d){
 for(const f of [...d.files,...(d.cover?[d.cover]:[])]){
  const hash=createHash('sha256').update(await readFile(f.path)).digest('hex');if(hash!==f.sha256)throw Error('editor_mismatch');
 }
}
async function prepare(d){
 prepared=undefined;
 const network=blockedResources.get(context);if(network)network.issues.length=0;
 prepareStage='account_check';
 const a=await account(true);if(a.user_id!==d.account_id)throw Error('identity_unverified');
 prepareStage='files_check';await checkFiles(d);
 await publishingEntry(d.kind);
 prepareStage='upload_control';
 const match=await waitUploadInput(page,human);
 prepareStage='upload_files';
 await match.setInputFiles(d.files.map(x=>x.path));
 prepareStage='editor_wait';
 const title=page.getByPlaceholder(/填写作品标题|填写标题/).filter({visible:true});await title.waitFor({timeout:8*60*1000});
 editorPublicationID=d.publication_id;
 prepareStage='fill_title';
 await human(page);await title.fill(d.title);await title.blur();
 prepareStage='fill_caption';
 if(await editor().count()!==1)throw Error('page_changed');await editor().fill(d.caption);await editor().blur();
 if(d.cover){
  prepareStage='cover';
  await clickUnique(page.getByText(/^(设置封面|编辑封面)$/));
  await clickUnique(page.getByText('上传封面',{exact:true}));
  const cover=page.locator('input[type="file"][accept*="image"]');if(await cover.count()!==1)throw Error('upload_failed');await cover.setInputFiles(d.cover.path);
  await clickUnique(page.getByRole('button',{name:/^(完成|确定)$/}),'upload_failed');
 }
 prepareStage='visibility';
 await setVisibility(page,d.visibility,human);
 prepareStage='upload_finish';
 const publish=page.getByRole('button',{name:'发布',exact:true});await publish.waitFor({state:'visible',timeout:60000});
 for(let i=0;i<120&&!await publish.isEnabled();i++){await human(page);await assertUploadNotFailed(page);await page.waitForTimeout(1000)}
 await assertUploadNotFailed(page);
 if(!await publish.isEnabled())throw Error('upload_failed');
 prepareStage='editor_verify';
 let current;
 try {current=await waitForEditorMatch(()=>readEditor(d.kind),d,()=>human(page),ms=>page.waitForTimeout(ms));}
 catch(e) {
  const result=manualEditorResult(e,d,a);
  await saveEditorDiagnostic(e);
  await openDraftEditor(page,d.publication_id,editorPublicationID);
  return result;
 }
 // Full editor screenshot is shown to the human for final media order/cover verification.
 prepareStage='preview';
 const id=randomUUID();prepared={id,draft:d,editor:signature(current),expires:Date.now()+300000,account:a};
 return {prepared_id:id,account:a,verified:true,image:'data:image/png;base64,'+(await page.screenshot({fullPage:true})).toString('base64')};
}
async function submit(args){
 const p=prepared;prepared=undefined;
 if(!p||p.id!==args.prepared_id||p.expires<Date.now()||signature(args.draft)!==signature(p.draft))throw Error('prepare_required');
 await checkFiles(p.draft);await human(page);
 // Check identity in separate fresh pages so that the prepared editor is preserved.
 const check=await context.newPage();observeIdentity(check,'creator');creatorIdentity=undefined;
 try{await check.goto('https://creator.douyin.com/',{waitUntil:'domcontentloaded'});for(let i=0;i<15&&!creatorIdentity;i++)await check.waitForTimeout(300);if(verifiedAccount(mainIdentity,creatorIdentity).user_id!==p.account.user_id)throw Error('identity_unverified')}finally{await check.close()}
 const current=assertEditorMatches(await readEditor(p.draft.kind),p.draft);
 if(signature(current)!==p.editor)throw Error('editor_media_changed');
 const receipt=page.waitForResponse(r=>{const u=new URL(r.url());return u.hostname==='creator.douyin.com'&&/\/aweme\/(create|publish)\/?$/.test(u.pathname)&&r.request().method()==='POST'},{timeout:90000});
 // Exactly one click. Never click a confirmation dialog or retry this operation.
 try{await clickUnique(page.getByRole('button',{name:'发布',exact:true}));return receiptFrom(await (await receipt).json())}catch{receipt.catch(()=>{});throw Error('unknown')}
}
async function result(args){
 const a=await account(true);if(a.user_id!==args.account_id||!workID(args.work_id))throw Error('identity_unverified');
 await clickUnique(page.getByText('作品管理',{exact:true}));
 const link=page.locator('a[href*="'+args.work_id+'"]');if(await link.count()!==1)throw Error('page_changed');
 const row=link.locator('xpath=ancestor::*[self::tr or contains(@class,"item")][1]');
 const state=await readPublicationState(row);return {work_id:args.work_id,state};
}
async function collect(raw,storage){
 const expected=videoURL(raw);const c=await safeContext(storage || await context.storageState());const p=await c.newPage();let candidate;
 const currentID=()=>{try{return expected||videoURL(p.url())}catch{return expected}};
 p.on('response',async r=>{try{
  const u=new URL(r.url());
  if(!['www.douyin.com','www.iesdouyin.com'].includes(u.hostname)||!/^\/aweme\/(?:v\d+\/web\/)?aweme\/(detail|feed)\/?$/.test(u.pathname)&&!/^\/aweme\/detail\/?$/.test(u.pathname))return;
  const d=responseVideo(await r.json(),currentID());if(d)candidate=d;
 }catch{}});
 try{
  try{const response=await p.goto(canonicalVideoURL(raw),{waitUntil:'domcontentloaded',timeout:45000});if(response?.status()>=400)throw Error('collect_network_failed');}
  catch(e){if(e.message==='collect_network_failed'||/net::|Timeout/.test(e.message))throw Error('collect_network_failed');throw e;}
  for(let i=0;i<40;i++){
   await human(p);
   const id=currentID();
   if(id){
    if(candidate){try{return normalizeVideo(candidate,id)}catch(e){if(e.message==='unsupported_media')throw e;}}
    // A public page may render a playable video without issuing the detail API.
    const rendered=await p.evaluate(readRenderedVideo,id);
    if(rendered)return normalizeVideo(rendered,id);
   }
   await p.waitForTimeout(500);
  }
  const text=await p.locator('body').innerText().catch(()=>'');
  if(/作品已删除|作品不存在|视频已删除|视频不存在|作品暂时无法查看/.test(text))throw Error('collect_work_unavailable');
  if(await p.locator('[data-e2e="detail-video-info"] h1').count())throw Error('collect_media_unavailable');
  if(blockedResources.get(c)?.scripts)throw Error('collect_resources_blocked');
  throw Error('collect_page_unreadable');
 } finally {await c.close()}
}
async function dispatch(m){
 if(m.op==='logout'){prepared=undefined;await browser?.close();browser=context=page=mainPage=undefined;return {data:empty()}}
 // Start uploads in a visible dedicated browser so the editor survives a
 // verification handoff. Never restart an editor merely to bring it forward.
 if((m.op==='login'||m.op==='prepare'||m.op==='open_browser'&&m.args?.target!=='editor')&&!visible){const s=browser?.isConnected()&&context?await context.storageState():m.storage;await browser?.close();browser=context=page=mainPage=undefined;visible=true;await start(s)}
 // A status poll must never recreate a closed login tab or browser. The user
 // can explicitly request a new QR or reopen the official browser instead.
 if(m.op!=='login_status')await start(m.storage);
 let data;
 switch(m.op){
 case 'open_browser':
  prepared=undefined;
  if(m.args?.target==='editor') {
   await openDraftEditor(page,m.args.publication_id,editorPublicationID);
   data={...empty(),state:'editor_open'};break;
  }
  if(page.isClosed()){page=await context.newPage();observeIdentity(page,'creator')}
  if(m.args?.target==='main'){observeIdentity(page,'main');await page.goto('https://www.douyin.com/',{waitUntil:'domcontentloaded',timeout:45000});}
  else await creatorHome();
  // Activate the visible official window after navigation finishes. Activating
  // it before navigation can leave the workbench window covering the login QR.
  await page.bringToFront();
  data={...empty(),state:'browser_open'};break;
 case 'login':
  prepared=undefined;loginAt=0;await creatorHome();
  try{data=await qr()}catch(e){if(e.message==='human_required')data={...empty(),state:'verification_required'};else if(e.message==='qr_unavailable')data=creatorIdentity?accountProgress(mainIdentity,creatorIdentity):{...empty(),state:'verifying'};else throw e}
  if(page&&!page.isClosed())await page.bringToFront();
  break;
 case 'login_status':data=await loginStatus();break;
 case 'account':data=await checkAccount(true);break;
 case 'collect':data=await collect(m.args.url,m.storage);break;
 case 'prepare':
  try {data=await prepare(m.args);}finally{await saveUploadDiagnostic();}
  break;
 case 'submit':data=await submit(m.args);break;
 case 'result':data=await result(m.args);break;
 default:throw Error('page_changed');
 }
 // Persist a confirmed login once; polling an unscanned QR must not write a
 // new session every few seconds.
 const saveSession=['login','account','open_browser'].includes(m.op)||m.op==='login_status'&&data?.state==='success';
 const storage=saveSession&&data?.state!=='logged_out'&&browser?.isConnected()&&context?await context.storageState():undefined;
 return {data,storage};
}
const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
async function saveUploadDiagnostic() {
 try {
  const issues=networkSummary(blockedResources.get(context)?.issues||[]);
  await mkdir(new URL('../logs/',import.meta.url),{recursive:true});
  await writeFile(new URL('../logs/douyin-upload.json',import.meta.url),JSON.stringify({time:new Date().toISOString(),stage:prepareStage,issues},null,2),'utf8');
 }catch{}
}
async function saveEditorDiagnostic(e) {
 if(!e.diagnostic)return;
 try {
  await mkdir(new URL('../logs/',import.meta.url),{recursive:true});
  await writeFile(new URL('../logs/douyin-editor.json',import.meta.url),JSON.stringify({time:new Date().toISOString(),error:e.message,...e.diagnostic},null,2),'utf8');
 }catch{}
}
for await(const line of input){
 let out;prepareStage='';
 try{if(line.length>12*1024*1024)throw Error('page_changed');const request=JSON.parse(line);if(request.op==='prepare')prepareStage='browser_start';out=await dispatch(request)}catch(e){
  out=publicFailure(e,prepareStage);
  if(/^editor_/.test(out.error)&&e.diagnostic) {
   await saveEditorDiagnostic(e);
  }
  if(/^visibility_/.test(out.error)&&page&&!page.isClosed()) {
   try {
    const diagnostic=await visibilityDiagnostics(page);
    await mkdir(new URL('../logs/',import.meta.url),{recursive:true});
    await writeFile(new URL('../logs/douyin-visibility.json',import.meta.url),JSON.stringify({time:new Date().toISOString(),error:out.error,...diagnostic},null,2),'utf8');
   } catch {} // Diagnostic failure cannot change the publishing result.
  }
 }
 process.stdout.write(JSON.stringify(out)+'\n');
}
await browser?.close();
