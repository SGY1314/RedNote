// Serialize the editable DOM rather than CSS-dependent innerText (which can
// insert two newlines between paragraphs). Preserve empty paragraphs and emoji.
export function readCaptionDOM(root) {
 const blocks=new Set(['P','DIV','LI','H1','H2','H3','H4','H5','H6','PRE','BLOCKQUOTE']);
 let removedScaffolds=0;
 const serialize=element=>{
  if(element.nodeType===3)return element.nodeValue||'';
  if(element.nodeType!==1)return '';
  if(element.hasAttribute('data-slate-zero-width') && /^[\u200b\ufeff]*$/.test(element.textContent||'')) {
   removedScaffolds++;return '';
  }
  if(element.tagName==='BR')return '\n';
  // An empty paragraph's placeholder BR does not add a second paragraph.
  if(blocks.has(element.tagName)&&element.childNodes.length===1&&element.firstChild.tagName==='BR')return '';
  const parts=[...element.childNodes].map(node=>({block:blocks.has(node.tagName),text:serialize(node)}));
  let text='';
  for(let i=0;i<parts.length;i++) {
   if(i>0&&(parts[i-1].block||parts[i].block))text+='\n';
   text+=parts[i].text;
  }
  return text;
 };
 return {dom:serialize(root),rendered:root.innerText,removedScaffolds};
}

export function captionDifference(expected,actual) {
 const a=[...expected],b=[...actual];let prefix=0,suffix=0;
 while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;
 while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
 const summary=s=>({length:[...s].length,newlines:(s.match(/\n/g)||[]).length,spaces:(s.match(/ /g)||[]).length,nbsp:(s.match(/\u00a0/g)||[]).length,zwsp:(s.match(/\u200b/g)||[]).length,bom:(s.match(/\ufeff/g)||[]).length});
 return {expected:summary(expected),actual:summary(actual),commonPrefix:prefix,commonSuffix:suffix,
  expectedChanged:summary(a.slice(prefix,a.length-suffix).join('')),actualChanged:summary(b.slice(prefix,b.length-suffix).join(''))};
}
