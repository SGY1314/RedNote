export type Platform = "xhs" | "douyin";
export const platformName = (p: Platform) =>
  p === "douyin" ? "抖音" : "小红书";
export type Content = { title: string; body: string; topics: string[] };
export type Note = {
  rating?: number;
  body?: string;
  topics?: string[];
  platform: string;
  deleted_at?: string;
  id: string;
  note_id: string;
  title: string;
  author: string;
  url: string;
  kind: string;
  tags: string[];
  revision_id: string;
  likes: number | null;
  favorites: number | null;
  comments: number | null;
  created_at: string;
  updated_at: string;
};
export type Asset = {
  library_state?: "result" | "saved" | "collected";
  project_id?: string;
  project_name?: string;
  script_id?: string;
  script_title?: string;
  deleted_at?: string;
  original_name?: string;
  category?: string;
  updated_at?: string;
  id: string;
  name: string;
  kind: string;
  mime: string;
  source: string;
  revision_id?: string;
  role?: string;
  position: number;
  width: number;
  height: number;
  duration: number;
  size: number;
  status: string;
  error?: string;
  created_at: string;
};
export type Segment = { start_ms: number; end_ms: number; text: string };
export type Extraction = {
  id: string;
  asset_id: string;
  kind: string;
  original: string;
  text: string;
  segments: Segment[];
  edited: boolean;
};
export type Source = { id: string; label: string; text: string };
export type Project = {
  selected_versions?: Record<string, string>;
  drafts?: Record<
    string,
    import("./rewriteCompletion").RewriteDraft & {
      revision: number;
      saved_at: string;
      audience?: string;
      tone?: string;
      length?: string;
      requirements?: string;
      modelID?: string;
      hook?: string;
    }
  >;
  platform?: Platform;
  deleted_at?: string;
  id: string;
  name: string;
  note_id?: string;
  revision_id?: string;
  sources: Source[];
  created_at: string;
  asset_ids?: string[];
  kind?: string;
  cover_id?: string;
  media_selections?: Record<string, { asset_ids: string[]; cover_id: string }>;
};
export type CreativeSettings = {
  topic?: string;
  angle?: string;
  image_angle?: string;
  image_hook?: string;
  image_custom?: string;
  video_angle?: string;
  video_hook?: string;
  video_custom?: string;
};
export type Version = Content & {
  generated?: boolean;
  reused?: boolean;
  creative?: CreativeSettings;
  generation_records?: {
    asset_id: string;
    job_id: string;
    kind: string;
    model?: string;
    details: Record<string, unknown>;
  }[];
  hook?: string;
  name?: string;
  media?: { kind: string; asset_ids: string[]; cover_id: string };
  id: string;
  project_id: string;
  number: number;
  status: string;
  source_ids: string[];
  instructions: string;
  created_at: string;
  model?: string;
  model_name?: string;
  parent_id?: string;
};
export type Publication = Content & {
  manual_status?: "ready" | "published";
  revision?: number;
  workflow_managed?: boolean;
  updated_at?: string;
  confirmed_at?: string;
  deleted_at?: string;
  group_id?: string;
  shared_draft_id?: string;
  target_platform?: string;
  remote_work_id?: string;
  visibility?: string;
  online_state?: string;
  online_job_id?: string;
  online_account?: string;
  submitted_at?: string;
  id: string;
  project_id: string;
  version_id: string;
  kind: string;
  asset_ids: string[];
  cover_id?: string;
  ready: boolean;
  exported_at: string[];
  published_at?: string;
  published_url?: string;
  created_at: string;
};
export type Job = {
  task_project?: {
    category: "collect" | "rewrite" | "publish";
    id: string;
    name: string;
    item_name?: string;
    revision_id?: string;
    current_revision_id?: string;
  };
  history_deleted_at?: string;
  payload?: {
    workflow_script?: boolean;
    generated_script?: string;
    request_id?: string;
    direct_media?: {
      script?: string;
      kind: string;
      model_id: string;
      source_ids: string[];
      revision_id: string;
      copy_key?: string;
      account_key?: string;
      requirements: string;
      quality: string;
      ratio: string;
      count: number;
      duration?: number;
      audio: boolean;
    };
    request_input?: string;
    production?: {
      script_id: string;
      audio: boolean;
      shots: { state: string; remote_id?: string; asset_id?: string }[];
    };
    creative?: CreativeSettings;
    angles?: string[];
    angle_text?: string;
    plan?: { scenes: string[] };
    input?: {
      creative?: CreativeSettings;
      model_id: string;
      count: number;
      copy_text: string;
      prompt: string;
      reference_asset_ids: string[];
    };
    model_name?: string;
    model?: string;
    series?: {
      asset_ids: string[];
      scenes: string[];
      completed: string[];
      reference_limit: number;
    };
  };
  id: string;
  kind: string;
  target: string;
  state: string;
  stage: string;
  error?: string;
  result?: string;
  created_at: string;
  updated_at: string;
  attempts: number;
};
export type Service = {
  base_url: string;
  model: string;
  secret?: string;
  configured: boolean;
  mask?: string;
};
export type Settings = {
  text: Service;
  ocr: Service;
  asr: Service;
  collector_url: string;
};
let csrf = "";
export function resetCSRF() {
  csrf = "";
}
export class APIError extends Error {
  constructor(
    message: string,
    readonly blocked?: { id: string; name: string; reason: string }[],
    readonly status?: number,
  ) {
    super(message);
    this.name = "APIError";
  }
}
export async function api<T = any>(
  path: string,
  opts: RequestInit = {},
  retrySession = true,
): Promise<T> {
  if (opts.method && opts.method !== "GET" && !csrf) {
    const r = await fetch("/api/v1/session");
    csrf = (await r.json()).csrf_token;
  }
  const headers = new Headers(opts.headers);
  if (!(opts.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (csrf) headers.set("X-CSRF-Token", csrf);
  const r = await fetch("/api/v1" + path, { ...opts, headers });
  const data = await r.json();
  if (!r.ok) {
    if (r.status === 403 && data.error?.includes("会话已过期")) {
      csrf = "";
      if (retrySession) return api<T>(path, opts, false);
    }
    throw new APIError(
      data.error || "请求失败",
      Array.isArray(data.blocked) ? data.blocked : undefined,
      r.status,
    );
  }
  return data;
}
export const post = <T = any>(path: string, data: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(data) });
export const patch = <T = any>(path: string, data: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(data) });
export const fileURL = (id: string) => "/api/v1/assets/" + id + "/file";
export const date = (s: string) =>
  s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "—";
export const stateLabel: Record<string, string> = {
  queued: "排队中",
  running: "进行中",
  succeeded: "已完成",
  failed: "失败",
  blocked: "待配置",
  needs_review: "待核实",
  cancelled: "已取消",
  ready: "已就绪",
  pending: "待下载",
};
export const stateColor: Record<string, string> = {
  queued: "default",
  running: "blue",
  succeeded: "green",
  failed: "red",
  blocked: "gold",
  needs_review: "orange",
  cancelled: "default",
  ready: "green",
  pending: "default",
};
