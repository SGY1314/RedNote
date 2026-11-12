import test from 'node:test';
import assert from 'node:assert/strict';
import {manualEditorResult,openDraftEditor} from './editor-handoff.mjs';
test('verification compatibility hands off without generating a publish token or claiming verification',()=>{
 for(const code of ['editor_title_mismatch','editor_caption_mismatch','editor_visibility_mismatch','editor_media_unverified']) {
  const result=manualEditorResult(Error(code),{publication_id:'p1'},{user_id:'a1'});
  assert.equal(result.verified,false);assert.equal(result.manual_review,true);
  assert.equal(result.publication_id,'p1');assert.ok(!('prepared_id' in result));
 }
 for(const code of ['human_required','identity_unverified','upload_failed','unknown','page_changed'])assert.throws(()=>manualEditorResult(Error(code),{},{}),new RegExp(code));
});
test('resume brings the same editor forward without navigating, re-uploading or clicking publish',async()=>{
 let front=0;
 const page={isClosed:()=>false,url:()=> 'https://creator.douyin.com/creator-micro/content/publish',
  getByPlaceholder:()=>({filter(){return this},count:async()=>1}),bringToFront:async()=>{front++;}};
 await openDraftEditor(page,'p1','p1');assert.equal(front,1);
 for(const [requested,current] of [['p1','p2'],['','p1'],['p1','']])await assert.rejects(openDraftEditor(page,requested,current),/editor_unavailable/);
 await assert.rejects(openDraftEditor({...page,isClosed:()=>true},'p1','p1'),/editor_unavailable/);
 await assert.rejects(openDraftEditor({...page,url:()=> 'https://example.com'},'p1','p1'),/editor_unavailable/);
 await assert.rejects(openDraftEditor({...page,getByPlaceholder:()=>({filter(){return this},count:async()=>0})},'p1','p1'),/editor_unavailable/);
 assert.equal(front,1);
});
