const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { buildSync } = require("esbuild");
const compiled = new Module(__filename);
compiled._compile(
  buildSync({
    entryPoints: [path.resolve(__dirname, "../src/trashActions.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
  }).outputFiles[0].text,
  __filename,
);
const { readTrashInventory, purgeTrashInventory } = compiled.exports;

(async () => {
  const deleted = (id) => ({ id, deleted_at: "2026-11-05" });
  const data = {
    collections: Array.from({ length: 502 }, (_, i) => deleted("n" + i)),
    rewrites: [deleted("p"), { id: "live-project" }],
    publications: [deleted("pub"), { id: "live-publication" }],
    assets: [
      deleted("protected"),
      deleted("free"),
      { id: "live-asset" },
      { ...deleted("hidden-result"), library_state: "result" },
      { ...deleted("hidden-source"), library_state: "collected" },
    ],
  };
  const reads = [],
    mutations = [],
    projectPurges = [];
  let blocked = true,
    removed = 0;
  const read = async (route) => {
    reads.push(route);
    const url = new URL("http://fixture" + route);
    const category = url.pathname.slice(1);
    const records = data[category];
    if (category === "collections") {
      const eligible = records.filter((item) => item.deleted_at);
      const page = Number(url.searchParams.get("page"));
      const size = Number(url.searchParams.get("page_size"));
      return {
        items: eligible.slice((page - 1) * size, page * size),
        total: eligible.length,
      };
    }
    return records;
  };
  const purge = async (route, input) => {
    assert.equal(input.confirm, true);
    assert(input.ids.length > 0 && input.ids.length <= 500);
    const category = route.split("/")[1];
    assert(
      input.ids.every((id) =>
        data[category].some((item) => item.id === id && item.deleted_at),
      ),
    );
    mutations.push({ category, ids: [...input.ids] });
    if (category === "assets" && blocked)
      throw new Error("仍有素材被正在使用的项目引用");
    data[category] = data[category].filter(
      (item) => !input.ids.includes(item.id),
    );
    return { count: input.ids.length };
  };
  const inventory = await readTrashInventory(read);
  assert.equal(inventory.collections.length, 502);
  assert(reads.some((route) => route.includes("page=6&")));
  assert.deepEqual(inventory.assets, ["protected", "free"]);
  assert.equal(
    mutations.length,
    0,
    "Preparing the confirmation must only read data",
  );
  data.collections[0].deleted_at = "";
  data.collections.push(deleted("new-after-confirmation"));
  const onPurged = (category, ids, count) => {
    removed += count;
    if (category === "rewrites") projectPurges.push(...ids);
  };
  await assert.rejects(
    () => purgeTrashInventory(inventory, read, purge, onPurged),
    /仍有素材/,
  );
  assert.equal(removed, 503);
  assert.deepEqual(
    mutations.map((item) => item.category),
    ["publications", "rewrites", "collections", "collections", "assets"],
  );
  assert.equal(mutations[2].ids.length, 500);
  assert.equal(mutations[3].ids.length, 1);
  assert.deepEqual(inventory, {
    collections: [],
    rewrites: [],
    publications: [],
    assets: ["protected", "free"],
  });
  assert.deepEqual(projectPurges, ["p"]);
  assert.deepEqual(
    data.collections.map((item) => item.id),
    ["n0", "new-after-confirmation"],
  );
  blocked = false;
  await purgeTrashInventory(inventory, read, purge, onPurged);
  assert.equal(removed, 505);
  assert.deepEqual(
    mutations.slice(5).map((item) => item.category),
    ["assets"],
    "Retry must only submit unfinished batches",
  );
  assert(data.assets.some((item) => item.id === "live-asset"));
  assert(data.rewrites.some((item) => item.id === "live-project"));
  assert(data.publications.some((item) => item.id === "live-publication"));
  assert(data.assets.some((item) => item.id === "hidden-result"));
  assert(Object.values(inventory).every((ids) => !ids.length));
  console.log(
    "PASS trash scope, pagination, 500-item batches, dependency order, live/restored/new-item preservation and partial-failure retry.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
