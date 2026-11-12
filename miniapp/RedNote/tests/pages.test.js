const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

test('all pages and sitemap exist, with an isolated tourist or local developer AppID', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json')));
  assert.deepEqual(app.pages, ['pages/index/index', 'pages/publish/index']);
  for (const page of app.pages) for (const extension of ['.js', '.json', '.css', '.xhsml']) assert.ok(fs.existsSync(path.join(root, page + extension)), page + extension);
  assert.ok(fs.existsSync(path.join(root, app.sitemapLocation)));
  const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json')));
  assert.ok(config.appid === 'touristAppId' || /^[a-z0-9]{24}$/i.test(config.appid));
});

test('application startup contains no auto-login or network side effects', () => {
  let configuration;
  global.App = value => { configuration = value; };
  require('../app');
  assert.equal(configuration.onLaunch, undefined);
  assert.deepEqual(configuration, {});
  delete global.App;
});

test('native page bindings include only documented official error event and disabled gate', () => {
  let definition;
  global.Page = value => { definition = value; };
  require('../pages/publish/index');
  assert.equal(definition.data.officialAvailable, false);
  const template = fs.readFileSync(path.join(root, 'pages/publish/index.xhsml'), 'utf8');
  assert.match(template, /post-note-button xhs:if="\{\{officialMounted\}\}"/);
  assert.match(template, /class="native-publish-entry" hidden="\{\{!officialAvailable\}\}"/);
  assert.doesNotMatch(template, /bindtap="preparePublish"|publishAssistOpen|handoff-overlay|继续到小红书/);
  const footer = template.slice(template.indexOf('class="publish-footer"'), template.indexOf('class="gallery"'));
  assert.match(footer, /post-note-button/);
  assert.match(footer, /class="native-publish-label"[\s\S]*发小红书/);
  assert.match(template, /binderror="onOfficialError"/);
  assert.doesNotMatch(template, /bindsuccess|bindcancel|published/);
  for (const match of template.matchAll(/bind(?:tap|change|error|input|load|confirm)="([^"]+)"/g)) assert.equal(typeof definition[match[1]], 'function', match[1]);
  delete global.Page;
});
