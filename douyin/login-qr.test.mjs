import test from 'node:test';
import assert from 'node:assert/strict';
import {captureLoginQR,qrState} from './login-qr.mjs';

test('refresh label alone is not expiry; absent QR triggers identity verification',()=>{
 assert.equal(qrState('刷新二维码',true,1000,2000),'waiting_scan');
 assert.equal(qrState('二维码已失效，点击刷新',true,1000,2000),'expired');
 assert.equal(qrState('二维码过期',true,1000,2000),'expired');
 assert.equal(qrState('请在手机上确认',true,1000,200000),'waiting_confirm');
 assert.equal(qrState('',true,1000,200000),'expired');
 assert.equal(qrState('创作管理',false,1000,200000),'');
});

function pageFixture({inline=true,readyAfter=0,broken=false}={}){
 let open=inline,checks=0,clicks=0,shots=0;
 const img={filter(){return this},first(){return this},async waitFor(){if(!open)throw Error('not visible')},async evaluate(){checks++;return !broken&&checks>readyAfter},async screenshot(){shots++;return Buffer.from('qr-pixels')}};
 const button={async isVisible(){return true},async click(){clicks++;open=true}};
 return {page:{getByRole:role=>role==='img'?img:button,async waitForTimeout(){}},stats:()=>({checks,clicks,shots})};
}
test('use existing official inline QR and wait for loaded pixels before screenshot',async()=>{
 const f=pageFixture({readyAfter:2});
 const result=await captureLoginQR(f.page);
 assert.match(result,/^data:image\/png;base64,/);assert.deepEqual(f.stats(),{checks:3,clicks:0,shots:1});
});
test('open login entry only when there is no inline QR',async()=>{
 const f=pageFixture({inline:false});await captureLoginQR(f.page);
 assert.equal(f.stats().clicks,1);assert.equal(f.stats().shots,1);
});
test('never return an empty or broken QR image as successful login preparation',async()=>{
 const f=pageFixture({broken:true});await assert.rejects(captureLoginQR(f.page),/qr_unavailable/);
 assert.equal(f.stats().shots,0);
});
