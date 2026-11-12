import type { Asset, Job, Project, Publication } from "../api";

export const taskNames: Record<string, string> = {
  collect: "采集笔记",
  download: "下载素材",
  ocr: "提取图片文字",
  asr: "原视频转写",
  rewrite: "AI 仿写",
  angle_suggest: "发帖角度建议",
  image_generation: "生成图片",
  angle_recommend: "发帖角度",
  title_rewrite: "标题仿写",
  copy_rewrite: "文案仿写",
  image_plan: "画面规划",
  video_plan: "视频脚本",
  video_generate: "视频生成",
  video_compose: "视频合成",
  export: "历史打包任务",
  cleanup: "清理素材",
  publish: "发布准备",
  post_sync: "同步帖子数据",
  douyin_prepare: "准备抖音发布",
  douyin_submit: "提交抖音发布",
};
export const taskGroup = (job: Job) =>
  ["queued", "running"].includes(job.state)
    ? "active"
    : ["failed", "blocked", "needs_review"].includes(job.state)
      ? "attention"
      : "done";
export type TaskCategory = "collect" | "rewrite" | "publish";
export const categoryNames: Record<TaskCategory, string> = {
  collect: "采集项目",
  rewrite: "仿写项目",
  publish: "发布项目",
};
export type TaskProject = {
  key: string;
  category: TaskCategory;
  name: string;
  jobs: Job[];
  current: Job[];
  failures: Job[];
  active: boolean;
  state: string;
  total: number;
  completed: number;
  processed: number;
  percent: number;
  successPercent: number;
  updatedAt: string;
};

function taskUnits(job: Job) {
  const shots = job.payload?.production?.shots;
  const series = job.payload?.series;
  const total = Math.max(
    1,
    shots?.length || series?.asset_ids?.length || series?.scenes?.length || 1,
  );
  const partial =
    shots?.filter((s) => s.state === "succeeded").length ||
    new Set(series?.completed || []).size;
  const completed =
    job.state === "succeeded" ? total : Math.min(total, partial);
  return {
    total,
    completed,
    processed: taskGroup(job) === "active" ? completed : total,
  };
}
function fallback(
  job: Job,
  projects: Project[],
  assets: Asset[],
  publications: Publication[],
): NonNullable<Job["task_project"]> {
  const publication = publications.find((p) => p.id === job.target);
  if (
    publication ||
    ["publish", "export", "post_sync"].includes(job.kind) ||
    job.kind.startsWith("douyin_")
  )
    return {
      category: "publish",
      id: publication?.id || job.target || job.id,
      name: publication?.title || "发布项目",
    };
  const asset = assets.find((a) => a.id === job.target);
  const project = projects.find(
    (p) => p.id === (asset?.project_id || job.target),
  );
  if (project)
    return {
      category: "rewrite",
      id: project.id,
      name: project.name,
      item_name: asset?.name,
    };
  if (
    asset ||
    ["collect", "download", "ocr", "asr", "cleanup"].includes(job.kind)
  )
    return {
      category: "collect",
      id: asset?.revision_id || job.result || job.target || job.id,
      name: asset?.name || (job.kind === "collect" ? "笔记采集" : "素材处理"),
      item_name: asset?.name,
    };
  return { category: "rewrite", id: job.target || job.id, name: "仿写项目" };
}
export function groupTaskProjects(
  jobs: Job[],
  projects: Project[] = [],
  assets: Asset[] = [],
  publications: Publication[] = [],
) {
  const groups = new Map<string, TaskProject>();
  for (const job of jobs) {
    const ref =
      job.task_project || fallback(job, projects, assets, publications);
    const key = ref.category + ":" + ref.id;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        category: ref.category,
        name: ref.name || categoryNames[ref.category],
        jobs: [],
        current: [],
        failures: [],
        active: false,
        state: "done",
        total: 0,
        completed: 0,
        processed: 0,
        percent: 0,
        successPercent: 0,
        updatedAt: "",
      };
      groups.set(key, group);
    }
    group.jobs.push(job);
    if (job.updated_at > group.updatedAt) group.updatedAt = job.updated_at;
  }
  for (const group of groups.values()) {
    group.jobs.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const currentRevision = group.jobs.find(
      (job) => job.task_project?.current_revision_id,
    )?.task_project?.current_revision_id;
    const current = new Map<string, Job>();
    for (const job of group.jobs) {
      const ref = job.task_project;
      if (
        ref?.revision_id &&
        currentRevision &&
        ref.revision_id !== currentRevision
      )
        continue;
      const key =
        job.kind === "collect" ? "collect" : job.kind + ":" + job.target;
      if (!current.has(key)) current.set(key, job);
    }
    group.current = [...current.values()];
    if (!group.current.length) group.current = group.jobs;
    group.failures = group.current.filter((j) => taskGroup(j) === "attention");
    group.active = group.jobs.some((j) => taskGroup(j) === "active");
    group.state = group.failures.length
      ? "attention"
      : group.active
        ? "active"
        : "done";
    const downloads = group.current.filter((j) => j.kind === "download");
    const progress =
      group.category === "collect" && downloads.length
        ? downloads
        : group.current;
    for (const job of progress) {
      const u = taskUnits(job);
      group.total += u.total;
      group.completed += u.completed;
      group.processed += u.processed;
    }
    group.percent = group.total
      ? Math.round((group.processed / group.total) * 100)
      : 0;
    group.successPercent = group.total
      ? Math.round((group.completed / group.total) * 100)
      : 0;
  }
  return [...groups.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}
export function matchesTaskSearch(group: TaskProject, search: string) {
  return [
    group.name,
    categoryNames[group.category],
    ...group.jobs.flatMap((j) => [
      taskNames[j.kind],
      j.task_project?.item_name,
      j.stage,
      j.error,
    ]),
  ]
    .join(" ")
    .toLowerCase()
    .includes(search.trim().toLowerCase());
}
