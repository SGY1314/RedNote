export function qrState(text, hasQR, startedAt, now=Date.now()) {
 if (/扫码成功|请在手机上确认|请在抖音.*确认/.test(text)) return 'waiting_confirm';
 if (/二维码(?:已)?(?:失效|过期)/.test(text)) return 'expired';
 if (hasQR) return startedAt && now-startedAt>180000 ? 'expired' : 'waiting_scan';
 // No QR may mean navigation after authentication. Verify identity next,
 // rather than treating a refresh button or the old timer as proof of expiry.
 return '';
}

export async function captureLoginQR(page) {
 const image=page.getByRole('img',{name:'二维码',exact:true}).filter({visible:true}).first();
 // The current official landing page already contains a QR. Do not open a
 // second login dialog over it, which would make the selected QR ambiguous.
 try {await image.waitFor({state:'visible',timeout:8000});}
 catch {
  const entry=page.getByRole('button',{name:'登录后使用丰富的作品体裁'});
  if(!await entry.isVisible().catch(()=>false))throw Error('qr_unavailable');
  await entry.click();
  try{await image.waitFor({state:'visible',timeout:12000});}catch{throw Error('qr_unavailable')}
 }
 for(let i=0;i<30;i++) {
  if(await image.evaluate(el=>el.tagName==='IMG'&&el.complete&&el.naturalWidth>0&&el.naturalHeight>0).catch(()=>false)) {
   return 'data:image/png;base64,'+(await image.screenshot()).toString('base64');
  }
  await page.waitForTimeout(200);
 }
 throw Error('qr_unavailable');
}
