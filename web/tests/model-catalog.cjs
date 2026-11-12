const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../src/hooks/useModelCatalog.ts'),'utf8');
const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const state = [], effects = [], pending = [];
let index=0;
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
  const catalog=catalogExports.useModelCatalog('image');
  const dispose=effects[0]();
  assert.equal(pending[0].url,'/image-models');
  const newer=catalog.reload('new');
  pending[1].resolve([{id:'new',configured:true}]);await newer;
  assert.equal(state[1],'new');
  pending[0].resolve([{id:'old'}]);await Promise.resolve();await Promise.resolve();
  assert.equal(state[0][0].id,'new','late initial response cannot replace the newer catalog');
  const failed=catalog.reload();pending[2].reject(Error('服务不可用'));await failed;
  assert.equal(state[2],'服务不可用');assert.equal(state[1],'new','failed reload preserves selection');
  const removed=catalog.reload('missing');pending[3].resolve([{id:'available'}]);await removed;
  assert.equal(state[1],'available','missing selection falls back to an existing model');
  const empty=catalog.reload();pending[4].resolve(null);await empty;
  assert.equal(state[0].length,0,'null catalogs normalize to an empty array');
  assert.equal(state[1],'');assert.equal(state[2],'');
  const late=catalog.reload();dispose();pending[5].resolve([{id:'after-unmount'}]);await late;
  assert.equal(state[0].length,0,'unmounted catalog ignores late response');
  console.log('PASS: model catalogs keep newest response, preserve selection on failure and ignore unmounted responses.');
})().catch(e=>{console.error(e);process.exitCode=1;});
