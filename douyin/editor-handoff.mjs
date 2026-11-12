const reviewable=new Set(['editor_title_mismatch','editor_caption_mismatch','editor_visibility_mismatch','editor_media_unverified']);
// This is a handoff, never a successful publication or an automatic-submit token.
export function manualEditorResult(error,draft,account) {
 if(!reviewable.has(error?.message))throw error;
 return {manual_review:true,review_reason:error.message,verified:false,publication_id:draft.publication_id,account};
}
export async function openDraftEditor(page,requestedID,currentID) {
 if(!requestedID||requestedID!==currentID||!page||page.isClosed())throw Error('editor_unavailable');
 let u;try{u=new URL(page.url());}catch{throw Error('editor_unavailable');}
 if(u.origin!=='https://creator.douyin.com'||await page.getByPlaceholder(/填写作品标题|填写标题/).filter({visible:true}).count()!==1)throw Error('editor_unavailable');
 await page.bringToFront();
}
