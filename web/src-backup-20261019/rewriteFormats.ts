import type { Project, Version } from "./api";
export type RewriteKind = "image" | "video";
export const kindName = (kind: string) =>
  kind === "video" ? "仿写视频" : "仿写图片";
export const projectHasKind = (p: Project, kind: RewriteKind) =>
  (p.kind || "image") === kind || !!p.media_selections?.[kind];
export const versionsForKind = (
  versions: Version[],
  kind: RewriteKind,
  legacyKind: string | undefined,
) => versions.filter((v) => (v.media?.kind || legacyKind || "image") === kind);
export const draftKey = (id: string, kind: string) => `gin.draft.${id}.${kind}`;
export function readFormatDraft(
  id: string,
  kind: RewriteKind,
  legacyKind: string | undefined,
) {
  try {
    const own = localStorage.getItem(draftKey(id, kind));
    if (own) return JSON.parse(own);
    const old = JSON.parse(localStorage.getItem("gin.draft." + id) || "null");
    return old && (old.media?.kind || legacyKind || "image") === kind
      ? old
      : null;
  } catch {
    return null;
  }
}
export function clearFormatDraft(
  id: string,
  kind: string,
  legacyKind: string | undefined,
) {
  localStorage.removeItem(draftKey(id, kind));
  try {
    const old = JSON.parse(localStorage.getItem("gin.draft." + id) || "null");
    if (old && (old.media?.kind || legacyKind || "image") === kind)
      localStorage.removeItem("gin.draft." + id);
  } catch {
    /* Preserve unreadable older drafts. */
  }
}
