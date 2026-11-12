import {
  DeleteOutlined,
  FileImageOutlined,
  FolderOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Empty, Pagination, Segmented, Spin } from "antd";
import { useEffect, useRef, useState } from "react";
import type { Asset, Note, Project, Publication } from "./api";
import { api, fileURL, post } from "./api";
import CollectionCardCarousel from "./components/CollectionCardCarousel";
import MasonryGrid from "./components/MasonryGrid";
import ConfirmActionIcon from "./components/ConfirmActionIcon";
import { splitNoteText } from "./noteText";
import { inMediaLibrary } from "./assetLibrary";
import {
  purgeTrashInventory,
  readTrashInventory,
  type TrashCategory,
  type TrashInventory,
} from "./trashActions";
import "./trash.css";

type Category = TrashCategory;
type View = Category | "all";
const labels = {
  collections: "采集库",
  rewrites: "仿写库",
  publications: "发布管理",
  assets: "素材库",
};
type Card = {
  category: Category;
  deletedAt: string;
  id: string;
  title: string;
  body: string;
  topics: string[];
  media: Asset[];
  note?: Note;
};

export default function Trash({
  assets,
  projects,
  publications,
  refresh,
  tick,
  onProjectPurged,
}: {
  assets: Asset[];
  projects: Project[];
  publications: Publication[];
  refresh: () => Promise<void>;
  tick: number;
  onProjectPurged: (id: string) => void;
}) {
  const { message, modal } = App.useApp();
  const [category, setCategory] = useState<View>("all");
  const [notes, setNotes] = useState<Note[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const sequence = useRef(0);
  const load = async () => {
    const seq = ++sequence.current;
    setLoading(true);
    try {
      const size =
        category === "all" ? 100 : category === "collections" ? 24 : 1;
      const result = await api<{ items: Note[]; total: number }>(
        `/collections?deleted=true&page=${category === "collections" ? page : 1}&page_size=${size}`,
      );
      if (seq !== sequence.current) return;
      let allNotes = result.items || [];
      if (category === "all" && result.total > size) {
        const rest = await Promise.all(
          Array.from(
            { length: Math.ceil(result.total / size) - 1 },
            (_, index) =>
              api<{ items: Note[] }>(
                `/collections?deleted=true&page=${index + 2}&page_size=${size}`,
              ),
          ),
        );
        if (seq !== sequence.current) return;
        allNotes = [...allNotes, ...rest.flatMap((part) => part.items || [])];
      }
      if (category === "all" || category === "collections") setNotes(allNotes);
      setTotal(result.total);
      if (category === "collections" && !result.items.length && page > 1)
        setPage(Math.max(1, Math.ceil(result.total / 24)));
    } catch (error) {
      if (seq === sequence.current) message.error((error as Error).message);
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    return () => {
      sequence.current++;
    };
  }, [category, page, tick]);
  const selectedAssets = (ids: string[], revisionID?: string) =>
    assets
      .filter(
        (asset) =>
          !asset.deleted_at &&
          (ids.includes(asset.id) ||
            (!!revisionID && asset.revision_id === revisionID)),
      )
      .sort((a, b) => a.position - b.position);
  const deletedProjects = projects
    .filter((p) => p.deleted_at)
    .sort((a, b) => b.deleted_at!.localeCompare(a.deleted_at!));
  const deletedPublications = publications
    .filter((p) => p.deleted_at)
    .sort((a, b) => b.deleted_at!.localeCompare(a.deleted_at!));
  const groups: Record<Category, Card[]> = {
    collections: notes.map((note) => ({
      category: "collections",
      deletedAt: note.deleted_at || "",
      id: note.id,
      title: note.title || "未命名笔记",
      ...splitNoteText(note.body, note.topics),
      note,
      media: selectedAssets([], note.revision_id),
    })),
    rewrites: deletedProjects.map((project) => ({
      category: "rewrites",
      deletedAt: project.deleted_at || "",
      id: project.id,
      title: project.name || "未命名项目",
      body: "",
      topics: [],
      media: selectedAssets(
        [
          ...(project.asset_ids || []),
          ...(project.cover_id ? [project.cover_id] : []),
          ...Object.values(project.media_selections || {}).flatMap(
            (selection) => selection.asset_ids,
          ),
        ],
        project.revision_id,
      ),
    })),
    assets: assets
      .filter((asset) => asset.deleted_at && inMediaLibrary(asset))
      .map((asset) => ({
        category: "assets",
        deletedAt: asset.deleted_at || "",
        id: asset.id,
        title: asset.name || asset.original_name || "未命名素材",
        body: asset.category || "",
        topics: [],
        media: [asset],
      })),
    publications: deletedPublications.map((publication) => ({
      category: "publications",
      deletedAt: publication.deleted_at || "",
      id: publication.id,
      title: publication.title || "未命名发布稿",
      ...splitNoteText(publication.body, publication.topics),
      media: selectedAssets(publication.asset_ids || []),
    })),
  };
  const rows = (
    category === "all" ? Object.values(groups).flat() : groups[category]
  ).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  const count = category === "collections" ? total : rows.length;
  const currentPage = Math.min(page, Math.max(1, Math.ceil(count / 24)));
  const visible =
    category === "collections"
      ? rows
      : rows.slice((currentPage - 1) * 24, currentPage * 24);
  const trashCount =
    total +
    groups.rewrites.length +
    groups.publications.length +
    groups.assets.length;
  const projectPurged = (id: string) => {
    onProjectPurged(id);
    for (const key of [
      `gin.draft.${id}`,
      `gin.draft.${id}.image`,
      `gin.draft.${id}.video`,
      `gin.video-director.${id}`,
      `rednote.workflow.step.${id}`,
      `rednote.media.request.${id}.image`,
      `rednote.media.request.${id}.video`,
    ]) {
      try {
        localStorage.removeItem(key);
      } catch {}
    }
  };
  const mutate = async (item: Card, permanent: boolean) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    const actionCategory = item.category;
    try {
      const path = permanent
        ? `/${actionCategory}/batch-purge`
        : actionCategory === "collections"
          ? "/collections/batch-restore"
          : `/${actionCategory}/batch-trash`;
      await post(
        path,
        permanent
          ? { ids: [item.id], confirm: true }
          : { ids: [item.id], deleted: false },
      );
      if (permanent && actionCategory === "rewrites") {
        projectPurged(item.id);
      }
      await refresh();
      await load();
      message.success(
        permanent ? "已彻底删除" : `已恢复到${labels[actionCategory]}`,
      );
    } catch (error) {
      message.error((error as Error).message);
      throw error;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const purge = (item: Card) =>
    modal.confirm({
      icon: <ConfirmActionIcon />,
      title: `彻底删除“${item.title}”？`,
      content: "此操作不可恢复。",
      okText: "彻底删除",
      cancelText: "取消",
      onOk: () => mutate(item, true),
    });
  const emptyTrash = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    let remaining: TrashInventory;
    try {
      remaining = await readTrashInventory(api);
    } catch (error) {
      message.error((error as Error).message);
      return;
    } finally {
      pending.current = false;
      setBusy(false);
    }
    const count = Object.values(remaining).reduce(
      (sum, ids) => sum + ids.length,
      0,
    );
    if (!count) {
      message.info("回收站已经为空");
      await refresh();
      await load();
      return;
    }
    let removed = 0;
    const content = (error?: string) => (
      <div className="trash-empty-confirm-content">
        <p>将彻底删除全部分类中的 {count} 项回收内容，此操作不可恢复。</p>
        {error && (
          <Alert
            type="error"
            message={
              removed
                ? `已清理 ${removed} 项，剩余内容未全部清空。`
                : "清空未完成"
            }
            description={error}
          />
        )}
      </div>
    );
    const confirmation = modal.confirm({
      title: "清空全部回收内容？",
      icon: (
        <ConfirmActionIcon
          fallback={<DeleteOutlined style={{ color: "var(--forest-muted)" }} />}
        />
      ),
      content: content(),
      okText: "全部清空",
      okType: "default",
      cancelText: "取消",
      maskClosable: false,
      onOk: (close: () => void) => {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        confirmation.update({
          okButtonProps: { loading: true, disabled: true },
          cancelButtonProps: { disabled: true },
          keyboard: false,
        });
        const run = async () => {
          let complete = false;
          try {
            await purgeTrashInventory(
              remaining,
              api,
              post,
              (kind, ids, count) => {
                removed += count;
                if (kind === "rewrites") ids.forEach(projectPurged);
              },
            );
            setPage(1);
            await refresh();
            await load();
            message.success(`已清理 ${removed} 项回收内容`);
            complete = true;
          } catch (error) {
            confirmation.update({
              content: content((error as Error).message),
              okText: "重试清空",
            });
            try {
              await refresh();
              await load();
            } catch {}
          } finally {
            pending.current = false;
            setBusy(false);
            confirmation.update({
              okButtonProps: { loading: false, disabled: false },
              cancelButtonProps: { disabled: false },
              keyboard: true,
            });
          }
          if (complete) close();
        };
        void run();
      },
    });
  };
  return (
    <section className="trash-workspace" aria-label="回收站">
      <div className="trash-toolbar">
        <Segmented
          aria-label="回收站分类"
          disabled={busy}
          value={category}
          onChange={(value) => {
            setCategory(value as View);
            setPage(1);
          }}
          options={[
            { value: "all", label: "全部" },
            { value: "collections", label: "采集笔记" },
            { value: "rewrites", label: "仿写项目" },
            { value: "publications", label: "发布稿" },
            { value: "assets", label: "素材库" },
          ]}
        />
        <Button
          aria-label="全部清空"
          icon={<DeleteOutlined aria-hidden="true" />}
          loading={busy}
          disabled={busy || loading || !trashCount}
          onClick={() =>
            void emptyTrash().catch((error) => message.error(error.message))
          }
        >
          全部清空
        </Button>
      </div>
      {loading ? (
        <div className="trash-loading">
          <Spin aria-label="正在读取回收站" />
        </div>
      ) : visible.length ? (
        <MasonryGrid>
          {visible.map((item) => (
            <article
              className="trash-card collection-card"
              key={`${item.category}:${item.id}`}
              data-trash-id={item.id}
              data-trash-category={item.category}
            >
              {item.note && item.media.length ? (
                <CollectionCardCarousel
                  note={item.note}
                  media={item.media}
                  previewURL={(asset) =>
                    asset.status === "ready"
                      ? fileURL(asset.id)
                      : `/api/v1/assets/${asset.id}/preview`
                  }
                />
              ) : item.media.length ? (
                <div className="trash-media-preview">
                  {item.media[0].kind === "video" ? (
                    <video
                      controls
                      preload="metadata"
                      playsInline
                      src={fileURL(item.media[0].id)}
                    />
                  ) : (
                    <img
                      src={fileURL(item.media[0].id)}
                      alt=""
                      loading="lazy"
                    />
                  )}
                </div>
              ) : (
                <div className="trash-card-placeholder">
                  {item.category === "rewrites" ? (
                    <FolderOutlined />
                  ) : (
                    <FileImageOutlined />
                  )}
                </div>
              )}
              <div className="trash-card-content">
                {category === "all" && (
                  <span className="trash-card-category">
                    {
                      {
                        collections: "采集笔记",
                        rewrites: "仿写项目",
                        publications: "发布稿",
                        assets: "素材库",
                      }[item.category]
                    }
                  </span>
                )}
                <h2>{item.title}</h2>
                {item.body && <p>{item.body}</p>}
                {item.topics.length > 0 && (
                  <small>
                    {item.topics.map((topic) => "#" + topic).join(" ")}
                  </small>
                )}
              </div>
              <div className="trash-card-actions">
                <Button
                  type="text"
                  aria-label="彻底删除"
                  icon={<DeleteOutlined />}
                  disabled={busy}
                  onClick={() => purge(item)}
                >
                  彻底删除
                </Button>
                <Button
                  aria-label={`恢复到${labels[item.category]}`}
                  icon={<UndoOutlined />}
                  disabled={busy}
                  onClick={() => void mutate(item, false).catch(() => {})}
                >
                  恢复到{labels[item.category]}
                </Button>
              </div>
            </article>
          ))}
        </MasonryGrid>
      ) : (
        <Empty description="暂无已删除内容" />
      )}
      {count > 24 && (
        <Pagination
          current={currentPage}
          pageSize={24}
          total={count}
          showSizeChanger={false}
          onChange={setPage}
        />
      )}
    </section>
  );
}
