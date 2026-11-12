import test from 'node:test';
import assert from 'node:assert/strict';
import {readCaptionDOM,captionDifference} from './editor-caption.mjs';
import {assertEditorMatches,editorDiagnostic} from './editor-verification.mjs';
const text=s=>({nodeType:3,nodeValue:s,textContent:s});
function el(tag,children=[],attrs={}) {
 return {nodeType:1,tagName:tag,childNodes:children,firstChild:children[0],hasAttribute:k=>k in attrs,
  get textContent(){return children.map(n=>n.textContent).join('');}};
}
test('four paragraphs do not inherit the three additional CSS innerText newlines',()=>{
 const root=el('DIV',['正文','第一话题','第二话题','第三话题'].map(s=>el('P',[text(s)])));
 root.innerText='正文\n\n第一话题\n\n第二话题\n\n第三话题';
 const result=readCaptionDOM(root);
 assert.equal(result.dom,'正文\n第一话题\n第二话题\n第三话题');
 assert.equal(result.rendered.length-result.dom.length,3);
});
test('empty paragraphs, inline topics, BR line breaks and internal spaces remain',()=>{
 const root=el('DIV',[el('P',[text('第一  段'),el('BR'),text('下一行')]),el('P',[el('BR')]),el('P',[el('SPAN',[text('#话题')]),text(' 👩‍👩‍👧‍👧')])]);
 assert.equal(readCaptionDOM(root).dom,'第一  段\n下一行\n\n#话题 👩‍👩‍👧‍👧');
});
test('only explicit empty Slate scaffold characters are omitted, not actual text or emoji joiners',()=>{
 const root=el('DIV',[el('P',[text('正文'),el('SPAN',[text('\ufeff')],{'data-slate-zero-width':'z'})]),el('P',[text('保留\u200b文本'),el('SPAN',[text('真实文本')],{'data-slate-zero-width':'z'})])]);
 const result=readCaptionDOM(root);assert.equal(result.dom,'正文\n保留\u200b文本真实文本');assert.equal(result.removedScaffolds,1);
});
test('diagnostics describe character categories and stable snapshots exclude transient read evidence',()=>{
 const d=captionDifference('SECRET\n#topic','SECRET\n\n#topic');
 assert.equal(d.actualChanged.newlines,1);assert.doesNotMatch(JSON.stringify(d),/SECRET|topic/);
 const draft={title:'标题',caption:'SECRET\n#topic',visibility:'self',files:[{}],kind:'video'};
 const current={...draft,media:[{kind:'video',src:'blob:private'}],captionRead:{rendered:'SECRET\n\n#topic',removedScaffolds:0},mediaRead:[]};
 const diagnostic=editorDiagnostic(current,draft);
 assert.equal(diagnostic.caption.renderedDifference.actual.newlines,2);
 assert.doesNotMatch(JSON.stringify(diagnostic),/SECRET|topic|private/);
 const snapshot=assertEditorMatches(current,draft);assert.ok(!('captionRead' in snapshot));assert.ok(!('mediaRead' in snapshot));
 assert.throws(()=>assertEditorMatches({...current,caption:'SECRET #topic'},draft),/editor_caption_mismatch/);
});
