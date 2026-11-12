import test from 'node:test';
import assert from 'node:assert/strict';
import {publicFailure} from './errors.mjs';
test('preparation errors retain stage and safe reason without leaking browser contents',()=>{
 for(const [message,reason] of [
  ['strict mode violation SECRET-title','multiple_matches'],
  ['page.goto: net::ERR_ABORTED https://host/?token=SECRET','network'],
  ['Target page, context or browser has been closed SECRET','browser_closed'],
  ['Timeout 30000ms exceeded SECRET','timeout'],
  ['ENOENT C:\\SECRET.mp4','file_access'],
  ['locator.filter is not a function SECRET','adapter_incompatible'],
 ]) {
  const out=publicFailure(Error(message),'creator_home');
  assert.deepEqual(out,{error:'page_changed',stage:'creator_home',reason});
  assert.ok(!JSON.stringify(out).includes('SECRET'));
 }
 assert.deepEqual(publicFailure(Error('human_required'),'publish_entry'),{error:'human_required',stage:'publish_entry'});
 assert.deepEqual(publicFailure(Error('SECRET'),'SECRET'),{error:'page_changed'});
});
