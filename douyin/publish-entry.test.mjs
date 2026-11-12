import test from 'node:test';
import assert from 'node:assert/strict';
import {openPublishingEntry,waitUploadInput} from './publish-entry.mjs';

function fixture(labels,{delay=0,inputs=1,inputDelay=0}={}) {
 let ticks=0;const clicks=[];
 const page={
  async waitForTimeout(){ticks++;},
  getByText(pattern){
   const matched=labels.filter(label=>pattern.test(label));
   return {filter(){return this},async count(){return ticks>=delay?matched.length:0},async isEnabled(){return true},async click(){clicks.push(matched[0])}};
  },
  locator(selector){assert.equal(selector,'input[type="file"]:not([disabled])');return {async count(){return ticks>=inputDelay?inputs:0}};},
 };
 return {page,clicks,ticks:()=>ticks};
}
const human=async()=>{};
test('current and legacy video entry labels open only the normal video uploader',async()=>{
 for(const label of ['发布高清视频','发布视频']) {
  const f=fixture(['发布全景视频','发布图文','发布文章',label],{delay:3});
  await openPublishingEntry(f.page,'video',human);
  assert.deepEqual(f.clicks,[label]);assert.equal(f.ticks(),3);
 }
});
test('image entry remains separate, missing and ambiguous entries never click',async()=>{
 const f=fixture(['发布高清视频','发布全景视频','发布图文']);
 await openPublishingEntry(f.page,'image',human);assert.deepEqual(f.clicks,['发布图文']);
 const missing=fixture(['发布全景视频']);
 await assert.rejects(openPublishingEntry(missing.page,'video',human),/publish_entry_unavailable/);
 assert.equal(missing.clicks.length,0);
 const duplicate=fixture(['发布高清视频','发布高清视频']);
 await assert.rejects(openPublishingEntry(duplicate.page,'video',human),/publish_entry_ambiguous/);
 assert.equal(duplicate.clicks.length,0);
});
test('human verification stops navigation and uploader waits for asynchronous rendering',async()=>{
 const f=fixture(['发布高清视频']);
 await assert.rejects(openPublishingEntry(f.page,'video',async()=>{throw Error('human_required')}),/human_required/);
 assert.equal(f.clicks.length,0);
 const delayed=fixture([],{inputDelay:4});
 assert.ok(await waitUploadInput(delayed.page,human));assert.equal(delayed.ticks(),4);
 await assert.rejects(waitUploadInput(fixture([],{inputs:2}).page,human),/upload_control_ambiguous/);
 await assert.rejects(waitUploadInput(fixture([],{inputs:0}).page,human),/upload_control_missing/);
});
