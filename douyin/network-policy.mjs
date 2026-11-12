// Existing platform/API/media domains. Match DNS label boundaries, not substrings.
const platformDomains=['douyin.com','iesdouyin.com','douyincdn.com','douyinpic.com','douyinvod.com','byteimg.com','bytedance.com','bytedance.net','bytednsdoc.com','byted-static.com','bytedtos.com','ibytedtos.com','volccdn.com','volces.com','pstatp.com','snssdk.com','amemv.com','draftstatic.com','bdstatic.com','toutiao.com'];
// Exact resource hosts observed in the official public video document on
// 2026-10-09. Main runtime, player, CSS and official security/login UI must load.
// These additions apply to subresources only, never top-level navigation.
const resourceHosts=new Set([
 // Official creator main.4b3a5a71.js uploader configuration, checked 2026-10-15.
 // API requests only: these are not allowed as navigation destinations.
 'vod.bytedanceapi.com',
 'imagex.bytedanceapi.com',
 'open.bytedanceapi.com',
 'lf-douyin-pc-web.douyinstatic.com',
 'lf-fe-creator.douyinstatic.com',
 'auth.zijieapi.com',
 'lf1-cdn-tos.bytegoofy.com',
 'sf1-cdn-tos.douyinstatic.com',
 'lf-security.bytegoofy.com',
 'lf-c-flwb.bytetos.com',
 'lf-cdn-tos.bytescm.com',
 'lf-rc1.yhgfb-cn-static.com',
 'lf-ucenter-web.yhgfb-cn-static.com',
]);
export function allowedRequest(raw, type='document') {
 try {
  const u=new URL(raw);
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port)return false;
  if(platformDomains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))return true;
  return u.protocol==='https:' && type!=='document' && resourceHosts.has(u.hostname);
 } catch {return false;}
}
