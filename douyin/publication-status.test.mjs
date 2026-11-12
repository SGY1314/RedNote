import test from 'node:test';
import assert from 'node:assert/strict';
import {publicationState,readPublicationState} from './publication-status.mjs';

test('status must be an exact unambiguous dedicated label',()=>{
  assert.equal(publicationState([' 已发布 ']),'published');
  assert.equal(publicationState(['审核中']),'submitted');
  assert.equal(publicationState(['审核不通过']),'rejected');
  assert.equal(publicationState(['审核未通过']),'rejected');
  for(const labels of [[],['审核不通过怎么办'],['审核中如何修改文案'],['已发布','审核不通过'],['审核不通过怎么办\n已发布']]) assert.throws(()=>publicationState(labels),/page_changed/);
});

test('read status excludes titles, captions, hidden labels and unrelated row text',async()=>{
  const node=(text,excluded=false,visible=true)=>({innerText:text,closest:()=>excluded?{}:null,getClientRects:()=>visible?[{}]:[],style:{visibility:'visible',display:'block',opacity:'1'}});
  const previous=globalThis.getComputedStyle;
  globalThis.getComputedStyle=n=>n.style;
  try {
    const row={evaluate:fn=>fn({innerText:'审核不通过怎么办\n已发布',querySelectorAll:selector=>{
      assert.ok(selector.includes('[role="status"]'));
      return [node('审核不通过',true),node('审核中',true),node('未通过',false,false),node('已发布')];
    }})};
    assert.equal(await readPublicationState(row),'published');
    await assert.rejects(()=>readPublicationState({evaluate:fn=>fn({innerText:'已发布',querySelectorAll:()=>[]})}),/page_changed/);
  } finally {if(previous)globalThis.getComputedStyle=previous;else delete globalThis.getComputedStyle;}
});
