import type { Version } from "./api";
export function versionChanges(a: Version, b: Version) {
  const result: string[] = [];
  if (a.title !== b.title) result.push("标题已修改");
  const left = a.body.split("\n"),
    right = b.body.split("\n");
  const changed = Array.from(
    { length: Math.max(left.length, right.length) },
    (_, i) => i,
  ).filter((i) => left[i] !== right[i]);
  if (changed.length)
    result.push(
      `正文第 ${changed.map((i) => i + 1).join("、")} 段有变化（按换行比较）`,
    );
  if (JSON.stringify(a.topics || []) !== JSON.stringify(b.topics || []))
    result.push("话题已修改");
  if (a.media?.kind !== b.media?.kind) result.push("图文 / 视频类型已改变");
  const x = a.media?.asset_ids || [],
    y = b.media?.asset_ids || [];
  if (JSON.stringify(x) !== JSON.stringify(y)) {
    const added = y.filter((id) => !x.includes(id)).length,
      removed = x.filter((id) => !y.includes(id)).length;
    if (added || removed)
      result.push(`素材新增 ${added} 个、移除 ${removed} 个`);
    else result.push("素材顺序已调整");
  }
  if (a.media?.cover_id !== b.media?.cover_id) result.push("封面已更换");
  return result.length ? result : ["发布内容相同"];
}
export default function VersionDiff({
  left,
  right,
}: {
  left?: Version;
  right?: Version;
}) {
  if (!left || !right) return null;
  return (
    <div
      style={{ padding: 12, background: "#f0f5ff", marginBottom: 16 }}
      aria-label="版本变化摘要"
    >
      <strong>右侧相对左侧的变化</strong>
      <ul>
        {versionChanges(left, right).map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      {left.body !== right.body && (
        <details>
          <summary>查看正文逐段变化</summary>
          {Array.from(
            {
              length: Math.max(
                left.body.split("\n").length,
                right.body.split("\n").length,
              ),
            },
            (_, i) => i,
          )
            .filter(
              (i) => left.body.split("\n")[i] !== right.body.split("\n")[i],
            )
            .map((i) => (
              <div key={i} style={{ marginTop: 10 }}>
                <small>第 {i + 1} 段</small>
                <div style={{ background: "#fff1f0", whiteSpace: "pre-wrap" }}>
                  原：{left.body.split("\n")[i] ?? "（无）"}
                </div>
                <div style={{ background: "#f6ffed", whiteSpace: "pre-wrap" }}>
                  新：{right.body.split("\n")[i] ?? "（无）"}
                </div>
              </div>
            ))}
        </details>
      )}
    </div>
  );
}
