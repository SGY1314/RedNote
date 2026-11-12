import type { Content, CreativeSettings, Version } from "./api";

export type RewriteDraft = {
  audience?: string;
  tone?: string;
  length?: string;
  requirements?: string;
  modelID?: string;
  hook?: string;
  edited_at?: string;
  creative?: CreativeSettings;
  content: Content;
  versionID: string;
  sourceIDs: string[];
  media?: { kind: string; asset_ids: string[]; cover_id?: string };
};

export function isEmptyInitialDraft(draft: RewriteDraft) {
  return (
    !draft.versionID &&
    !draft.content.title?.trim() &&
    !draft.content.body?.trim() &&
    !draft.content.topics?.length
  );
}

// An empty media-selection draft must not hide an already generated version.
// Retain its media selection: it may have changed while generation was running.
export function restoreGeneratedText(
  draft: RewriteDraft,
  version?: Version,
): RewriteDraft {
  if (
    !version ||
    !isEmptyInitialDraft(draft) ||
    (draft.media && version.media && draft.media.kind !== version.media.kind)
  )
    return draft;
  return {
    ...draft,
    content: {
      title: version.title,
      body: version.body,
      topics: version.topics || [],
    },
    versionID: version.id,
    sourceIDs: version.source_ids || [],
    media: draft.media || version.media,
  };
}

export function rewriteDraftFingerprint(draft: RewriteDraft) {
  return JSON.stringify([
    draft.versionID || "",
    draft.creative || {},
    draft.content.title || "",
    draft.content.body || "",
    draft.content.topics || [],
    draft.sourceIDs || [],
    draft.media?.kind || "",
    draft.media?.asset_ids || [],
    draft.media?.cover_id || "",
  ]);
}

export function rewriteCompletionAction(
  current: RewriteDraft,
  hasLocalDraft: boolean,
  submitted?: string,
) {
  if (submitted !== undefined) {
    return submitted === rewriteDraftFingerprint(current)
      ? "apply"
      : "preserve";
  }
  if (isEmptyInitialDraft(current)) return "restore-text";
  return hasLocalDraft ? "preserve" : "apply";
}
