import test from 'node:test';
import assert from 'node:assert/strict';
import {assertEditorMatches,editorDiagnostic,normalizeEditorText,readEditorMedia,waitForEditorMatch,compareEditorCaption} from './editor-verification.mjs';
import {publicFailure} from './errors.mjs';
const draft={title:'演示标题',caption:'第一段\n第二段 #话题',visibility:'self',kind:'video',files:[{}]};
const snapshot=()=>({title:draft.title,caption:draft.caption,visibility:draft.visibility,media:[{kind:'video',src:'blob:video'}]});
test('browser newline and nonbreaking-space representations compare symmetrically',()=>{
 const d={...draft,caption:'第一段\r\n第二段 #话题'};
 const current={...snapshot(),caption:' 第一段\n第二段\u00a0#话题\n'};
 assert.equal(assertEditorMatches(current,d).caption,draft.caption);
 assert.equal(normalizeEditorText('👩‍👩‍👧‍👧'), '👩‍👩‍👧‍👧');
 for(const caption of ['第一段 第二段 #话题','第一段\n第二段','第一段\n第二段  #话题','第一段\n第二段 #其他话题']) {
  assert.throws(()=>assertEditorMatches({...snapshot(),caption},draft),/editor_caption_mismatch/);
 }
});
test('verification identifies changed fields, empty media and incorrect media type/count',()=>{
 const cases=[
  [{title:'演示'},'editor_title_mismatch'],[{caption:''},'editor_caption_mismatch'],
  [{visibility:'public'},'editor_visibility_mismatch'],[{media:[]},'editor_media_unverified'],
  [{media:[{kind:'image',src:'cover.png'}]},'editor_media_unverified'],
  [{media:[{kind:'video',src:'a'},{kind:'video',src:'b'}]},'editor_media_unverified'],
 ];
 for(const [change,code] of cases){
  assert.throws(()=>assertEditorMatches({...snapshot(),...change},draft),e=>{
   assert.equal(e.message,code);assert.ok(e.diagnostic);assert.equal(publicFailure(e).error,code);return true;
  });
 }
 const images={...draft,kind:'image',files:[{},{}]};
 assert.doesNotThrow(()=>assertEditorMatches({...snapshot(),media:[{kind:'image',src:'a'},{kind:'image',src:'b'}]},images));
});
test('video source children are accepted; missing source, zero-sized and poster-only players are not',()=>{
 const element=(props={})=>({currentSrc:'',src:'',poster:'cover.png',getBoundingClientRect:()=>({width:400,height:300}),querySelector:()=>null,...props});
 assert.deepEqual(readEditorMedia([element({querySelector:()=>({src:'blob:source'})})],'video'),[{kind:'video',src:'blob:source'}]);
 assert.deepEqual(readEditorMedia([element(),element({src:'blob:video',getBoundingClientRect:()=>({width:0,height:0})})],'video'),[]);
 assert.deepEqual(readEditorMedia([element({src:'https://creator.douyin.com/editor',getAttribute:()=>''})],'video'),[]);
 assert.deepEqual(readEditorMedia([element({currentSrc:'blob:active',src:'blob:old'})],'video'),[{kind:'video',src:'blob:active'}]);
});
test('delayed editor state settles without refilling or silently accepting persistent differences',async()=>{
 let reads=0,waits=0,human=0;
 const result=await waitForEditorMatch(async()=>++reads<3?{...snapshot(),caption:''}:snapshot(),draft,async()=>{human++;},async()=>{waits++;});
 assert.equal(result.caption,draft.caption);assert.equal(reads,3);assert.equal(waits,2);assert.equal(human,3);
 reads=0;
 await assert.rejects(waitForEditorMatch(async()=>{reads++;return {...snapshot(),title:'被截断'};},draft,async()=>{},async()=>{}),/editor_title_mismatch/);
 assert.equal(reads,20);
 await assert.rejects(waitForEditorMatch(async()=>snapshot(),draft,async()=>{throw Error('human_required');},async()=>{}),/human_required/);
});
test('diagnostics expose counts and equality only, never text or media addresses',()=>{
 const secret={...draft,title:'SECRET-TITLE',caption:'SECRET-CAPTION'};
 const diagnostic=editorDiagnostic({...snapshot(),title:'SECRET-OTHER',media:[{kind:'video',src:'https://secret/?token=SECRET'}]},secret);
 assert.equal(diagnostic.title.matches,false);
 assert.doesNotMatch(JSON.stringify(diagnostic),/SECRET|https:|token|blob:/);
});
test('hidden player needs loaded metadata and a visible preview container, not just a poster',()=>{
 const video={currentSrc:'blob:loaded-video',getBoundingClientRect:()=>({width:0,height:0}),readyState:1,videoWidth:720,videoHeight:1280,
  querySelector:()=>null,closest:()=>({getBoundingClientRect:()=>({width:400,height:300})})};
 assert.equal(readEditorMedia([video],'video').length,1);
 for(const patch of [{readyState:0},{readyState:undefined},{videoWidth:0},{closest:()=>null}])assert.equal(readEditorMedia([{...video,...patch}],'video').length,0);
});
test('observed 38-to-41 character regression accepts only three added U+200B and preserves snapshot',()=>{
 const body='文'.repeat(26),caption=body+'\n#春日生活\n#日常记录';
 const actual=body+'\u200b\n#春日生活\u200b\n#日常记录\u200b';
 assert.equal([...caption].length,38);assert.equal([...actual].length,41);
 const expected={...draft,caption},current={...snapshot(),caption:actual};
 const detail=editorDiagnostic(current,expected);
 assert.equal(detail.caption.matches,true);assert.equal(detail.caption.ignoredAddedZWSP,3);
 assert.equal(assertEditorMatches(current,expected).caption,caption);
 assert.throws(()=>assertEditorMatches({...current,caption:actual.replace('春','秋')},expected),/editor_caption_mismatch/);
 assert.throws(()=>assertEditorMatches({...current,media:[]},expected),/editor_media_unverified/);
});
test('zero-width-space compatibility cannot hide deletions, punctuation, spacing or emoji changes',()=>{
 for(const [expected,actual] of [
  ['正文\n#话题','正文\u200b#话题'],['正文 #话题','正文\u200b#话题'],
  ['正文。','正文\u200b'],['👩‍👩‍👧‍👧','👩👩👧👧\u200b'],
  ['a\u200bb','ab'],['a\u200bb','a\u200b\u200bb'],
  ['正文','正文\u200c'],['正文','正文\u200d'],
 ])assert.equal(compareEditorCaption(actual,expected).matches,false);
 assert.equal(compareEditorCaption('a\u200bb','a\u200bb').matches,true);
});
