import type { Asset } from "./api";
import { inMediaLibrary } from "./assetLibrary";

export type TrashCategory =
  | "collections"
  | "rewrites"
  | "publications"
  | "assets";
export type TrashInventory = Record<TrashCategory, string[]>;
type DeletedRecord = { id: string; deleted_at?: string };
type Read = <T>(path: string) => Promise<T>;
type Purge = (
  path: string,
  body: { ids: string[]; confirm: true },
) => Promise<{ count: number }>;

const deletedIDs = (items: DeletedRecord[]) => [
  ...new Set(items.filter((item) => item.deleted_at).map((item) => item.id)),
];

async function readCategory(
  category: TrashCategory,
  read: Read,
): Promise<string[]> {
  if (category === "collections") {
    const first = await read<{ items: DeletedRecord[]; total: number }>(
      "/collections?deleted=true&page=1&page_size=100",
    );
    const rest = await Promise.all(
      Array.from(
        { length: Math.max(0, Math.ceil(first.total / 100) - 1) },
        (_, index) =>
          read<{ items: DeletedRecord[] }>(
            `/collections?deleted=true&page=${index + 2}&page_size=100`,
          ),
      ),
    );
    return deletedIDs([...first.items, ...rest.flatMap((part) => part.items)]);
  }
  if (category === "assets") {
    return deletedIDs((await read<Asset[]>("/assets")).filter(inMediaLibrary));
  }
  return deletedIDs(
    await read<DeletedRecord[]>(`/${category}?include_deleted=true`),
  );
}

export async function readTrashInventory(read: Read): Promise<TrashInventory> {
  const categories: TrashCategory[] = [
    "collections",
    "rewrites",
    "publications",
    "assets",
  ];
  const groups = await Promise.all(
    categories.map(
      async (category) =>
        [category, await readCategory(category, read)] as const,
    ),
  );
  return Object.fromEntries(groups) as TrashInventory;
}

/** A failed attempt retains only unfinished batches, so retry never resubmits deleted IDs. */
export async function purgeTrashInventory(
  remaining: TrashInventory,
  read: Read,
  purge: Purge,
  onPurged: (category: TrashCategory, ids: string[], count: number) => void,
) {
  // Remove snapshots before media; existing server guards still protect live references/tasks.
  const order: TrashCategory[] = [
    "publications",
    "rewrites",
    "collections",
    "assets",
  ];
  for (const category of order) {
    if (!remaining[category].length) continue;
    const eligible = new Set(await readCategory(category, read));
    // Restored or independently purged items are no longer part of this confirmation.
    remaining[category] = remaining[category].filter((id) => eligible.has(id));
    while (remaining[category].length) {
      const ids = remaining[category].slice(0, 500);
      const result = await purge(`/${category}/batch-purge`, {
        ids,
        confirm: true,
      });
      remaining[category].splice(0, ids.length);
      onPurged(category, ids, result.count);
    }
  }
}
