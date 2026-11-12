import type { Asset } from "./api";

// Legacy assets remain visible. Cached generation results require explicit save.
export const inMediaLibrary = (asset: Asset) =>
  asset.library_state !== "result" &&
  (asset.source !== "collection" || asset.status === "ready");
