import type { Job } from "../api";
import { api, post, resetCSRF } from "../api";

export type AdminRole = "admin" | "creator" | "operator";
export type UserStatus = "active" | "disabled";
export type AdminUser = {
  id: string;
  username: string;
  display_name: string;
  role: AdminRole;
  status: UserStatus;
  created_at: string;
  last_login_at?: string;
  note?: string;
};
export type UsageRecord = {
  id: string;
  user_id: string;
  user: string;
  at: string;
  kind: string;
  feature: string;
  model: string;
  input: number;
  output: number;
  total: number;
  cost: number;
  state: string;
  stateLabel: string;
  jobID: string;
};
export type TaskRecord = {
  user_id: string;
  user: string;
  job: Job;
};
export type AdminSummary = {
  active_users: number;
  calls: number;
  tokens: number;
  cost: number;
  active_tasks: number;
  failed_tasks: number;
};
export type AdminOverviewResponse = {
  users: AdminUser[];
  usage: UsageRecord[];
  tasks: TaskRecord[];
  summary: AdminSummary;
  price_per_1k: number;
};

export const roleLabel: Record<AdminRole, string> = {
  admin: "管理员",
  creator: "创作用户",
  operator: "运营账号",
};

export async function authMe(): Promise<AdminUser | null> {
  try {
    const result = await api<{ user: AdminUser }>("/auth/me");
    return result.user;
  } catch {
    return null;
  }
}
export async function authLogin(username: string, password: string) {
  const result = await post<{ user: AdminUser; csrf_token: string }>(
    "/auth/login",
    { username, password },
  );
  resetCSRF();
  return result;
}
export async function authLogout() {
  const result = await post("/auth/logout");
  resetCSRF();
  return result;
}
export async function adminOverview() {
  return api<AdminOverviewResponse>("/admin/overview");
}
export async function adminUsers() {
  return api<AdminUser[]>("/admin/users");
}
export async function createAdminUser(input: {
  username: string;
  password: string;
  display_name: string;
  role: AdminRole;
  note?: string;
}) {
  return post<AdminUser>("/admin/users", input);
}
export async function updateAdminUser(
  id: string,
  input: Partial<Pick<AdminUser, "display_name" | "role" | "status" | "note">>,
) {
  return api<{ updated: boolean }>(`/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
export async function deleteAdminUser(id: string) {
  return api<{ deleted: boolean }>(`/admin/users/${id}`, { method: "DELETE" });
}
export async function resetAdminPassword(id: string, password: string) {
  return post<{ updated: boolean }>(`/admin/users/${id}/password`, {
    password,
  });
}
export async function adminBilling() {
  return api<{ price_per_1k: number }>("/admin/billing");
}
export async function saveAdminBilling(price_per_1k: number) {
  return api<{ price_per_1k: number }>("/admin/billing", {
    method: "PUT",
    body: JSON.stringify({ price_per_1k }),
  });
}
export async function userBilling() {
  return api<{ price_per_1k: number }>("/billing/price");
}

// 模型目录不在这一层封装：工作区与后台共用 useModelCatalog，
// 地址由调用方按 /<capability>-models 或 /admin/models/<capability> 传入，
// 避免出现第二套字段定义与第二套错误处理。

const tokenDefaults: Record<string, { input: number; output: number }> = {
  rewrite: { input: 900, output: 700 },
  angle_suggest: { input: 520, output: 260 },
  image_plan: { input: 750, output: 420 },
  image_generation: { input: 380, output: 90 },
  video_plan: { input: 880, output: 760 },
  video_generate: { input: 520, output: 120 },
  video_compose: { input: 260, output: 40 },
  ocr: { input: 680, output: 150 },
  asr: { input: 420, output: 180 },
};
const usageKindNames: Record<string, string> = {
  rewrite: "文案生成",
  angle_suggest: "文案生成",
  angle_recommend: "发帖角度",
  title_rewrite: "标题仿写",
  copy_rewrite: "文案仿写",
  image_plan: "图片规划",
  image_generation: "图片生成",
  video_plan: "视频脚本",
  video_generate: "视频生成",
  video_compose: "视频合成",
  ocr: "图片识别",
  asr: "语音转写",
};

export function buildUsageRecords(
  jobs: Job[],
  user = "创作用户",
  price = 0,
): UsageRecord[] {
  return jobs
    .filter((job) => usageKindNames[job.kind])
    .map((job) => {
      const defaults = tokenDefaults[job.kind] || { input: 300, output: 150 };
      const inputPayload = job.payload?.input;
      const inputText = [
        inputPayload?.copy_text,
        inputPayload?.prompt,
        job.payload?.angle_text,
        job.payload?.creative ? JSON.stringify(job.payload.creative) : "",
      ]
        .filter(Boolean)
        .join("\n");
      let input = Math.max(
        24,
        inputText ? Math.ceil(inputText.length / 3.2) : defaults.input,
      );
      let output = Math.max(
        8,
        job.result ? Math.ceil(job.result.length / 3.2) : defaults.output,
      );
      if (
        job.state !== "succeeded" &&
        (!(job.attempts > 0) || job.state === "blocked")
      ) {
        input = 0;
        output = 0;
      }
      const total = input + output;
      return {
        id: job.id,
        user_id: "",
        user,
        at: job.updated_at || job.created_at,
        kind: job.kind,
        feature: usageKindNames[job.kind],
        model:
          job.payload?.model_name ||
          job.payload?.model ||
          job.payload?.input?.model_id ||
          "默认模型",
        input,
        output,
        total,
        cost: price > 0 ? (total / 1000) * price : 0,
        state: job.state,
        stateLabel:
          (
            {
              queued: "排队中",
              running: "进行中",
              succeeded: "接口成功",
              failed: "失败",
              blocked: "待配置",
              needs_review: "待核实",
              cancelled: "已取消",
            } as Record<string, string>
          )[job.state] || job.state,
        jobID: job.id,
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

export const formatNumber = (n: number) =>
  new Intl.NumberFormat("zh-CN").format(Math.round(n));
export const formatCost = (n: number, estimated = true) =>
  estimated && n <= 0 ? "未估算" : `¥${n.toFixed(2)}`;
export const formatDate = (s?: string) =>
  s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "—";

export type UsageRange = "today" | "7d" | "30d" | "all";
export const usageRangeLabel: Record<UsageRange, string> = {
  today: "今天",
  "7d": "近 7 天",
  "30d": "近 30 天",
  all: "全部",
};
export function rangeStart(range: UsageRange): number {
  const now = new Date();
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  if (range === "today") return start;
  if (range === "7d") return start - 6 * 86400000;
  if (range === "30d") return start - 29 * 86400000;
  return 0;
}
export function filterUsage(
  records: UsageRecord[],
  range: UsageRange,
  model = "",
  feature = "",
) {
  const start = rangeStart(range);
  return records.filter(
    (record) =>
      new Date(record.at).getTime() >= start &&
      (!model || record.model === model) &&
      (!feature || record.feature === feature),
  );
}
export function groupUsageByDay(records: UsageRecord[], range: UsageRange) {
  const days =
    range === "today" ? 1 : range === "7d" ? 7 : range === "30d" ? 30 : 14;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (range === "all") {
    const oldest = records.reduce(
      (min, record) => Math.min(min, new Date(record.at).getTime()),
      Date.now(),
    );
    start.setTime(Math.max(oldest, Date.now() - 13 * 86400000));
    start.setHours(0, 0, 0, 0);
  } else {
    start.setTime(start.getTime() - (days - 1) * 86400000);
  }
  const buckets: {
    key: string;
    label: string;
    input: number;
    output: number;
  }[] = [];
  const count =
    range === "all"
      ? Math.max(
          1,
          Math.min(
            30,
            Math.ceil((Date.now() - start.getTime()) / 86400000) + 1,
          ),
        )
      : days;
  for (let i = 0; i < count; i++) {
    const day = new Date(start.getTime() + i * 86400000);
    buckets.push({
      key: `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`,
      label: `${day.getMonth() + 1}/${day.getDate()}`,
      input: 0,
      output: 0,
    });
  }
  for (const record of records) {
    const day = new Date(record.at);
    const bucket = buckets.find(
      (item) =>
        item.key ===
        `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`,
    );
    if (bucket) {
      bucket.input += record.input;
      bucket.output += record.output;
    }
  }
  return buckets;
}
export function groupUsageByModel(records: UsageRecord[]) {
  const map = new Map<string, number>();
  for (const record of records) {
    map.set(record.model, (map.get(record.model) || 0) + record.total);
  }
  return [...map.entries()]
    .map(([model, total]) => ({ model, total }))
    .sort((a, b) => b.total - a.total);
}
