import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {verifiedAccount} from './protocol.mjs';

// Exercise the worker's real account probe without contacting a platform.
const source=readFileSync(new URL('./worker.mjs',import.meta.url),'utf8');
const accountCode=source.slice(source.indexOf('async function account('),source.indexOf('\nasync function checkAccount('));
test('fresh account verification visits only the creator center and accepts one scan',async()=>{
 const visits=[];let closed=0;
 const scope={verifiedAccount,creatorIdentity:undefined,mainIdentity:undefined,observeIdentity(){},human:async()=>{},context:{newPage:async()=>({
  async goto(url){visits.push(url);assert.equal(url,'https://creator.douyin.com/');scope.creatorIdentity={uid:'123',nickname:'扫码账号'};},
  async waitForTimeout(){},async close(){closed++;},
 })}};
 const account=vm.runInNewContext('('+accountCode+')',scope);
 assert.equal((await account(true)).is_logged_in,true);
 assert.equal((await account(true)).main_verified,false);
 assert.equal(visits.length,2);assert.equal(closed,2);
});
test('expired creator session cannot reuse a stale identity or main-site login',async()=>{
 let closed=false;
 const scope={verifiedAccount,creatorIdentity:{uid:'123',nickname:'旧账号'},mainIdentity:{uid:'123'},observeIdentity(){},human:async()=>{},context:{newPage:async()=>({
  async goto(){},async waitForTimeout(){},async close(){closed=true;},
 })}};
 const account=vm.runInNewContext('('+accountCode+')',scope);
 await assert.rejects(account(true),/identity_unverified/);
 assert.equal(closed,true);
});
