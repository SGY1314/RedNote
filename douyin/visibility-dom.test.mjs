import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {setVisibility,readVisibility} from './visibility.mjs';

// Local HTML fixtures only; no creator account, network or publishing action.
test('privacy row custom radios are scoped, switched and verified in rendered DOM',{skip:process.env.WORKBENCH_BROWSER_TESTS!=='1'},async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage();
  const html=`<main>
   <div>正文 <span>公开</span></div>
   <section><h2>发布设置</h2>
    <div><span>同时发布</span><label class="radio checked">不同时发布</label><label>同时发布到</label></div>
    <div id="privacy"><span>谁可以看</span><div>
     <label class="radio"><i class="radio-icon checked"></i><span>公开</span></label>
     <label class="radio"><i class="radio-icon"></i><span>好友可见</span></label>
     <label class="radio"><i class="radio-icon"></i><span>仅自己可见</span></label>
    </div></div>
    <div><span>保存权限</span><label class="radio checked">允许</label><label>不允许</label></div>
    <div><span>发布时间</span><label class="radio checked">立即发布</label><label>定时发布</label></div>
   </section></main>`;
  await page.setContent(html);
  await page.evaluate(()=>{
   window.clicks=[];
   document.querySelectorAll('#privacy label').forEach(label=>label.addEventListener('click',()=>{
    window.clicks.push(label.textContent.trim());
    document.querySelectorAll('#privacy i').forEach(i=>i.classList.remove('checked'));
    label.querySelector('i').classList.add('checked');
   }));
  });
  const human=async()=>{};
  await setVisibility(page,'public',human);
  assert.deepEqual(await page.evaluate(()=>window.clicks),[]);
  await setVisibility(page,'self',human);
  assert.equal(await readVisibility(page),'self');
  assert.deepEqual(await page.evaluate(()=>window.clicks),['仅自己可见']);
  await setVisibility(page,'public',human);
  assert.equal(await readVisibility(page),'public');
  await page.getByText('好友可见',{exact:true}).click();
  await assert.rejects(readVisibility(page),/visibility_unverified/);
  // A focus/active class is not a selected-state signal.
  await page.evaluate(()=>document.querySelectorAll('#privacy i').forEach(i=>i.className='radio-icon active focused'));
  await assert.rejects(readVisibility(page),/visibility_unverified/);
  await page.evaluate(()=>document.querySelectorAll('#privacy i').forEach(i=>i.className='radio-icon checked'));
  await assert.rejects(readVisibility(page),/visibility_ambiguous/);
  // Repeated privacy sections must not result in an arbitrary click.
  await page.setContent(html+html);
  await assert.rejects(setVisibility(page,'public',human),/visibility_ambiguous/);
  // A component can expose both a wrapper's ARIA state and a native input.
  await page.setContent(`<div><span>谁可以看</span>
   <label role="radio" aria-checked="true"><input type="radio" name="privacy" checked><span>公开</span></label>
   <label role="radio" aria-checked="false"><input type="radio" name="privacy"><span>仅自己可见</span></label></div>`);
  assert.equal(await readVisibility(page),'public');
  await setVisibility(page,'public',human);
  // Explicit state disagreement must block submission.
  await page.locator('label').first().evaluate(e=>e.setAttribute('aria-checked','false'));
  await assert.rejects(setVisibility(page,'public',human),/visibility_ambiguous/);
 } finally {await browser.close();}
});
