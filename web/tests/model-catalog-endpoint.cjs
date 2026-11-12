const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../src/hooks/useModelCatalog.ts'),'utf8');
const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const state = [], effects = [], pending = [];
let index = 0;
const catalogExports = {};
vm.runInNewContext(compiled,{exports:catalogExports,require(name){
  if(name==='react') return {
    useState(initial){const i=index++;state[i]=initial;return [initial,v=>state[i]=typeof v==='function'?v(state[i]):v];},
    useRef:value=>({current:value}),useCallback:fn=>fn,useEffect:fn=>effects.push(fn),
  };
  if(name==='../api')return {api:url=>new Promise((resolve,reject)=>pending.push({url,resolve,reject}))};
  throw Error(name);
}});
(async()=>{
  const admin = catalogExports.useModelCatalog('angle','/admin/models/angle');
  const dispose = effects[0]();
  assert.equal(pending[0].url,'/admin/models/angle','admin catalog must keep its own endpoint');
  const newer = admin.reload('m2');
  pending[1].resolve([{id:'m1',configured:false},{id:'m2',configured:true}]);
  await newer;
  assert.equal(state[1],'m2','saved model becomes the selection');
  pending[0].resolve([{id:'stale'}]);
  await Promise.resolve();await Promise.resolve();
  assert.equal(state[0][1].id,'m2','late admin response cannot replace a newer catalog');
  const removed = admin.reload();
  pending[2].resolve([]);
  await removed;
  assert.equal(state[1],'','empty catalog clears the selection');
  const late = admin.reload('after-unmount');
  dispose();
  pending[3].resolve([{id:'after-unmount'}]);
  await late;
  assert.equal(state[0].length,0,'unmounted admin catalog ignores late response');
  console.log('PASS: admin model catalog reuses the workspace load semantics with its own endpoint.');
})().catch(e=>{console.error(e);process.exitCode=1;});
