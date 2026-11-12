const assert = require("node:assert/strict");
const path = require("node:path");
const { buildSync } = require("esbuild");
const code = buildSync({
  entryPoints: [path.join(__dirname, "../src/noteText.ts")],
  bundle: true, write: false, platform: "node", format: "cjs",
}).outputFiles[0].text;
const compiled = { exports: {} };
new Function("module", "exports", code)(compiled, compiled.exports);
const { splitNoteText } = compiled.exports;

const original = "第一眼还有得救…[微笑R]#狗子[话题]# #善待动物关爱生命[话题]#";
assert.deepEqual(splitNoteText(original, ["狗子", "善待动物关爱生命"]), {
  body: "第一眼还有得救…[微笑R]", topics: ["狗子", "善待动物关爱生命"],
});
assert.equal(original.includes("[话题]"), true);
assert.deepEqual(splitNoteText("第一段。\n\n第二段。\n#咖啡 #慢生活"), {
  body: "第一段。\n\n第二段。", topics: ["咖啡", "慢生活"],
});
assert.deepEqual(splitNoteText("正文 #咖啡 #咖啡", ["#咖啡[话题]#"]), {
  body: "正文", topics: ["咖啡"],
});
assert.deepEqual(splitNoteText("我喜欢 #咖啡，也爱 #生活美学。", ["咖啡", "生活美学"]), {
  body: "我喜欢 ，也爱 。", topics: ["咖啡", "生活美学"],
});
const technicalText = "使用 C# 写代码，保留 A#B 和 #include 语句。";
assert.equal(splitNoteText(technicalText).body, technicalText);
assert.deepEqual(splitNoteText(), { body: "", topics: [] });
assert.deepEqual(splitNoteText(null, null), { body: "", topics: [] });
assert.deepEqual(splitNoteText("原始正文照常显示。", null), { body: "原始正文照常显示。", topics: [] });
assert.deepEqual(splitNoteText("原文 #咖啡[话题]#", null), { body: "原文", topics: ["咖啡"] });
console.log("PASS note body/topic separation, paragraph and literal hash preservation.");
