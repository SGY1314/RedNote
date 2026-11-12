const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/workspace/pageFailure.ts'), 'utf8');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: exportsObject });
const { pageFailure } = exportsObject;
for (const message of ['Failed to fetch dynamically imported module: /assets/old.js', 'Importing a module script failed.', 'Unable to preload CSS for /assets/old.css', 'ChunkLoadError: Loading chunk 3 failed']) {
  assert.equal(pageFailure(new Error(message)).title, '工作台已更新，需要重新打开');
}
const runtime = pageFailure(new TypeError('Cannot read properties of undefined'));
assert.equal(runtime.title, '这个页面出现运行错误');
assert.match(runtime.detail, /TypeError/);
assert.equal(pageFailure('a'.repeat(1000)).detail.length, 400);
console.log('PASS: chunk update failures and runtime errors have distinct, bounded diagnostics.');
