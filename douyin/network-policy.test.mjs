import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedRequest} from './network-policy.mjs';

test('official creator uploader APIs allow signed upload requests, not navigation or lookalikes',()=>{
 for(const host of ['vod.bytedanceapi.com','imagex.bytedanceapi.com','open.bytedanceapi.com']) {
  for(const type of ['xhr','fetch']) {
   assert.equal(allowedRequest(`https://${host}/?Action=ApplyUploadInner&Signature=example`,type),true);
   assert.equal(allowedRequest(`https://${host}/?Action=CommitUploadInner`,type),true);
   assert.equal(allowedRequest(`https://${host}.evil.test/`,type),false);
   assert.equal(allowedRequest(`http://${host}/`,type),false);
   assert.equal(allowedRequest(`https://user:secret@${host}/`,type),false);
   assert.equal(allowedRequest(`https://${host}:8443/`,type),false);
  }
  assert.equal(allowedRequest(`https://${host}/`,'document'),false);
 }
 assert.equal(allowedRequest('https://unverified.bytedanceapi.com/','xhr'),false);
});

test('official video runtime, player, styles and security resources can load',()=>{
 const resources=[
  ['https://lf-fe-creator.douyinstatic.com/obj/douyn-creator-scm-cdn/douyin-creator-master-new/static/js/main.7059fb27.js','script'],
  ['https://auth.zijieapi.com/ucenter_web/app/douyin-login-new/dist/index.umd.production.js','script'],
  ['https://lf1-cdn-tos.bytegoofy.com/obj/goofy/secsdk/secsdk-lastest.umd.js','script'],
  ['https://lf-douyin-pc-web.douyinstatic.com/obj/douyin-pc-web/ies/douyin_web/runtime~client-entry.06a2b1d7.js','script'],
  ['https://lf-douyin-pc-web.douyinstatic.com/obj/douyin-pc-web/ies/douyin_web/player-0.1318e903.js','script'],
  ['https://lf-douyin-pc-web.douyinstatic.com/obj/douyin-pc-web/ies/douyin_web/static-style.b188ba12.css','stylesheet'],
  ['https://sf1-cdn-tos.douyinstatic.com/obj/accessibility-task-platform/entrance/a11y_web_init.js','script'],
  ['https://lf-security.bytegoofy.com/obj/security-secsdk/runtime_bundler_34.js','script'],
  ['https://lf-c-flwb.bytetos.com/obj/rc-client-security/c-webmssdk/1.0.0.20/webmssdk.es5.js','script'],
  ['https://lf-cdn-tos.bytescm.com/obj/static/filter-xss/filter-xss-lastest.umd.js','script'],
  ['https://lf-rc1.yhgfb-cn-static.com/obj/rc-verifycenter/sec_sdk_build/4.0.28/captcha/index.js','script'],
  ['https://lf-ucenter-web.yhgfb-cn-static.com/obj/passport-fe/lottie-no-amd.js','script'],
 ];
 for(const [url,type] of resources)assert.equal(allowedRequest(url,type),true,url);
});
test('new resource hosts do not allow arbitrary domains, credentials, ports or navigation',()=>{
 for(const url of ['https://evil.test/code.js','https://lf-douyin-pc-web.douyinstatic.com.evil.test/code.js','https://unverified.douyinstatic.com/code.js','https://user:secret@lf-douyin-pc-web.douyinstatic.com/code.js','https://lf-douyin-pc-web.douyinstatic.com:8443/code.js','http://lf-douyin-pc-web.douyinstatic.com/code.js','file:///etc/passwd','https://127.0.0.1/code.js'])assert.equal(allowedRequest(url,'script'),false,url);
 assert.equal(allowedRequest('https://lf-douyin-pc-web.douyinstatic.com/','document'),false);
 assert.equal(allowedRequest('https://www.douyin.com/video/7662401243356155190'),true);
 assert.equal(allowedRequest('https://v.douyinvod.com/video.mp4','media'),true);
});
