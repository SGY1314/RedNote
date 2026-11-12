// Runs on a rendered option label, never reads framework/session state.
export function inspectVisibilityOption(element) {
 const choice = text => /^(?:公开|好友可见|私密|(?:仅|仅限|只有|只允许|只限)自己(?:可见)?)(?:$|[·:：,，(（-]|所有人|所有用户|所有观众|任何人|仅自己|只对自己|仅对自己|互关)/.test(text.replace(/\s/g,''));
 const labels = root => [...root.querySelectorAll('*')].filter(e => choice(e.textContent) && ![...e.children].some(c=>choice(c.textContent)));
 let root=element;
 for(let depth=0;root.parentElement && depth<10;depth++) {
  const parent=root.parentElement;
  if(labels(parent).length>1 || /^(BODY|HTML)$/.test(parent.tagName)) break;
  root=parent;
 }
 const nodes=[root,...root.querySelectorAll('*')];
 const semantic=[],styles=[],structure=[];
 // A <label for="..."> may point to an input outside the label subtree.
 const labelled=typeof element.closest==='function'?element.closest('label')?.control:null;
 if(labelled?.matches('input[type="radio"]')) {
  semantic.push(labelled.checked);
  structure.push({tag:'INPUT',role:'radio',radioClass:false,activeClass:false,signals:[labelled.checked?'associated_checked':'associated_unchecked']});
 }
 for(const e of nodes) {
  const signals=[];
  if(e.matches('input[type="radio"]')) {semantic.push(e.checked);signals.push(e.checked?'native_checked':'native_unchecked');}
  for(const attr of ['aria-checked','data-checked','data-selected']) {
   const v=e.getAttribute(attr);
   if(v==='true'||v==='false'){semantic.push(v==='true');signals.push(attr+'_'+v);}
  }
  const state=e.getAttribute('data-state');
  if(['checked','unchecked','selected','unselected'].includes(state)) {
   semantic.push(state==='checked'||state==='selected');signals.push('data-state_'+state);
  }
  const tokens=[...e.classList].flatMap(c=>c.replace(/([a-z])([A-Z])/g,'$1-$2').toLowerCase().split(/[-_]/));
  const negative=tokens.includes('unchecked')||tokens.includes('unselected');
  const positive=tokens.includes('checked')||tokens.includes('selected');
  if(negative) {styles.push(false);signals.push('class_unchecked');}
  if(positive) {styles.push(true);signals.push('class_checked');}
  // Diagnostics contain only structural enums, never page text, class names,
  // IDs, URLs, user-controlled attributes or credentials.
  if(structure.length<40)structure.push({
   tag:/^[A-Z][A-Z0-9]{0,15}$/.test(e.tagName)?e.tagName:'OTHER',
   role:['radio','radiogroup','button'].includes(e.getAttribute('role'))?e.getAttribute('role'):'other',
   radioClass:tokens.includes('radio'),activeClass:tokens.includes('active'),signals,
  });
 }
 const signals=semantic.length?semantic:styles;
 const values=new Set(signals);
 return {state:values.size===1?signals[0]:null,reason:values.size>1?'conflicting':signals.length?'verified':'missing',structure};
}
