import test from 'node:test';
import assert from 'node:assert/strict';
import {assertUploadNotFailed,recordNetworkIssue,networkSummary} from './upload-state.mjs';
import {manualEditorResult} from './editor-handoff.mjs';

test('official upload failure stops even when editor and publish button are available',async()=>{
 const page=(text,visible=true)=>({getByText:re=>({filter:()=>({count:async()=>visible&&re.test(text)?1:0})})});
 for(const text of ['上传失败，重新上传','上传失败','上传失败 重新上传']) {
  await assert.rejects(assertUploadNotFailed(page(text)),e=>{
   assert.equal(e.message,'upload_failed');
   assert.throws(()=>manualEditorResult(e,{},{}),/upload_failed/);return true;
  });
 }
 for(const text of ['上传中 50%','上传成功','标题中提到上传失败的处理方法'])await assertUploadNotFailed(page(text));
 await assertUploadNotFailed(page('上传失败',false));
});

test('network diagnostics aggregate and bound failures without leaking signed URLs or credentials',()=>{
 const entries=[];
 for(let i=0;i<2;i++)recordNetworkIssue(entries,'https://name:secret@vod.bytedanceapi.com/private?token=SECRET','xhr','http',403);
 assert.deepEqual(networkSummary(entries),[{hostname:'vod.bytedanceapi.com',resourceType:'xhr',reason:'http',status:403,count:2}]);
 assert.ok(!JSON.stringify(networkSummary(entries)).includes('SECRET'));
 recordNetworkIssue(entries,'invalid','xhr','dns');
 recordNetworkIssue(entries,'https://host.example','xhr','arbitrary secret');
 for(let i=0;i<100;i++)recordNetworkIssue(entries,`https://host${i}.example/path`,'fetch','policy');
 assert.equal(entries.length,80);
});
