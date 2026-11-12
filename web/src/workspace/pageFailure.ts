export function pageFailure(error: unknown) {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const update = /Failed to fetch dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading chunk|ChunkLoadError|Expected a JavaScript.*module/i.test(detail);
  return {
    title: update ? "工作台已更新，需要重新打开" : "这个页面出现运行错误",
    description: update ? "请先保存其他页面的改动，再重新打开工作台。" : "请先保存其他页面的改动再重试；仍有问题时可提供错误信息。",
    detail: detail.slice(0, 400),
  };
}
