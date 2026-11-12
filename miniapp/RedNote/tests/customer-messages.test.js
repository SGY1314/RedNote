const test = require('node:test');
const assert = require('node:assert/strict');
const { customerPatch, editorMessage } = require('../features/publish/customer-messages');

test('customer-facing load failures give useful scan/network guidance rather than internal connection details', () => {
  for (const status of ['error', 'unavailable', 'invalid', 'expired', 'revoked']) {
    const result = customerPatch({ status, statusDescription: 'https://private.example.test/v1/development/open?ticket=secret' });
    assert.equal(result.status, status);
    assert.doesNotMatch(result.statusDescription, /https:|ticket|secret|开发|工作台|交接/);
  }
  assert.match(customerPatch({ status: 'error', statusDescription: '二维码已被使用，请在原设备继续' }).statusDescription, /原设备/);
  assert.equal(customerPatch({ busy: false }).busy, false);
});

test('field limits, failed images and unsuitable phones remain visible as actionable publishing errors', () => {
  assert.match(editorMessage('标题需为 1–20 个字符'), /标题.*20/);
  assert.match(editorMessage('正文不可超过 1000 个字符'), /正文.*1000/);
  assert.match(editorMessage('有图片未成功加载'), /重新加载/);
  assert.match(editorMessage('真机环境：请在手机开发预览打开'), /手机小红书/);
  assert.match(editorMessage('二维码已过期'), /重新扫描商家二维码/);
  assert.equal(editorMessage(''), '');
});
