import type { Asset, Job, Note } from "./api";

export function collectionState(
  note: Note,
  assets: Asset[],
  jobs: Job[],
): { label: string; color: string; reason?: string } {
  const media = assets.filter(
    (asset) => asset.revision_id === note.revision_id && !asset.deleted_at,
  );
  const mediaIDs = new Set(media.map((asset) => asset.id));
  const latest = new Map<string, Job>();
  for (const job of jobs) {
    const related =
      job.kind === "collect"
        ? job.result === note.id ||
          job.result === note.revision_id ||
          job.target === note.id ||
          (!!note.url && job.target === note.url)
        : ["download", "ocr", "asr"].includes(job.kind) &&
          mediaIDs.has(job.target);
    if (!related) continue;
    const key = job.kind + "/" + job.target;
    if (!latest.has(key) || latest.get(key)!.updated_at < job.updated_at)
      latest.set(key, job);
  }
  const relatedJobs = [...latest.values()];
  const failed = relatedJobs.find((job) => job.state === "failed");
  const failedAsset = media.find((asset) => asset.status === "failed");
  if (failed || failedAsset)
    return {
      label: "失败",
      color: "red",
      reason: failed?.error || failedAsset?.error || "采集或素材处理失败",
    };
  if (relatedJobs.some((job) => job.state === "blocked"))
    return { label: "待配置", color: "gold" };
  if (relatedJobs.some((job) => job.state === "needs_review"))
    return { label: "待核实", color: "orange" };
  if (
    relatedJobs.some((job) => ["queued", "running"].includes(job.state)) ||
    media.some((asset) => asset.status !== "ready")
  )
    return { label: "处理中", color: "blue" };
  return note.revision_id
    ? { label: "成功", color: "green" }
    : { label: "待处理", color: "default" };
}
