import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {accountProgress} from './protocol.mjs';
import {qrState} from './login-qr.mjs';

const source=readFileSync(new URL('./worker.mjs',import.meta.url),'utf8');
const loginStatusCode=source.slice(source.indexOf('async function loginStatus(){'),source.indexOf('\nasync function clickUnique('));
const dispatchCode=source.slice(source.indexOf('async function dispatch(m){'),source.indexOf('\nconst input='));

function fixture() {
 let hasQR=true;
 const scope={
  creatorIdentity:undefined,mainIdentity:undefined,loginAt:Date.now(),
  empty:()=>({is_logged_in:false,state:'logged_out'}),
  human:async()=>{},accountProgress,qrState,
  page:{
   isClosed:()=>false,url:()=> 'https://creator.douyin.com/',
   locator:()=>({innerText:async()=>''}),
   getByRole:()=>({filter(){return this},count:async()=>Number(hasQR)}),
  },
  qr:async()=>({is_logged_in:false,state:'waiting_scan',img:'qr-pixels'}),
 };
 return {scope,setQR:value=>{hasQR=value},loginStatus:vm.runInNewContext('('+loginStatusCode+')',scope)};
}

test('automatic login observes the existing creator tab without opening account probes',async()=>{
 const f=fixture();
 assert.equal((await f.loginStatus()).state,'waiting_scan');
 f.setQR(false);
 assert.equal((await f.loginStatus()).state,'verifying');
 f.scope.creatorIdentity={uid:'123',nickname:'创作者'};
 const connected=await f.loginStatus();
 assert.equal(connected.state,'success');
 assert.equal(connected.user_id,'123');
});

test('official verification and an unscanned QR keep the same login session',async()=>{
 const f=fixture();
 f.scope.human=async()=>{throw Error('human_required')};
 assert.equal((await f.loginStatus()).state,'verification_required');
 f.scope.human=async()=>{};
 f.scope.loginAt=0;
 const status=await f.loginStatus();
 assert.equal(status.state,'waiting_scan');
 assert.equal(status.img,undefined);
});

test('starting a scan opens the dedicated visible browser before taking its QR',async()=>{
 let closed=0,navigated=0;
 const starts=[];
 const order=[];
 const scope={
  visible:false,prepared:undefined,loginAt:0,mainIdentity:undefined,creatorIdentity:undefined,
  browser:{isConnected:()=>true,close:async()=>{closed++}},
  context:{storageState:async()=>({cookies:[]})},page:{isClosed:()=>false,bringToFront:async()=>order.push('foreground')},mainPage:undefined,
  start:async(storage)=>{
   starts.push({visible:scope.visible,storage});
   scope.browser={isConnected:()=>true};
   scope.context={storageState:async()=>({cookies:[]})};
   scope.page={isClosed:()=>false,bringToFront:async()=>order.push('foreground')};
  },
  creatorHome:async()=>{navigated++;order.push('navigate')},
  qr:async()=>{order.push('qr_ready');return {state:'waiting_scan',is_logged_in:false,img:'official-qr'}},
 };
 const dispatch=vm.runInNewContext('('+dispatchCode+')',scope);
 const result=await dispatch({op:'login',storage:{cookies:[]}});
 assert.equal(closed,1);
 assert.ok(starts.length>=1);
 assert.ok(starts.every(x=>x.visible));
 assert.equal(navigated,1);
 assert.equal(result.data.img,'official-qr');
 assert.deepEqual(order,['navigate','qr_ready','foreground']);
});

test('status polling does not recreate a closed scan tab',async()=>{
 let starts=0;
 const scope={
  visible:true,prepared:undefined,
  browser:{isConnected:()=>true},
  context:{storageState:async()=>({cookies:[]})},
  page:{isClosed:()=>true,url:()=> 'https://creator.douyin.com/'},
  start:async()=>{starts++},
  loginStatus:async()=>({is_logged_in:false,state:'unverified'}),
 };
 const dispatch=vm.runInNewContext('('+dispatchCode+')',scope);
 const result=await dispatch({op:'login_status'});
 assert.equal(starts,0);
 assert.equal(result.data.state,'unverified');
 assert.equal(result.storage,undefined);
});

test('a confirmed login persists its browser session',async()=>{
 let saved=0;
 const scope={
  visible:true,prepared:undefined,
  browser:{isConnected:()=>true},
  context:{storageState:async()=>{saved++;return {cookies:[]}}},
  page:{isClosed:()=>false,url:()=> 'https://creator.douyin.com/'},
  start:async()=>{throw Error('status poll must not start browser')},
  loginStatus:async()=>({is_logged_in:true,state:'success',user_id:'123'}),
 };
 const dispatch=vm.runInNewContext('('+dispatchCode+')',scope);
 const result=await dispatch({op:'login_status'});
 assert.equal(result.data.state,'success');
 assert.equal(saved,1);
 assert.equal(result.storage.cookies.length,0);
});

test('status polling without a browser does not start one',async()=>{
 let starts=0;
 const scope={
  visible:true,prepared:undefined,browser:undefined,context:undefined,page:undefined,
  start:async()=>{starts++},
  loginStatus:async()=>({is_logged_in:false,state:'unverified'}),
 };
 const dispatch=vm.runInNewContext('('+dispatchCode+')',scope);
 const result=await dispatch({op:'login_status'});
 assert.equal(starts,0);
 assert.equal(result.data.state,'unverified');
 assert.equal(result.storage,undefined);
});
