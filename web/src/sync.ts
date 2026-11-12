export type SyncEntity = "jobs" | "assets" | "projects" | "publications";
export type SyncChange = {
  entity: SyncEntity;
  id: string;
  value: { id: string; created_at?: string } | null;
};
export type SyncBatch = {
  changes: SyncChange[];
  cursor: number;
  epoch: string;
  reset: boolean;
  more: boolean;
};

export function mergeChanges<T extends { id: string; created_at?: string }>(
  old: T[],
  entity: SyncEntity,
  batch: SyncBatch,
): T[] {
  const updates = batch.changes.filter((v) => v.entity === entity);
  if (!batch.reset && !updates.length) return old;
  const records = new Map((batch.reset ? [] : old).map((v) => [v.id, v]));
  for (const update of updates) {
    if (update.value) records.set(update.id, update.value as T);
    else records.delete(update.id);
  }
  return [...records.values()].sort(
    (a, b) =>
      (b.created_at || "").localeCompare(a.created_at || "") ||
      b.id.localeCompare(a.id),
  );
}
