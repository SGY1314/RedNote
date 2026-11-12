import type { Version } from "../api";
import { hookLabel } from "../rewriteHooks";
export const versionLabel = (v: Version) =>
  `${v.generated ? "试写记录" : `V${v.number}`}${v.name ? " · " + v.name : ""} · ${v.model_name ? v.model_name + " / " : ""}${v.model || "手动编辑"}${v.hook ? " · " + hookLabel(v.hook) : ""}${v.parent_id ? " · 基于历史版本" : ""} · ${v.status === "confirmed" ? "已确认" : "草稿"}`;
