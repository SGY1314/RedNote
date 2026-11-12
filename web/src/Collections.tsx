import Table from "./components/ResponsiveTable";
import type { TableColumnsType } from "antd";
import {
  AppstoreOutlined,
  ArrowRightOutlined,
  AudioOutlined,
  CheckOutlined,
  DownloadOutlined,
  FileTextOutlined,
  FolderAddOutlined,
  ReloadOutlined,
  CloudDownloadOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FileImageOutlined,
  HeartOutlined,
  LinkOutlined,
  MessageOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
  StarOutlined,
  UnorderedListOutlined,
  UndoOutlined,
  UserOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Empty,
  Image,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Popover,
  Segmented,
  Select,
  Space,
  Tabs,
  Tag,
} from "antd";
import { useEffect, useRef, useState } from "react";
import { splitNoteText } from "./noteText";
import { collectionState } from "./collectionState";
import type { Asset, Extraction, Job, Note, Project, Segment } from "./api";
import { api, date, fileURL, patch, post } from "./api";
import NoteCuration, { suggestedNoteTags } from "./components/NoteCuration";
import CollectionCardCarousel from "./components/CollectionCardCarousel";
import MasonryGrid from "./components/MasonryGrid";
import ConfirmActionIcon from "./components/ConfirmActionIcon";
type Detail = {
  note: Note;
  revision: {
    id: string;
    title: string;
    body: string;
    topics: string[];
    published_at: string;
  };
  history: { id: string; created_at: string }[];
  assets: Asset[];
  extractions: Extraction[];
  jobs: Job[];
};
const defaultColumns = [
  "platform",
  "kind",
  "tags",
  "author",
  "likes",
  "favorites",
  "comments",
  "time",
  "state",
];
export default function Collections({
  trash = false,
  assets,
  projects = [],
  jobs,
  tick,
  onCreate,
  refresh,
}: {
  trash?: boolean;
  assets: Asset[];
  projects?: Project[];
  jobs: Job[];
  tick: number;
  onCreate: (id?: string) => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const { message, modal } = App.useApp();
  const existingNoteIDs = new Set(
    projects.filter((p) => !p.deleted_at && p.note_id).map((p) => p.note_id),
  );
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    try {
      return localStorage.getItem("rednote.collection.view") === "list"
        ? "list"
        : "grid";
    } catch {
      return "grid";
    }
  });
  const [changing, setChanging] = useState(false);
  const deletingTag = useRef(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureItems, setCaptureItems] = useState<
    {
      job_id?: string;
      note_id?: string;
      url?: string;
      duplicate?: boolean;
      deleted?: boolean;
    }[]
  >([]);
  const [extracting, setExtracting] = useState<string[]>([]);
  const pendingExtractions = useRef(new Map<string, string>());
  useEffect(() => {
    for (const [id, label] of pendingExtractions.current) {
      const job = jobs.find((j) => j.id === id);
      if (!job || ["queued", "running"].includes(job.state)) continue;
      pendingExtractions.current.delete(id);
      message.destroy(id);
      if (job.state === "succeeded")
        message.success({
          key: id,
          content: label + "成功，请查看结果",
          duration: 5,
        });
      else
        message.error({
          key: id,
          content:
            label +
            "未完成：" +
            (job.error || job.stage || "请检查模型配置后重试"),
          duration: 8,
        });
    }
  }, [jobs]);
  const [captureJobs, setCaptureJobs] = useState<string[]>([]);
  const captureNotes = new Set(
    captureJobs
      .map((id) => jobs.find((job) => job.id === id)?.result)
      .filter(Boolean),
  );
  const captureActive =
    captureJobs.some((id) => {
      const job = jobs.find((job) => job.id === id);
      return !job || ["queued", "running"].includes(job.state);
    }) ||
    jobs.some(
      (job) =>
        job.task_project?.category === "collect" &&
        captureNotes.has(job.task_project.id) &&
        ["queued", "running"].includes(job.state),
    );
  const [q, setQ] = useState("");

  const [tag, setTag] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState("updated_at");
  const [order, setOrder] = useState("desc");
  const [items, setItems] = useState<Note[]>([]);
  const [total, setTotal] = useState(0);
  const [knownTags, setKnownTags] = useState<string[]>(suggestedNoteTags);
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [detail, setDetail] = useState<Detail>();
  const [detailID, setDetailID] = useState("");
  const collectionRef = useRef<HTMLDivElement>(null);
  const detailText = splitNoteText(
    detail?.revision.body,
    detail?.revision.topics,
  );
  const [downloadSubmitting, setDownloadSubmitting] = useState(false);
  const downloadActive = (id: string) =>
    jobs.some(
      (j) =>
        j.kind === "download" &&
        j.target === id &&
        ["queued", "running"].includes(j.state),
    );
  const previewURL = (a: Asset) =>
    a.status === "ready" ? fileURL(a.id) : `/api/v1/assets/${a.id}/preview`;
  const openCollection = (note: Note) => {
    setDetail(undefined);
    setDetailID(note.id);
  };
  const downloadMedia = async (ids: string[]) => {
    if (!detail || downloadSubmitting) return;
    setDownloadSubmitting(true);
    try {
      const result = await post<{ count: number }>(
        `/collections/${detail.note.id}/download-media`,
        { ids },
      );
      message.success(
        result.count
          ? `已提交 ${result.count} 份素材下载，成功后会出现在素材库`
          : "所选素材已在素材库，无需重复下载",
      );
      await refresh();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setDownloadSubmitting(false);
    }
  };
  const [editing, setEditing] = useState<Extraction>();
  const [editText, setEditText] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [cols, setCols] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("gin.columns") || "null");
      if (!Array.isArray(saved)) return defaultColumns;
      return localStorage.getItem("gin.columns.schema") === "2"
        ? saved
        : [...new Set([...saved, "platform", "kind"])];
    } catch {
      return defaultColumns;
    }
  });
  const loadSequence = useRef(0);
  const load = async () => {
    const request = ++loadSequence.current;
    try {
      const data = await api<{ items: Note[]; total: number; tags?: string[] }>(
        "/collections?" +
          new URLSearchParams({
            q,
            tag,
            page: String(page),
            page_size: String(pageSize),
            sort,
            order,
            deleted: String(trash),
          }),
      );
      // Filters and page changes can overlap. Only the newest request may
      // replace the visible result, otherwise an older response resurrects
      // notes that no longer match the active query.
      if (request !== loadSequence.current) return;
      setItems(data.items);
      setTotal(data.total);
      setKnownTags([
        ...new Set([
          ...suggestedNoteTags,
          ...(data.tags || []),
          ...data.items.flatMap((n) => n.tags || []),
        ]),
      ]);
      if (page > 1 && data.items.length === 0)
        setPage(Math.max(1, Math.ceil(data.total / pageSize)));
    } catch (e) {
      if (request === loadSequence.current) message.error((e as Error).message);
    }
  };
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [q, tag, page, pageSize, sort, order, tick, trash]);
  useEffect(() => {
    if (!detailID) return;
    let active = true;
    collectionRef.current
      ?.querySelectorAll("video")
      .forEach((video) => video.pause());
    api<Detail>("/collections/" + detailID)
      .then((result) => {
        if (active) setDetail(result);
      })
      .catch((error) => {
        if (active) message.error(error.message);
      });
    return () => {
      active = false;
    };
  }, [detailID, tick]);
  const submit = async (input = text) => {
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      const res = await post<{
        items: {
          job_id?: string;
          note_id?: string;
          duplicate?: boolean;
          deleted?: boolean;
          platform?: string;
          url?: string;
        }[];
      }>("/collections", { text: input });
      setCaptureItems(res.items);
      setCaptureOpen(true);
      setCaptureJobs(
        res.items.flatMap((item) => (item.job_id ? [item.job_id] : [])),
      );
      setText("");
      const duplicates = res.items.filter((x) => x.duplicate);
      if (res.items.some((x) => x.deleted)) {
        message.info("部分笔记已在回收站，可切换到回收站恢复，无需重复采集");
      }
      message.success(
        `已提交 ${res.items.length - duplicates.length} 条任务${duplicates.length ? `，${duplicates.length} 条已存在` : ""}`,
      );
      await refresh();
      load();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };
  const changeDeleted = async (ids: string[], deleted: boolean) => {
    setChanging(true);
    try {
      await post(
        deleted ? "/collections/batch-delete" : "/collections/batch-restore",
        { ids },
      );
      setSelected(selected.filter((id) => !ids.includes(String(id))));
      if (ids.includes(detailID)) {
        setDetailID("");
        setDetail(undefined);
      }
      message.success(
        deleted
          ? `已将 ${ids.length} 篇笔记移至回收站`
          : `已恢复 ${ids.length} 篇笔记`,
      );
      await refresh();
      await load();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setChanging(false);
    }
  };
  const confirmDelete = (ids: string[], title?: string) =>
    modal.confirm({
      icon: (
        <ConfirmActionIcon
          fallback={<DeleteOutlined style={{ color: "#6f8b7b" }} />}
        />
      ),
      title: title ? `删除「${title}」？` : `删除选中的 ${ids.length} 篇笔记？`,
      content:
        "笔记将移至回收站，可随时恢复。已生成的仿写、发布稿和本地素材会保留。",
      okText: "移至回收站",
      cancelText: "取消",
      okType: "default",
      onOk: () => changeDeleted(ids, true),
    });
  const copyExtraction = async (extraction: Extraction) => {
    const text =
      extraction.kind === "asr" && extraction.segments?.length
        ? extraction.segments.map((segment) => segment.text).join("\n")
        : extraction.text;
    try {
      await navigator.clipboard.writeText(text);
      message.success("已复制");
    } catch {
      message.error("复制失败，请手动选择文字复制");
    }
  };
  const confirmPurge = (ids: string[], title?: string) =>
    modal.confirm({
      icon: <ConfirmActionIcon />,
      title: title
        ? `彻底删除「${title}」？`
        : `彻底删除选中的 ${ids.length} 篇笔记？`,
      content:
        "此操作不可恢复。笔记记录、未被引用的来源和采集素材将被删除；仿写、发布稿及其引用的内容会保留。",
      okText: "确认彻底删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        setChanging(true);
        try {
          const result = await post<{ count: number; cleanup_job_id: string }>(
            "/collections/batch-purge",
            { ids, confirm: true },
          );
          setSelected((keys) => keys.filter((id) => !ids.includes(String(id))));
          if (ids.includes(detailID)) {
            setDetailID("");
            setDetail(undefined);
          }
          message.success(
            `已彻底删除 ${result.count} 篇笔记${result.cleanup_job_id ? "，未引用素材正在后台清理" : ""}`,
          );
          await refresh();
          await load();
        } catch (e) {
          message.error((e as Error).message);
          throw e;
        } finally {
          setChanging(false);
        }
      },
    });
  const stages = (note: Note) => {
    const state = collectionState(note, assets, jobs);
    return (
      <Tag color={state.color} title={state.reason}>
        {state.label}
      </Tag>
    );
  };
  const onNoteSaved = (saved: Note) => {
    setItems((old) =>
      old.map((item) => (item.id === saved.id ? { ...item, ...saved } : item)),
    );
    setKnownTags((old) => [...new Set([...old, ...(saved.tags || [])])]);
    setDetail((old) =>
      old?.note.id === saved.id
        ? { ...old, note: { ...old.note, ...saved } }
        : old,
    );
  };
  const deleteTag = async (value: string) => {
    if (changing || deletingTag.current) return;
    deletingTag.current = true;
    setChanging(true);
    try {
      await post("/collections/tags/delete", { tag: value });
      setKnownTags((old) => old.filter((tag) => tag !== value));
      setItems((old) =>
        old.map((note) => ({
          ...note,
          tags: (note.tags || []).filter((tag) => tag !== value),
        })),
      );
      setDetail((old) =>
        old
          ? {
              ...old,
              note: {
                ...old.note,
                tags: (old.note.tags || []).filter((tag) => tag !== value),
              },
            }
          : old,
      );
      if (tag === value) setTag("");
      await refresh();
      if (tag !== value) await load();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      deletingTag.current = false;
      setChanging(false);
    }
  };
  const columnOptions = [
    ["tags", "分类标签"],
    ["platform", "来源平台"],
    ["kind", "笔记类型"],
    ["author", "博主"],
    ["likes", "点赞"],
    ["favorites", "收藏"],
    ["comments", "评论"],
    ["ratios", "赞藏 / 赞评"],
    ["time", "采集时间"],
    ["state", "状态"],
  ];
  const count = (n: number | null) =>
    n == null
      ? "—"
      : n >= 1000
        ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k"
        : String(n);
  const tableColumns: TableColumnsType<Note> = [
    {
      title: "笔记",
      key: "note",
      width: 320,
      render: (_: unknown, note: Note) => {
        const cover = assets.find(
          (asset) =>
            asset.revision_id === note.revision_id &&
            asset.kind === "image" &&
            !asset.deleted_at,
        );
        return (
          <div className="note-cell collection-note-cell">
            <div className="collection-note-cover">
              {cover ? (
                <Image
                  width={72}
                  height={96}
                  src={previewURL(cover)}
                  alt={`${note.title || "笔记"}封面`}
                  style={{ objectFit: "cover" }}
                />
              ) : note.kind === "video" ? (
                <VideoCameraOutlined />
              ) : (
                <FileImageOutlined />
              )}
            </div>
            <button
              className="collection-note-open"
              aria-label={`查看笔记 ${note.title || "未命名笔记"}`}
              onClick={() => openCollection(note)}
            >
              <strong>{note.title || "未命名笔记"}</strong>
              {(cols.includes("platform") || cols.includes("kind")) && (
                <span className="collection-note-meta">
                  {cols.includes("platform") && (
                    <span
                      className={`platform-badge platform-badge-${note.platform === "douyin" ? "douyin" : "xiaohongshu"}`}
                    >
                      {note.platform === "douyin" ? "抖音" : "小红书"}
                    </span>
                  )}
                  {cols.includes("kind") && (
                    <span className="collection-note-kind">
                      {note.kind === "video" ? "视频笔记" : "图文笔记"}
                    </span>
                  )}
                </span>
              )}
            </button>
          </div>
        );
      },
    },
    ...columnOptions
      .filter(
        ([key]) => key !== "platform" && key !== "kind" && cols.includes(key),
      )
      .map(([key, label]) => ({
        title: label,
        key,
        width: key === "time" ? 176 : key === "tags" ? 224 : 96,
        render: (_: unknown, n: Note) => {
          switch (key) {
            case "author":
              return <span className="author-name">{n.author || "—"}</span>;
            case "likes":
            case "favorites":
            case "comments":
              return count(n[key]);
            case "ratios":
              return (
                (n.likes !== null && n.favorites
                  ? (n.likes / n.favorites).toFixed(2)
                  : "—") +
                " / " +
                (n.likes !== null && n.comments
                  ? (n.likes / n.comments).toFixed(2)
                  : "—")
              );
            case "time":
              return <small className="muted">{date(n.updated_at)}</small>;
            case "tags":
              return (
                <div className="collection-list-curation">
                  <NoteCuration
                    note={n}
                    tags={knownTags}
                    disabled={trash || changing}
                    onDeleteTag={deleteTag}
                    onSaved={onNoteSaved}
                  />
                </div>
              );
            case "state":
              return stages(n);
          }
        },
      })),
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 192,
      render: (_: unknown, n: Note) =>
        trash ? (
          <Space
            size={0}
            direction="vertical"
            className="collection-row-actions"
          >
            <Button
              type="link"
              icon={<UndoOutlined />}
              disabled={changing}
              onClick={() => changeDeleted([n.id], false)}
            >
              恢复
            </Button>
            <Button
              type="link"
              danger
              disabled={changing}
              onClick={() => confirmPurge([n.id], n.title)}
            >
              彻底删除
            </Button>
          </Space>
        ) : (
          <Space
            size={0}
            direction="vertical"
            className="collection-row-actions"
          >
            <Button
              type="link"
              icon={<PlusOutlined />}
              onClick={() => onCreate(n.id)}
            >
              {existingNoteIDs.has(n.id) ? "查看仿写项目" : "去仿写"}
            </Button>
            <Button
              type="link"
              className="neutral-action"
              icon={<EyeOutlined />}
              onClick={() => {
                setDetailID(n.id);
              }}
            >
              查看详情
            </Button>
            <Button
              type="link"
              danger
              icon={<DeleteOutlined />}
              disabled={changing}
              onClick={() => confirmDelete([n.id], n.title)}
            >
              删除采集记录
            </Button>
          </Space>
        ),
    },
  ];
  return (
    <>
      <Modal
        title="本次采集进度"
        open={captureOpen}
        onCancel={() => setCaptureOpen(false)}
        footer={
          <Button onClick={() => setCaptureOpen(false)}>关闭，后台继续</Button>
        }
      >
        <p>
          已完成{" "}
          {
            captureItems.filter(
              (item) =>
                item.duplicate ||
                item.deleted ||
                jobs.some(
                  (j) =>
                    j.id === item.job_id &&
                    !["queued", "running"].includes(j.state),
                ),
            ).length
          }{" "}
          / {captureItems.length} 条
        </p>
        {captureItems.map((item, index) => {
          const job = jobs.find((j) => j.id === item.job_id);
          const related = jobs.filter(
            (j) =>
              j.task_project?.category === "collect" &&
              j.task_project.id === (item.note_id || job?.result),
          );
          return (
            <div key={item.job_id || index} style={{ marginBottom: 16 }}>
              <p style={{ overflowWrap: "anywhere" }}>
                {item.url || `链接 ${index + 1}`}
              </p>
              <Alert
                showIcon
                type={
                  job?.state === "failed"
                    ? "error"
                    : job?.state === "succeeded"
                      ? "success"
                      : "info"
                }
                message={
                  item.deleted
                    ? "已在回收站"
                    : item.duplicate
                      ? "笔记已存在"
                      : job?.error || job?.stage || "排队中"
                }
              />
              {related
                .filter((j) => j.id !== job?.id)
                .map((j) => (
                  <p key={j.id}>{j.error || j.stage}</p>
                ))}
            </div>
          );
        })}
      </Modal>
      <div ref={collectionRef}>
        {!trash && (
          <section className="capture-card">
            <div id="capture-inputs">
              <div className="capture-title">
                <CloudDownloadOutlined />
                <div>
                  <strong>添加新的灵感</strong>
                </div>
              </div>
              <Input.TextArea
                aria-label="笔记链接或分享文字"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  "隔行粘贴小红书或抖音链接，最多50条。\n小红书示例：https://www.xiaohongshu.com/explore/笔记ID\n抖音示例：https://v.douyin.com/分享码/"
                }
                autoSize={{ minRows: 3, maxRows: 8 }}
              />
              <div className="capture-foot">
                <Space wrap>
                  <Button
                    className="capture-clear"
                    disabled={sending}
                    onClick={() => setText("")}
                  >
                    清空
                  </Button>
                  <Button
                    className={`capture-start${captureActive ? " capture-active" : ""}`}
                    data-collecting={captureActive}
                    type="primary"
                    icon={<CloudDownloadOutlined />}
                    loading={sending}
                    disabled={sending}
                    onClick={() => submit()}
                  >
                    开始采集
                  </Button>
                </Space>
              </div>
            </div>
          </section>
        )}
        <section className="table-panel">
          <div className="panel-toolbar collection-tools-header">
            <div className="panel-tabs">
              <strong>
                {trash ? "回收站" : "采集笔记"} <span>{total}</span>
                {!trash && <em className="collection-count-label">篇灵感</em>}
              </strong>
            </div>
            <div className="collection-primary-tools">
              <Input
                aria-label="搜索采集笔记"
                prefix={<SearchOutlined />}
                placeholder="搜索标题、正文或博主"
                allowClear
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                style={{ width: 230 }}
              />

              <Select
                aria-label="分类标签筛选"
                value={tag}
                showSearch
                options={[
                  { value: "", label: "全部标签" },
                  ...knownTags.map((value) => ({ value, label: value })),
                ]}
                onChange={(value) => {
                  setTag(value);
                  setPage(1);
                }}
              />
              <Select
                aria-label="笔记排序"
                value={sort + ":" + order}
                onChange={(value) => {
                  const [field, direction] = value.split(":");
                  setSort(field);
                  setOrder(direction);
                  setPage(1);
                }}
                options={[
                  { value: "updated_at:desc", label: "最新采集" },
                  { value: "updated_at:asc", label: "最早采集" },
                  { value: "likes:desc", label: "点赞最多" },
                  { value: "favorites:desc", label: "收藏最多" },
                  { value: "comments:desc", label: "评论最多" },
                  { value: "rating:desc", label: "评分最高" },
                ]}
              />
              {viewMode === "list" && (
                <Popover
                  classNames={{ root: "collection-columns-popover" }}
                  trigger="click"
                  placement="bottomRight"
                  open={columnsOpen}
                  onOpenChange={setColumnsOpen}
                  content={
                    <div className="collection-column-options">
                      <strong>列表列配置</strong>
                      <Checkbox.Group
                        value={cols}
                        onChange={(v) => {
                          setCols(v as string[]);
                          localStorage.setItem(
                            "gin.columns",
                            JSON.stringify(v),
                          );
                          localStorage.setItem("gin.columns.schema", "2");
                        }}
                        options={columnOptions.map(([value, label]) => ({
                          value,
                          label,
                        }))}
                      />
                    </div>
                  }
                >
                  <Button
                    icon={<SettingOutlined />}
                    aria-expanded={columnsOpen}
                    aria-label="列配置"
                  >
                    列配置
                  </Button>
                </Popover>
              )}
              <Segmented
                aria-label="采集库视图"
                value={viewMode}
                onChange={(value) => {
                  const next = value as "grid" | "list";
                  setViewMode(next);
                  setColumnsOpen(false);
                  localStorage.setItem("rednote.collection.view", next);
                }}
                options={[
                  {
                    value: "grid",
                    icon: (
                      <span title="卡片视图">
                        <AppstoreOutlined />
                      </span>
                    ),
                  },
                  {
                    value: "list",
                    icon: (
                      <span title="列表视图">
                        <UnorderedListOutlined />
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          </div>
          {(tag || sort !== "updated_at" || order !== "desc") && (
            <div className="filter-line">
              <Space wrap>
                {tag && (
                  <Tag
                    closable
                    onClose={() => {
                      setTag("");
                      setPage(1);
                    }}
                  >
                    分类：{tag}
                  </Tag>
                )}
                <Button
                  size="small"
                  type="link"
                  onClick={() => {
                    setTag("");
                    setSort("updated_at");
                    setOrder("desc");
                    setPage(1);
                  }}
                >
                  重置筛选
                </Button>
              </Space>
            </div>
          )}
          <div className="collection-selection-bar">
            <Checkbox
              checked={
                items.length > 0 &&
                items.every((note) => selected.includes(note.id))
              }
              indeterminate={
                items.some((note) => selected.includes(note.id)) &&
                !items.every((note) => selected.includes(note.id))
              }
              onChange={(event) => {
                const pageIDs = items.map((note) => note.id);
                setSelected(
                  event.target.checked
                    ? [...new Set([...selected, ...pageIDs])]
                    : selected.filter((id) => !pageIDs.includes(String(id))),
                );
              }}
            >
              选择本页
            </Checkbox>
            {selected.length > 0 && (
              <div className="collection-batch-actions">
                <Button
                  size="small"
                  type={trash ? "default" : "text"}
                  className={trash ? undefined : "collection-batch-delete"}
                  disabled={changing}
                  onClick={() =>
                    trash
                      ? changeDeleted(selected.map(String), false)
                      : confirmDelete(selected.map(String))
                  }
                >
                  {trash ? "批量恢复" : "批量删除"}
                </Button>
                {!trash && (
                  <Button
                    size="small"
                    type="primary"
                    disabled={selected.every((id) =>
                      existingNoteIDs.has(String(id)),
                    )}
                    onClick={async () => {
                      for (const id of selected) {
                        if (!existingNoteIDs.has(String(id)))
                          await onCreate(String(id));
                      }
                      setSelected([]);
                    }}
                  >
                    批量加入仿写库
                  </Button>
                )}
                {trash && (
                  <Button
                    size="small"
                    danger
                    disabled={changing}
                    onClick={() => confirmPurge(selected.map(String))}
                  >
                    批量彻底删除
                  </Button>
                )}
              </div>
            )}
          </div>
          {viewMode === "grid" ? (
            <div className="collection-grid-wrap">
              {items.length ? (
                <MasonryGrid>
                  {items.map((note) => {
                    const displayText = splitNoteText(note.body, note.topics);
                    const media = assets
                      .filter(
                        (asset) =>
                          asset.revision_id === note.revision_id &&
                          (asset.kind === "image" || asset.kind === "video") &&
                          !asset.deleted_at,
                      )
                      .sort((a, b) =>
                        note.kind === "video" && a.kind !== b.kind
                          ? a.kind === "video"
                            ? -1
                            : 1
                          : a.position - b.position,
                      );
                    const isSelected = selected.includes(note.id);
                    return (
                      <article
                        className="collection-card"
                        key={note.id}
                        onClick={() => openCollection(note)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (
                            event.target === event.currentTarget &&
                            (event.key === "Enter" || event.key === " ")
                          ) {
                            event.preventDefault();
                            openCollection(note);
                          }
                        }}
                      >
                        <div className="collection-card-author">
                          <span className="collection-card-avatar">
                            <UserOutlined />
                          </span>
                          <span className="collection-card-author-name">
                            {note.author || "未知博主"}
                          </span>
                          <div
                            className="collection-card-actions"
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                          >
                            {note.url && (
                              <a
                                href={note.url}
                                target="_blank"
                                rel="noreferrer"
                                aria-label="打开原始笔记"
                              >
                                <LinkOutlined />
                              </a>
                            )}
                            {trash && (
                              <button
                                className="collection-card-restore"
                                aria-label="恢复采集记录"
                                title="恢复笔记"
                                disabled={changing}
                                onClick={() =>
                                  void changeDeleted([note.id], false)
                                }
                              >
                                <UndoOutlined />
                              </button>
                            )}
                            <button
                              className="collection-card-delete"
                              aria-label={
                                trash ? "彻底删除采集记录" : "删除采集记录"
                              }
                              title={trash ? "彻底删除" : "删除笔记"}
                              disabled={changing}
                              onClick={() =>
                                trash
                                  ? confirmPurge([note.id], note.title)
                                  : confirmDelete([note.id], note.title)
                              }
                            >
                              <DeleteOutlined />
                            </button>
                            <Checkbox
                              aria-label={`选择笔记 ${note.title || "未命名笔记"}`}
                              checked={isSelected}
                              onChange={(event) =>
                                setSelected(
                                  event.target.checked
                                    ? [...new Set([...selected, note.id])]
                                    : selected.filter(
                                        (id) => String(id) !== note.id,
                                      ),
                                )
                              }
                            />
                          </div>
                        </div>
                        <CollectionCardCarousel
                          note={note}
                          media={media}
                          previewURL={previewURL}
                        />
                        <div className="collection-card-body">
                          <strong>{note.title || "等待采集元数据"}</strong>
                          {!!note.tags?.length && (
                            <div
                              className="collection-card-tags"
                              role="list"
                              aria-label="分类标签"
                            >
                              {note.tags.slice(0, 2).map((tag) => (
                                <Tag key={tag} role="listitem" title={tag}>
                                  {tag}
                                </Tag>
                              ))}
                              {note.tags.length > 2 && (
                                <Tag
                                  role="listitem"
                                  title={note.tags.slice(2).join("、")}
                                >
                                  +{note.tags.length - 2}
                                </Tag>
                              )}
                            </div>
                          )}
                          {displayText.body && (
                            <p
                              className="collection-card-copy"
                              aria-label="卡片文案"
                            >
                              {displayText.body}
                            </p>
                          )}
                          {!!displayText.topics.length && (
                            <p className="note-original-topics">
                              {displayText.topics
                                .slice(0, 4)
                                .map((tag) => `#${tag}`)
                                .join(" ")}
                            </p>
                          )}
                        </div>
                        <div className="collection-card-stats">
                          <span
                            aria-label={`点赞 ${note.likes ?? "未知"}`}
                            title={`点赞 ${note.likes ?? "未知"}`}
                          >
                            <HeartOutlined /> {count(note.likes)}
                          </span>
                          <span
                            aria-label={`收藏 ${note.favorites ?? "未知"}`}
                            title={`收藏 ${note.favorites ?? "未知"}`}
                          >
                            <StarOutlined /> {count(note.favorites)}
                          </span>
                          <span
                            aria-label={`评论 ${note.comments ?? "未知"}`}
                            title={`评论 ${note.comments ?? "未知"}`}
                          >
                            <MessageOutlined /> {count(note.comments)}
                          </span>
                        </div>
                        <div
                          className="collection-card-footer"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <NoteCuration
                            note={note}
                            tags={knownTags}
                            disabled={trash || changing}
                            onDeleteTag={deleteTag}
                            onSaved={onNoteSaved}
                            compact
                            action={
                              !trash && (
                                <button
                                  className="collection-card-add"
                                  onClick={() => void onCreate(note.id)}
                                >
                                  {existingNoteIDs.has(note.id)
                                    ? "查看仿写项目"
                                    : "去仿写"}{" "}
                                  <ArrowRightOutlined />
                                </button>
                              )
                            }
                          />
                        </div>
                      </article>
                    );
                  })}
                </MasonryGrid>
              ) : (
                <div className="collection-grid-empty">
                  <Empty
                    description={trash ? "回收站为空" : "还没有采集笔记"}
                  />
                  {!trash && (
                    <Button onClick={() => onCreate()}>
                      也可以直接开始创作 <ArrowRightOutlined />
                    </Button>
                  )}
                </div>
              )}
              <div className="collection-grid-pagination">
                <Pagination
                  current={page}
                  pageSize={pageSize}
                  total={total}
                  showSizeChanger
                  pageSizeOptions={[10, 20, 50]}
                  showTotal={(count) => `共 ${count} 篇笔记`}
                  onChange={(nextPage, nextSize) => {
                    setPage(nextPage);
                    setPageSize(nextSize);
                  }}
                />
              </div>
            </div>
          ) : (
            <Table
              rowKey="id"
              tableLayout="fixed"
              dataSource={items}
              columns={tableColumns}
              rowSelection={{
                columnWidth: 48,
                hideSelectAll: true,
                selectedRowKeys: selected,
                onChange: setSelected,
                preserveSelectedRowKeys: true,
              }}
              scroll={{
                x: tableColumns.reduce(
                  (width, column) =>
                    width + Number(("width" in column && column.width) || 100),
                  48,
                ),
              }}
              pagination={{
                current: page,
                pageSize,
                total,
                showSizeChanger: true,
                pageSizeOptions: [10, 20, 50],
                showTotal: (t) => `共 ${t} 篇笔记`,
                onChange: (p, s) => {
                  setPage(p);
                  setPageSize(s);
                },
              }}
              locale={{
                emptyText: trash ? (
                  <Empty description="回收站为空" />
                ) : (
                  <div className="empty-library">
                    <div className="empty-art">
                      <LinkOutlined />
                      <span className="empty-art-small">
                        <FileImageOutlined />
                      </span>
                    </div>
                    <h3>你的下一篇好内容，从一份灵感开始</h3>
                    <p>在上方粘贴笔记链接，原文、图片和视频会整理在这里。</p>
                    <Button onClick={() => onCreate()}>
                      也可以直接开始创作 <ArrowRightOutlined />
                    </Button>
                  </div>
                ),
              }}
            />
          )}
        </section>
      </div>
      <Modal
        title="笔记详情"
        className="collection-note-modal"
        open={!!detailID}
        centered
        width={920}
        destroyOnHidden
        onCancel={() => {
          setDetailID("");
          setDetail(undefined);
        }}
        footer={
          detail ? (
            <div className="collection-note-dialog-actions">
              {detail.note.deleted_at ? (
                <>
                  <Button
                    type="primary"
                    disabled={changing}
                    onClick={() => changeDeleted([detail.note.id], false)}
                  >
                    恢复笔记
                  </Button>
                  <Button
                    danger
                    disabled={changing}
                    onClick={() =>
                      confirmPurge([detail.note.id], detail.note.title)
                    }
                  >
                    彻底删除
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    icon={<LinkOutlined />}
                    href={detail.note.url || undefined}
                    disabled={!detail.note.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    参考链接
                  </Button>
                  <Button
                    type="primary"
                    icon={<ArrowRightOutlined />}
                    onClick={() => onCreate(detail.note.id)}
                  >
                    {existingNoteIDs.has(detail.note.id)
                      ? "查看仿写项目"
                      : "以此笔记开始仿写"}
                  </Button>
                </>
              )}
            </div>
          ) : null
        }
      >
        {detail ? (
          <div className="collection-note-dialog-layout">
            <section className="collection-note-dialog-content">
              <p className="collection-note-dialog-author">
                {detail.note.platform === "douyin" ? "抖音" : "小红书"} ·{" "}
                {detail.note.author || "未知博主"} ·{" "}
                {detail.note.kind === "video" ? "视频笔记" : "图文笔记"}
              </p>
              <h2>
                {detail.revision.title || detail.note.title || "未命名笔记"}
              </h2>
              <div
                className="collection-note-dialog-copy"
                role="region"
                aria-label="笔记文案"
                tabIndex={0}
              >
                <p className="source-body">{detailText.body || "暂无文案"}</p>
              </div>
              {detailText.topics.length > 0 && (
                <div
                  className="collection-note-dialog-topics"
                  aria-label="笔记话题"
                >
                  {detailText.topics.map((topic) => (
                    <span key={topic}>#{topic}</span>
                  ))}
                </div>
              )}
            </section>
            <Tabs
              className="collection-note-dialog-media"
              destroyOnHidden
              items={[
                {
                  key: "original",
                  label: "素材预览",
                  children: (
                    <>
                      <Image.PreviewGroup>
                        <CollectionCardCarousel
                          key={detail.revision.id}
                          showDots={false}
                          note={detail.note}
                          media={detail.assets}
                          previewURL={previewURL}
                          renderAsset={(a) => (
                            <div className="detail-asset" key={a.id}>
                              {!a.deleted_at ? (
                                a.kind === "image" ? (
                                  <Image
                                    src={previewURL(a)}
                                    alt={a.name}
                                    preview={{ mask: "查看完整图片" }}
                                  />
                                ) : (
                                  <video
                                    controls
                                    playsInline
                                    aria-label={a.name || "笔记视频"}
                                    preload="metadata"
                                    src={previewURL(a)}
                                  />
                                )
                              ) : (
                                <Alert
                                  type="warning"
                                  message="素材已在回收站"
                                />
                              )}
                              {a.status !== "ready" && !a.deleted_at && (
                                <p className="muted">
                                  {downloadActive(a.id)
                                    ? "正在自动保存…"
                                    : a.error || "在线预览 · 正在等待保存"}
                                </p>
                              )}
                              <div className="collection-asset-actions">
                                {a.status !== "ready" &&
                                  !a.deleted_at &&
                                  !detail.note.deleted_at && (
                                    <Button
                                      size="small"
                                      icon={<ReloadOutlined />}
                                      loading={downloadActive(a.id)}
                                      disabled={downloadSubmitting}
                                      onClick={() => downloadMedia([a.id])}
                                    >
                                      {a.status === "failed"
                                        ? "重试保存"
                                        : "重试保存"}
                                    </Button>
                                  )}
                                {a.status === "ready" && !a.deleted_at && (
                                  <>
                                    {a.library_state === "collected" ? (
                                      <Button
                                        size="small"
                                        icon={<FolderAddOutlined />}
                                        onClick={async () => {
                                          try {
                                            const saved = await post<Asset>(
                                              "/assets/" +
                                                a.id +
                                                "/save-to-library",
                                              {},
                                            );
                                            setDetail((current) =>
                                              current
                                                ? {
                                                    ...current,
                                                    assets: current.assets.map(
                                                      (asset) =>
                                                        asset.id === saved.id
                                                          ? saved
                                                          : asset,
                                                    ),
                                                  }
                                                : current,
                                            );
                                            await refresh();
                                          } catch (error) {
                                            message.error(
                                              (error as Error).message,
                                            );
                                          }
                                        }}
                                      >
                                        加入素材库
                                      </Button>
                                    ) : (
                                      <Button
                                        size="small"
                                        icon={<CheckOutlined />}
                                        disabled
                                      >
                                        已在素材库
                                      </Button>
                                    )}
                                    <Button
                                      size="small"
                                      icon={<DownloadOutlined />}
                                      href={fileURL(a.id) + "?download=1"}
                                    >
                                      下载
                                    </Button>
                                    <Button
                                      size="small"
                                      icon={
                                        a.kind === "image" ? (
                                          <FileTextOutlined />
                                        ) : (
                                          <AudioOutlined />
                                        )
                                      }
                                      loading={
                                        extracting.includes(a.id) ||
                                        jobs.some(
                                          (j) =>
                                            j.target === a.id &&
                                            ["ocr", "asr"].includes(j.kind) &&
                                            ["queued", "running"].includes(
                                              j.state,
                                            ),
                                        )
                                      }
                                      onClick={async () => {
                                        if (extracting.includes(a.id)) return;
                                        setExtracting((old) => [...old, a.id]);
                                        try {
                                          const result = await post<{
                                            job_id: string;
                                          }>("/assets/" + a.id + "/extract");
                                          const label =
                                            a.kind === "image"
                                              ? "文字提取"
                                              : "音频转写";
                                          pendingExtractions.current.set(
                                            result.job_id,
                                            label,
                                          );
                                          message.loading({
                                            key: result.job_id,
                                            content: label + "处理中…",
                                            duration: 0,
                                          });
                                          refresh();
                                        } catch (e) {
                                          message.error((e as Error).message);
                                        } finally {
                                          setExtracting((old) =>
                                            old.filter((id) => id !== a.id),
                                          );
                                        }
                                      }}
                                    >
                                      {a.kind === "image"
                                        ? "提取文字"
                                        : "转写音频"}
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        />
                      </Image.PreviewGroup>
                    </>
                  ),
                },
                ...["ocr", "asr"].map((extractionKind) => ({
                  key: extractionKind,
                  label: extractionKind === "ocr" ? "提取图片文字" : "视频转写",
                  children: detail.extractions.some(
                    (x) => x.kind === extractionKind,
                  ) ? (
                    detail.extractions
                      .filter((x) => x.kind === extractionKind)
                      .map((x) => (
                        <div className="extraction-card" key={x.id}>
                          <div className="row-between">
                            <Space>
                              <Tag>
                                {x.kind === "ocr" ? "图片 OCR" : "视频转写"}
                              </Tag>
                              {x.edited && <Tag color="blue">已人工修正</Tag>}
                            </Space>
                            <Space size="small">
                              <Button
                                size="small"
                                type="text"
                                icon={<CopyOutlined />}
                                aria-label={
                                  x.kind === "ocr"
                                    ? "复制图片文字"
                                    : "复制视频转写"
                                }
                                title={
                                  x.kind === "ocr"
                                    ? "复制图片文字"
                                    : "复制视频转写"
                                }
                                onClick={() => copyExtraction(x)}
                              />
                              <Button
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => {
                                  setEditing(x);
                                  setEditText(x.text);
                                  setSegments(x.segments || []);
                                }}
                              >
                                修正
                              </Button>
                            </Space>
                          </div>
                          {x.kind === "asr" ? (
                            x.segments.map((s, i) => (
                              <p key={i}>
                                <small className="timecode">
                                  {(s.start_ms / 1000).toFixed(1)}–
                                  {(s.end_ms / 1000).toFixed(1)}s
                                </small>
                                {s.text}
                              </p>
                            ))
                          ) : (
                            <p className="source-body">{x.text}</p>
                          )}
                        </div>
                      ))
                  ) : (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={
                        extractionKind === "ocr"
                          ? "暂无图片文字提取结果，可在素材预览下方发起提取。"
                          : "暂无视频转写结果，可在素材预览下方发起转写。"
                      }
                    />
                  ),
                })),
              ]}
            />
          </div>
        ) : (
          <div className="collection-note-dialog-loading" role="status">
            正在加载笔记…
          </div>
        )}
      </Modal>
      <Modal
        title="修正文字提取结果"
        open={!!editing}
        onCancel={() => setEditing(undefined)}
        width={700}
        onOk={async () => {
          if (!editing) return;
          try {
            await patch("/extractions/" + editing.id, {
              text: editText,
              segments,
            });
            setEditing(undefined);
            const d = await api<Detail>("/collections/" + detailID);
            setDetail(d);
            message.success("已保存修正；已建立的仿写项目保留原来源快照");
          } catch (e) {
            message.error((e as Error).message);
          }
        }}
      >
        {editing?.kind === "ocr" ? (
          <Input.TextArea
            rows={14}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
          />
        ) : (
          segments.map((s, i) => (
            <div className="segment-editor" key={i}>
              <Space>
                <InputNumber
                  value={s.start_ms}
                  addonAfter="ms"
                  onChange={(v) =>
                    setSegments(
                      segments.map((x, k) =>
                        k === i ? { ...x, start_ms: v || 0 } : x,
                      ),
                    )
                  }
                />
                <span>→</span>
                <InputNumber
                  value={s.end_ms}
                  addonAfter="ms"
                  onChange={(v) =>
                    setSegments(
                      segments.map((x, k) =>
                        k === i ? { ...x, end_ms: v || 0 } : x,
                      ),
                    )
                  }
                />
              </Space>
              <Input.TextArea
                value={s.text}
                onChange={(e) =>
                  setSegments(
                    segments.map((x, k) =>
                      k === i ? { ...x, text: e.target.value } : x,
                    ),
                  )
                }
              />
            </div>
          ))
        )}
      </Modal>
    </>
  );
}
