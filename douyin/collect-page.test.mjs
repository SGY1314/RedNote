import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readRenderedVideo,responseVideo} from './collect-page.mjs';
import {normalizeVideo} from './protocol.mjs';

const id='7677020830546595082';
// DOM boundary fixture from the publicly rendered detail page: stable data-e2e
// roles, exact player class ID, and unrelated recommended content outside it.
function fixture({playerID=id,target=id,videoCount=1,likes='2779',heading=true,media='https://www.douyin.com/aweme/v1/play/?target='+target}={}) {
 const node=(text='',one={},many={},attrs={})=>({textContent:text,querySelector:s=>one[s]||null,querySelectorAll:s=>many[s]||[],getAttribute:s=>attrs[s]||null});
 const title=node('第16集 | 萧道成如何一步步取代刘宋？ #历史',{}, {'a':[node('#历史')]});
 const info=node('',{'h1':heading?title:null,'[data-e2e="detail-video-publish-time"]':node('发布时间：2026-08-23 11:30')});
 const video={currentSrc:media,poster:'',getAttribute:()=>null};
 const player=node('',{}, {'video':Array.from({length:videoCount},()=>video),'img[src]':[node('',{},{},{src:'https://p3.douyinpic.com/cover.jpg?sc=origin_cover'})]});
 const author=node('历史等高线',{},{},{href:'//www.douyin.com/user/MS4wExample'});
 const root=node('',{['[data-e2e="player-container"].video_'+playerID]:player,'[data-e2e="detail-video-info"]':info},{
  '[data-e2e="video-player-digg"]':[node(likes)],'[data-e2e="video-player-collect"]':[node('540')],
  '[data-e2e="user-info"] a[href*="/user/"]':[author,author]});
 const document=node('',{}, {'[data-e2e="video-detail"]':[root],video:[{currentSrc:'https://v.douyinvod.com/unrelated.mp4'}]});
 return JSON.parse(JSON.stringify(vm.runInNewContext('('+readRenderedVideo.toString()+')(expected)',{document,location:{href:'https://www.douyin.com/video/'+id},expected:id,URL})));
}
test('rendered video succeeds without a detail API response, excluding unrelated content',()=>{
 const d=fixture();const r=normalizeVideo(d,id);
 assert.equal(r['作品ID'],id);assert.match(r['作品描述'],/萧道成/);assert.equal(r['作者昵称'],'历史等高线');
 assert.equal(r['发布时间'],'2026-08-23T03:30:00.000Z');assert.equal(r['点赞数量'],2779);assert.equal(r['收藏数量'],540);assert.equal(r['评论数量'],null);
 assert.equal(r['下载地址'].length,1);assert.ok(!JSON.stringify(r).includes('unrelated'));assert.deepEqual(r['作品标签'],['历史']);assert.match(r['封面地址'],/cover.jpg/);
});
test('refuses wrong work, mismatched media, ambiguous player, and unplayable blob',()=>{
 for(const options of [{playerID:'7999999999999999999'},{target:'7999999999999999999'},{videoCount:2},{videoCount:0},{heading:false},{media:'blob:https://www.douyin.com/opaque'},{media:'http://localhost/video'}])assert.equal(fixture(options),null);
});
test('rounded or missing interaction counts remain unknown, exact zero remains zero',()=>{
 assert.equal(normalizeVideo(fixture({likes:'1.2万'}),id)['点赞数量'],null);
 assert.equal(normalizeVideo(fixture({likes:'0'}),id)['点赞数量'],0);
});
test('network response selection must match resolved requested ID, not recommendation order',()=>{
 const requested={aweme_id:id};const other={aweme_id:'7999999999999999999'};
 assert.equal(responseVideo({status_code:0,aweme_list:[other,requested]},id),requested);
 assert.equal(responseVideo({status_code:0,awemeDetail:requested},id),requested);
 assert.equal(responseVideo({status_code:1,aweme_detail:requested},id),null);
 assert.equal(responseVideo({status_code:0,aweme_detail:other},id),null);
 assert.equal(responseVideo({status_code:0,aweme_detail:requested},''),null);
 assert.equal(responseVideo({status_code:0,aweme_detail:{aweme_id:Number(id)}},id),null);
});
