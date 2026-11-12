const {chromium,browserLaunchOptions,fs,path,assert,base,routeAPI}=require('./direct-media-fixture.cjs');
const out=path.resolve(__dirname,'../../data/verification/workflow-navigation');

async function metrics(page) {
 return page.evaluate(()=>{
  const scroller=document.querySelector('.rewrite-main'),root=document.querySelector('.creation-workflow'),slot=document.querySelector('.workflow-navigation'),nav=document.querySelector('.workflow-icon-toolbar');
  const box=el=>{const r=el.getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:r.height}};
  return{scroll:scroller.scrollTop,total:scroller.scrollHeight,client:scroller.clientHeight,root:box(root),nav:box(nav),slot:box(slot),header:box(document.querySelector('.topbar')),scroller:box(scroller),rail:document.querySelector('.rewrite-project-rail-desktop')?.offsetParent?box(document.querySelector('.rewrite-project-rail-desktop .rewrite-project-rail')):null,compact:slot.classList.contains('is-compact')};
 });
}
async function sample(page,count=32) {
 return page.evaluate(async count=>{
  const samples=[];
  for(let i=0;i<count;i++){
   await new Promise(requestAnimationFrame);
   const scroller=document.querySelector('.rewrite-main'),slot=document.querySelector('.workflow-navigation'),nav=document.querySelector('.workflow-icon-toolbar');
   samples.push({scroll:scroller.scrollTop,total:scroller.scrollHeight,top:nav.getBoundingClientRect().top,compact:slot.classList.contains('is-compact')});
  }
  return samples;
 },count);
}
function stable(samples,label) {
 for(const key of ['scroll','total','top']){
  const values=samples.map(row=>row[key]);
  assert(Math.max(...values)-Math.min(...values)<1.1,label+' '+key+' must stay stable: '+JSON.stringify(samples));
 }
 assert(samples.every(row=>row.compact),label+' must remain collapsed');
}
(async()=>{
 await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch(browserLaunchOptions);
 try{
  const page=await browser.newPage({viewport:{width:1157,height:765}}),errors=[],report=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/v1/**',routeAPI);
  await page.goto(base+'/#rewrites');await page.locator('.creation-workflow').waitFor();
  const nav=page.getByRole('navigation',{name:'仿写创作步骤',exact:true}),scroller=page.locator('.rewrite-main');
  for(const width of [1720,1157,823,547,390]){
   await page.setViewportSize({width,height:765});
   for(const label of ['基本信息','标题仿写','文案仿写','图片仿写','视频仿写']){
    await nav.getByRole('button',{name:label,exact:true}).click();
    await scroller.evaluate(el=>el.scrollTop=0);
    await page.waitForFunction(()=>!document.querySelector('.workflow-navigation').classList.contains('is-compact'));
    await sample(page,14);
    const initial=await metrics(page);
    if(initial.rail)assert(Math.abs(initial.nav.top-initial.rail.top)<=1,'Desktop toolbar and project list align '+JSON.stringify(initial));
    const boundary=Math.max(initial.header.bottom,initial.scroller.top),distance=initial.nav.top-boundary;
    assert(distance>3,'Toolbar starts below boundary');
    const before=Math.max(0,Math.floor(distance)-4);
    await scroller.evaluate((el,top)=>el.scrollTop=top,before);await sample(page,4);
    const moving=await metrics(page);
    assert(!moving.compact,'Do not collapse before touching header '+JSON.stringify(moving));
    assert(Math.abs(moving.nav.top-(initial.nav.top-moving.scroll))<1.1,'Toolbar follows normal scrolling before touching header '+JSON.stringify({width,label,initial,moving}));
    if(initial.total-initial.client>distance+3){
     await scroller.evaluate((el,top)=>el.scrollTop=top,Math.ceil(distance)+3);
     await page.waitForFunction(()=>document.querySelector('.workflow-navigation').classList.contains('is-compact'));
     const crossing=await sample(page,32);stable(crossing,'Boundary '+width+' '+label);
     const pinned=await metrics(page);
     assert(Math.abs(pinned.nav.top-boundary)<1.1,'Pin at the actual topbar boundary '+JSON.stringify(pinned));
     assert(pinned.nav.height<56,'Collapsed menu uses icons only');
     assert.equal(pinned.total,initial.total,'Collapsing must not change document height');
     await scroller.evaluate(el=>el.scrollTop=el.scrollHeight-el.clientHeight);
     stable(await sample(page,32),'Bottom '+width+' '+label);
     if(label==='视频仿写')await page.screenshot({path:path.join(out,'collapsed-'+width+'.png')});
     await scroller.evaluate(el=>el.scrollTop=0);await sample(page,14);
     assert(!(await metrics(page)).compact,'Expand again after returning to top');
    }
    report.push({width,module:label,initialTop:initial.nav.top,boundary});
   }
   await page.screenshot({path:path.join(out,'expanded-'+width+'.png')});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
  }
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({status:'PASS',checks:report,errors},null,2));
  console.log('PASS toolbar alignment, normal scrolling, boundary collapse and stable bottom scrolling at five widths.');
 }catch(error){await browser.contexts()[0]?.pages()[0]?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
