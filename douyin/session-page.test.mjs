import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureLoginPage} from './session-page.mjs';

test('closing the login tab keeps authenticated context and recreates the observed tab',async()=>{
 let created=0,observed;
 const replacement={isClosed:()=>false};
 const context={newPage:async()=>{created++;return replacement}};
 assert.equal(await ensureLoginPage(context,{isClosed:()=>true},p=>observed=p),replacement);
 assert.equal(created,1);assert.equal(observed,replacement);
 assert.equal(await ensureLoginPage(context,replacement,()=>assert.fail('live tab must be preserved')),replacement);
 assert.equal(created,1);
});

test('missing tab is initialized; failed recreation is surfaced',async()=>{
 const replacement={};
 assert.equal(await ensureLoginPage({newPage:async()=>replacement},undefined,()=>{}),replacement);
 await assert.rejects(ensureLoginPage({newPage:async()=>{throw Error('closed context')}},undefined,()=>{}),/closed context/);
});
