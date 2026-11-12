// Never expose raw Playwright messages: they may contain page text, URLs or paths.
const codes = new Set(['browser_unavailable','login_required','qr_unavailable','human_required','identity_unverified','page_changed','publish_entry_ambiguous','publish_entry_unavailable','upload_control_ambiguous','upload_control_missing','collect_failed','collect_network_failed','collect_work_unavailable','collect_media_unavailable','collect_page_unreadable','collect_resources_blocked','unsupported_media','invalid_link','prepare_required','editor_mismatch','upload_failed','unknown']);
const stages = new Set(['browser_start','account_check','files_check','creator_home','publish_entry','upload_control','upload_files','editor_wait','fill_title','fill_caption','cover','visibility','upload_finish','editor_verify','preview']);
for(const code of ['visibility_control_missing','visibility_ambiguous','visibility_unverified']) codes.add(code);
for(const code of ['editor_title_mismatch','editor_caption_mismatch','editor_visibility_mismatch','editor_media_unverified','editor_media_changed'])codes.add(code);
codes.add('editor_unavailable');
export function publicFailure(error, stage='') {
 const message = typeof error?.message==='string' ? error.message : '';
 let reason='';
 if (/strict mode violation/i.test(message)) reason='multiple_matches';
 else if (/Target.*closed|browser.*closed|page.*closed|context.*closed/i.test(message)) reason='browser_closed';
 else if (/net::ERR_|NS_ERROR_|ECONN|ENOTFOUND/i.test(message)) reason='network';
 else if (error?.name==='TimeoutError'||/Timeout.*exceeded/i.test(message)) reason='timeout';
 else if (/ENOENT|EACCES|EPERM/i.test(message)) reason='file_access';
 else if (/not a function|Unknown engine|Unknown option/i.test(message)) reason='adapter_incompatible';
 return {error:codes.has(message)?message:'page_changed',...(stages.has(stage)?{stage}:{}),...(reason?{reason}:{})};
}
