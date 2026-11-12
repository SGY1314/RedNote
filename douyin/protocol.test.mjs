import test from 'node:test';
import assert from 'node:assert/strict';
import {videoURL,canonicalVideoURL,normalizeVideo,verifiedAccount,accountProgress,receiptFrom} from './protocol.mjs';
test('jingxuan modal links resolve to the exact work without numeric rounding',()=>{
 const id='7677020830546595082';
 for(const path of ['/jingxuan','/jingxuan/','/']) {
  const raw='https://www.douyin.com'+path+'?modal_id='+id+'&from=web';
  assert.equal(videoURL(raw),id);
  assert.equal(canonicalVideoURL(raw),'https://www.douyin.com/video/'+id);
 }
 for(const raw of ['https://www.douyin.com/jingxuan','https://www.douyin.com/jingxuan?modal_id=oops','https://www.douyin.com/jingxuan?modal_id='+id+'&modal_id='+id,'https://douyin.com.evil.test/jingxuan?modal_id='+id])assert.throws(()=>videoURL(raw));
});
test('strict official URL parsing and numeric identity',()=>{
 assert.equal(videoURL('https://www.douyin.com/video/7123456789012345678'),'7123456789012345678');
 assert.equal(videoURL('https://v.douyin.com/Abc123/'),'');
 for(const u of ['https://douyin.com.evil.test/video/7123456789012345678','https://user@www.douyin.com/video/7123456789012345678','https://www.douyin.com/user/test'])assert.throws(()=>videoURL(u));
});
test('search result modal links normalize to the work, ignoring search tracking parameters',()=>{
 const id='7590997226031002619';
 const raw='https://www.douyin.com/jingxuan/search/%E5%89%AA%E8%BE%91?aid=f0f214a9-b9d2-4da4-9100-54e059616b06&modal_id='+id+'&type=general';
 for(const input of [raw,'https://www.douyin.com/search/剪辑?modal_id='+id,'https://www.douyin.com/jingxuan/search/剪辑/?modal_id='+id]){
  assert.equal(videoURL(input),id);
  assert.equal(canonicalVideoURL(input),'https://www.douyin.com/video/'+id);
 }
 for(const input of [raw+'&modal_id='+id,raw.replace(id,'bad'),raw.replace('www.douyin.com','www.douyin.com.evil.test'),'https://www.douyin.com/jingxuan/search/剪辑','https://www.douyin.com/jingxuan/search/?modal_id='+id,'https://www.douyin.com/jingxuan/search/%2F?modal_id='+id])assert.throws(()=>videoURL(input));
});
test('creator identity is sufficient; cookies and main-site identity are insufficient',()=>{
 assert.throws(()=>verifiedAccount({uid:'123'},{sessionid:'secret'}));
 assert.throws(()=>verifiedAccount({uid:'123'},undefined));
 for(const creator of [{uid:12345678901234567890,nickname:'Name'},{uid:'bad',nickname:'Name'},{uid:'123',nickname:' '}])assert.throws(()=>verifiedAccount(undefined,creator));
 assert.equal(verifiedAccount(undefined,{uid:'123',nickname:'Name'}).state,'success');
 assert.equal(verifiedAccount({uid:'123'},{uid:'124',nickname:'Name'}).user_id,'124');
 assert.equal(verifiedAccount({uid:'123'},{uid:'124',nickname:'Name'}).main_verified,false);
 assert.equal(verifiedAccount({uid:'123'},{uid:'123',nickname:'Name'}).state,'success');
});
test('creator scan connects immediately while missing creator identity stays unverified',()=>{
 assert.deepEqual(accountProgress(undefined,{uid:'123',nickname:'Creator'}),{user_id:'123',username:'Creator',is_logged_in:true,main_verified:false,creator_verified:true,state:'success'});
 assert.deepEqual(accountProgress({uid:'123'},undefined),{user_id:'123',username:'',is_logged_in:false,main_verified:true,creator_verified:false,state:'main_connected'});
 assert.equal(accountProgress({uid:'123'},{uid:'124',nickname:'Other'}).user_id,'124');
 assert.equal(accountProgress(undefined,undefined).state,'unverified');
 assert.equal(accountProgress(undefined,{uid:'bad-id',nickname:'Invalid'}).state,'unverified');
 assert.equal(accountProgress({uid:'123'},{uid:'123',nickname:'Same'}).state,'success');
});
test('video normalization excludes secrets and preserves unknown metrics',()=>{
 const d={aweme_id:'7123456789012345678',desc:'full text',video:{play_addr:{url_list:['https://v.douyinvod.com/a.mp4']}},statistics:{digg_count:0},params:{cookie:'SECRET'}};
 const r=normalizeVideo(d,d.aweme_id);assert.equal(r['点赞数量'],0);assert.equal(r['收藏数量'],null);assert.ok(!JSON.stringify(r).includes('SECRET'));assert.throws(()=>normalizeVideo({...d,aweme_id:Number(d.aweme_id)}));assert.throws(()=>normalizeVideo({...d,images:[{}]}));assert.throws(()=>normalizeVideo(d,'7999999999999999999'));
});
test('only reliable submit receipt; never infer published from upload',()=>{
 for(const r of [{success:true},{status_code:0},{status_code:0,data:{aweme_id:7123456789012345678}},{status_code:1,data:{aweme_id:'7123456789012345678'}}])assert.throws(()=>receiptFrom(r));
 assert.deepEqual(receiptFrom({status_code:0,data:{aweme_id:'7123456789012345678'}}),{work_id:'7123456789012345678',state:'submitted'});
});
