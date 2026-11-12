// Only browser representation differences are equivalent. Do not discard
// paragraph boundaries, punctuation, emoji joiners, topics or internal spaces.
import {captionDifference} from './editor-caption.mjs';
export const normalizeEditorText = value => String(value??'').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').trim();

export function compareEditorCaption(actual,expected) {
 const read=normalizeEditorText(actual),draft=normalizeEditorText(expected);
 if(read===draft)return {matches:true,canonical:draft,ignoredAddedZWSP:0};
 // Observed in the official editor: extra U+200B around text/topic runs.
 // Accept only when removing additions produces the exact original draft.
 // If the author supplied U+200B, require an exact match instead.
 if(!draft.includes('\u200b')&&read.includes('\u200b')&&read.replace(/\u200b/g,'')===draft) {
  return {matches:true,canonical:draft,ignoredAddedZWSP:(read.match(/\u200b/g)||[]).length};
 }
 return {matches:false,canonical:read,ignoredAddedZWSP:0};
}

export function readEditorMedia(elements,kind) {
 return elements.filter(e=>{
  const r=e.getBoundingClientRect();
  if(r.width>20&&r.height>20)return true;
  // A loaded video can sit behind its poster until the user presses play.
  // Require real video metadata plus a visible player/preview container.
  if(kind!=='video'||!(e.readyState>=1)||!(e.videoWidth>0&&e.videoHeight>0))return false;
  const container=e.closest?.('[class*="preview"], [class*="player"]');
  const box=container?.getBoundingClientRect();return !!box&&box.width>20&&box.height>20;
 }).map(e=>{
  const ownSource=typeof e.getAttribute==='function'?(e.getAttribute('src')?e.src:''):e.src;
  const source=kind==='video'?e.querySelector('source[src]'):null;
  const nestedSource=source&&(typeof source.getAttribute!=='function'||source.getAttribute('src'))?source.src:'';
  const src=e.currentSrc||ownSource||nestedSource;
  return src?{kind,src}:null;
 }).filter(Boolean);
}
export function inspectEditorMedia(elements) {
 return elements.slice(0,8).map(e=>{
  const r=e.getBoundingClientRect();
  return {kind:e.tagName==='VIDEO'?'video':'image',visibleSize:r.width>20&&r.height>20,
   hasCurrentSource:!!e.currentSrc,hasSourceAttribute:!!e.getAttribute('src'),hasSourceChild:!!e.querySelector('source[src]'),
   metadataReady:e.readyState>=1,hasVideoDimensions:e.videoWidth>0&&e.videoHeight>0};
 });
}
export function editorDiagnostic(current,draft) {
 const title=normalizeEditorText(current.title),caption=normalizeEditorText(current.caption);
 const captionMatch=compareEditorCaption(current.caption,draft.caption);
 return {
  schema:3,kind:draft.kind==='video'?'video':'image',
  title:{matches:title===normalizeEditorText(draft.title),expectedLength:[...normalizeEditorText(draft.title)].length,actualLength:[...title].length},
  caption:{matches:captionMatch.matches,ignoredAddedZWSP:captionMatch.ignoredAddedZWSP,expectedLength:[...normalizeEditorText(draft.caption)].length,actualLength:[...caption].length,
   difference:captionDifference(normalizeEditorText(draft.caption),caption),
   ...(current.captionRead?{renderedDifference:captionDifference(normalizeEditorText(draft.caption),normalizeEditorText(current.captionRead.rendered)),removedScaffolds:current.captionRead.removedScaffolds}:{}),
  },
  visibilityMatches:current.visibility===draft.visibility,
  media:{expectedCount:draft.files.length,actualCount:current.media.length,kindMatches:current.media.every(m=>m.kind===draft.kind),...(current.mediaRead?{elements:current.mediaRead}:{})},
 };
}
export function assertEditorMatches(current,draft) {
 const diagnostic=editorDiagnostic(current,draft);
 const code=!diagnostic.title.matches?'editor_title_mismatch':
  !diagnostic.caption.matches?'editor_caption_mismatch':
  !diagnostic.visibilityMatches?'editor_visibility_mismatch':
  diagnostic.media.actualCount!==diagnostic.media.expectedCount||!diagnostic.media.kindMatches?'editor_media_unverified':'';
 if(code){const e=Error(code);e.diagnostic=diagnostic;throw e;}
 const {captionRead,mediaRead,...snapshot}=current;
 return {...snapshot,title:normalizeEditorText(current.title),caption:compareEditorCaption(current.caption,draft.caption).canonical};
}
export async function waitForEditorMatch(read,draft,human,wait) {
 let lastError;
 for(let attempt=0;attempt<20;attempt++) {
  await human();
  const current=await read();
  try{return assertEditorMatches(current,draft);}catch(e){if(!e.diagnostic)throw e;lastError=e;}
  if(attempt<19)await wait(250);
 }
 throw lastError;
}
