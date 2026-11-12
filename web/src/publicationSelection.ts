import type { Asset } from "./api";
// Counts and the visible gallery share the same usable, unique selection.
// Keep unavailable IDs in the draft until the user explicitly removes them.
export function publicationSelection(
  assets: Asset[],
  selected: string[],
  kind: string,
) {
  const unique = [...new Set(selected)];
  const eligible = new Map(assets.filter(
    (a) =>
      a.kind === kind &&
      !a.deleted_at &&
      a.status === "ready",
  ).map((a): [string, Asset] => [a.id, a]));
  const ids = unique.filter((id) => eligible.has(id));
  return {
    available: ids.map((id) => eligible.get(id)!),
    ids,
    unavailable: unique.filter((id) => !eligible.has(id)),
  };
}
