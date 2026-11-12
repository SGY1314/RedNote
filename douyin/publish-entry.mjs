// Exact homepage labels observed in the supplied creator-center screenshot.
// Do not match "发布全景视频" or click an arbitrary duplicate entry.
export async function openPublishingEntry(page, kind, checkHuman) {
 if (!['image','video'].includes(kind)) throw Error('unsupported_media');
 const label = kind === 'video' ? /^(发布高清视频|发布视频)$/ : /^发布图文$/;
 const entry = page.getByText(label).filter({visible:true});
 for (let attempt=0; attempt<60; attempt++) {
  await checkHuman(page);
  const count = await entry.count();
  if (count>1) throw Error('publish_entry_ambiguous');
  if (count===1 && await entry.isEnabled()) {
   try { await entry.click({timeout:10000}); }
   catch { await checkHuman(page); throw Error('publish_entry_unavailable'); }
   return;
  }
  await page.waitForTimeout(250);
 }
 throw Error('publish_entry_unavailable');
}

export async function waitUploadInput(page, checkHuman) {
 const input = page.locator('input[type="file"]:not([disabled])');
 // File inputs can be hidden; visibility is not evidence of upload readiness.
 for (let attempt=0; attempt<80; attempt++) {
  await checkHuman(page);
  const count = await input.count();
  if (count>1) throw Error('upload_control_ambiguous');
  if (count===1) return input;
  await page.waitForTimeout(250);
 }
 throw Error('upload_control_missing');
}
