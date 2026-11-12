import type { Publication } from "./api";

const published = (p: Publication) =>
  !!(
    p.published_at ||
    p.remote_work_id ||
    p.online_state === "published" ||
    p.manual_status === "published"
  );

// Match the API's legacy replacement rule when records arrive through /sync.
// New confirmations move superseded snapshots into the recycle bin atomically.
export function publicationReplaced(
  p: Publication,
  all: Publication[],
): boolean {
  const rootID = p.shared_draft_id || p.id;
  if (
    all.some(
      (other) =>
        ((other.shared_draft_id || other.id) === rootID ||
          ((other.target_platform || "xhs") !== (p.target_platform || "xhs") &&
            other.project_id === p.project_id &&
            ((!!p.version_id && other.version_id === p.version_id) ||
              (!!p.group_id && other.group_id === p.group_id)) &&
            JSON.stringify([
              other.title,
              other.body,
              other.topics || [],
              other.kind,
              other.asset_ids,
              other.cover_id || "",
            ]) ===
              JSON.stringify([
                p.title,
                p.body,
                p.topics || [],
                p.kind,
                p.asset_ids,
                p.cover_id || "",
              ]))) &&
        published(other),
    )
  )
    return false;
  if (p.shared_draft_id) {
    const root = all.find(
      (other) => other.id === p.shared_draft_id && !other.shared_draft_id,
    );
    return !root || !!root.deleted_at || publicationReplaced(root, all);
  }
  return all.some(
    (latest) =>
      latest.id !== p.id &&
      latest.project_id === p.project_id &&
      (latest.target_platform || "xhs") === (p.target_platform || "xhs") &&
      !latest.deleted_at &&
      !published(latest) &&
      latest.workflow_managed &&
      (!p.workflow_managed || (latest.updated_at || "") > (p.updated_at || "")),
  );
}

export type PublicationGroup = Publication & { members: Publication[] };
export type PublicationPlatform = "xhs" | "douyin";
export const publicationState = (p?: Publication) =>
  p?.manual_status || (p && published(p) ? "published" : "ready");

// Merge only identical confirmed snapshots, with at most one receipt per platform.
// A project may contain several historical drafts; never group by project alone.
export function groupPublications(all: Publication[]): PublicationGroup[] {
  const groups: PublicationGroup[] = [];
  const snapshot = (p: Publication) =>
    JSON.stringify([
      p.project_id,
      p.title,
      p.body,
      p.topics || [],
      p.kind,
      p.asset_ids,
      p.cover_id || "",
    ]);
  for (const p of [...all].sort(
    (a, b) => Number(!!a.shared_draft_id) - Number(!!b.shared_draft_id),
  )) {
    const group = groups.find(
      (g) =>
        snapshot(g) === snapshot(p) &&
        (p.shared_draft_id
          ? g.members.some(
              (m) =>
                m.id === p.shared_draft_id ||
                m.shared_draft_id === p.shared_draft_id,
            )
          : (!!p.version_id && g.version_id === p.version_id) ||
            (!!p.group_id && g.group_id === p.group_id)) &&
        !g.members.some(
          (m) => (m.target_platform || "xhs") === (p.target_platform || "xhs"),
        ),
    );
    if (group) group.members.push(p);
    else groups.push({ ...p, members: [p] });
  }
  return groups;
}

export function platformPublication(
  group: PublicationGroup,
  platform: PublicationPlatform,
): Publication | undefined {
  return group.members.find((p) => (p.target_platform || "xhs") === platform);
}

export function pendingPlatformPublication(
  group: PublicationGroup,
  platform: PublicationPlatform,
): Publication {
  return (
    platformPublication(group, platform) || {
      ...group,
      target_platform: platform,
      manual_status: "ready",
      published_at: "",
      remote_work_id: "",
      published_url: "",
      online_state: "",
      online_job_id: "",
    }
  );
}
