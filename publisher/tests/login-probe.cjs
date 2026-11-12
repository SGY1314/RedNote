const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const probe=fs.readFileSync(require('node:path').join(__dirname,'../upstream/xiaohongshu/login_probe.js'),'utf8');
const id='0123456789abcdef01234567';
function element(text,extra={}){return {innerText:text,getClientRects:()=>[{}],...extra};}
function run({info,root,links=[],dialog=[],captcha=[],hostname='www.xiaohongshu.com',login=[]}={}){
 const ctx={URL,window:{__INITIAL_STATE__:root||{user:{userInfo:info}}},location:{hostname,origin:'https://'+hostname,href:'https://'+hostname+'/explore'},getComputedStyle:()=>({visibility:'visible',display:'block'}),document:{querySelectorAll:selector=>selector.startsWith('nav ')?links:selector.startsWith('iframe')?captcha:selector==='.login-container'?login:dialog}};
 return JSON.parse(JSON.stringify(vm.runInNewContext('('+probe+')()',ctx)));
}
assert.equal(run({info:{value:{userId:id,nickname:'甲',guest:false}}}).state,'authenticated');
assert.equal(run({root:{user:{value:{userInfo:{user_id:id,nickname:'甲'}}}}}).userId,id);
assert.equal(run({info:{userId:id,guest:true}}).state,'waiting_scan');
assert.equal(run({info:{userId:id,guest:'true'}}).state,'waiting_scan');
assert.equal(run({root:{note:{author:{userId:id}}}}).state,'waiting_scan');
assert.equal(run({links:[element('我',{href:'https://www.xiaohongshu.com/user/profile/'+id})]}).state,'authenticated');
assert.equal(run({links:[element('博主甲',{href:'https://www.xiaohongshu.com/user/profile/'+id})]}).state,'waiting_scan');
assert.equal(run({links:[element('我',{href:'https://evil.example/user/profile/'+id})]}).state,'waiting_scan');
assert.equal(run({info:{userId:id},login:[element('登录')]}).state,'waiting_scan');
assert.equal(run({dialog:[element('扫码成功，请在手机确认登录')]}).state,'verifying');
assert.equal(run({dialog:[element('安全验证，请拖动滑块')]}).state,'verification_required');
assert.equal(run({dialog:[element('二维码已过期')]}).state,'expired');
assert.equal(run({info:{userId:id},hostname:'evil.example'}).state,'verification_required');
assert.equal(run({info:{userId:'bad-id'}}).state,'waiting_scan');
console.log('PASS: current-user state, Vue wrappers, own-profile link, guest/author/login-modal rejection, official verification and QR expiry.');
