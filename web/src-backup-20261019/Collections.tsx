import type { TableColumnsType } from "antd";
import {
  ArrowRightOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FileImageOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SlidersOutlined,
  UndoOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Drawer,
  Empty,
  Image,
  Input,
  InputNumber,
  Modal,
  Popover,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from "antd";
import { useEffect, useState } from "react";
import type {
  Asset,
  Extraction,
  Job,
  Note,
  Platform,
  Project,
  Segment,
} from "./api";
import { api, date, fileURL, patch, post, stateColor, stateLabel } from "./api";
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
export default function Collections({
  assets,
  projects = [],
  jobs,
  tick,
  onCreate,
  refresh,
}: {
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
  const [trash, setTrash] = useState(false);
  const [changing, setChanging] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [platform, setPlatform] = useState<Platform | "">("");
  const [tag, setTag] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState("updated_at");
  const [order, setOrder] = useState("desc");
  const [items, setItems] = useState<Note[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [detail, setDetail] = useState<Detail>();
  const [detailID, setDetailID] = useState("");
  const [revisionID, setRevisionID] = useState("");
  const [ocrSelected, setOcrSelected] = useState<string[]>([]);
  const [ocrSubmitting, setOcrSubmitting] = useState(false);
  const [downloadSelected, setDownloadSelected] = useState<string[]>([]);
  const [downloadSubmitting, setDownloadSubmitting] = useState(false);
  useEffect(() => setDownloadSelected([]), [detailID, revisionID]);
  const downloadActive = (id: string) =>
    jobs.some(
      (j) =>
        j.kind === "download" &&
        j.target === id &&
        ["queued", "running"].includes(j.state),
    );
  const downloadable =
    detail?.assets.filter(
      (a) => a.status !== "ready" && !a.deleted_at && !downloadActive(a.id),
    ) || [];
  const selectedDownloads = downloadSelected.filter((id) =>
    downloadable.some((a) => a.id === id),
  );
  const previewURL = (a: Asset) =>
    a.status === "ready" ? fileURL(a.id) : `/api/v1/assets/${a.id}/preview`;
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
      setDownloadSelected([]);
      await refresh();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setDownloadSubmitting(false);
    }
  };
  useEffect(() => setOcrSelected([]), [detailID, revisionID]);
  const ocrImages =
    detail?.assets.filter((a) => a.kind === "image" && a.status === "ready") ||
    [];
  const selectedImages = ocrSelected.filter((id) =>
    ocrImages.some((a) => a.id === id),
  );
  const extractSelectedImages = async () => {
    setOcrSubmitting(true);
    try {
      const result = await post<{ count: number }>("/assets/batch-extract", {
        ids: selectedImages,
      });
      message.success(`已提交 ${result.count} 张所选图片的文字提取任务`);
      setOcrSelected([]);
      await refresh();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setOcrSubmitting(false);
    }
  };
  const [editing, setEditing] = useState<Extraction>();
  const [editText, setEditText] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [recollect, setRecollect] = useState(false);
  const [freshLink, setFreshLink] = useState("");
  const [cols, setCols] = useState<string[]>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("gin.columns") || "null") || [
          "author",
          "likes",
          "favorites",
          "comments",
          "time",
          "tags",
          "state",
        ]
      );
    } catch {
      return [
        "author",
        "likes",
        "favorites",
        "comments",
        "time",
        "tags",
        "state",
      ];
    }
  });
  const load = async () => {
    try {
      const data = await api<{ items: Note[]; total: number }>(
        "/collections?" +
          new URLSearchParams({
            q,
            platform,
            kind,
            tag,
            page: String(page),
            page_size: String(pageSize),
            sort,
            order,
            deleted: String(trash),
          }),
      );
      setItems(data.items);
      setTotal(data.total);
      if (page > 1 && data.items.length === 0)
        setPage(Math.max(1, Math.ceil(data.total / pageSize)));
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [q, platform, kind, tag, page, pageSize, sort, order, tick, trash]);
  useEffect(() => {
    if (detailID)
      api<Detail>(
        "/collections/" +
          detailID +
          (revisionID ? "?revision_id=" + revisionID : ""),
      )
        .then(setDetail)
        .catch((e) => message.error(e.message));
  }, [detailID, revisionID, tick]);
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
        }[];
      }>("/collections", { text: input });
      setText("");
      const duplicates = res.items.filter((x) => x.duplicate);
      if (res.items.some((x) => x.deleted)) {
        message.info("部分笔记已在回收站，可切换到回收站恢复，无需重复采集");
      }
      message.success(
        `已提交 ${res.items.length - duplicates.length} 条任务${duplicates.length ? `，${duplicates.length} 条已存在` : ""}`,
      );
      if (res.items.length === 1 && duplicates.length)
        setDetailID(duplicates[0].note_id!);
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
      title: title ? `删除「${title}」？` : `删除选中的 ${ids.length} 篇笔记？`,
      content:
        "笔记将移至回收站，可随时恢复。已生成的仿写、发布稿和本地素材会保留。",
      okText: "移至回收站",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => changeDeleted(ids, true),
    });
  const confirmPurge = (ids: string[], title?: string) =>
    modal.confirm({
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
  const stages = (n: Note) => {
    const ms = assets.filter((a) => a.revision_id === n.revision_id);
    if (ms.some((a) => a.status === "failed"))
      return <Tag color="orange">媒体部分失败</Tag>;
    if (ms.some((a) => downloadActive(a.id)))
      return <Tag color="blue">下载中</Tag>;
    const exJobs = jobs.filter(
      (j) =>
        ms.some((a) => a.id === j.target) && ["ocr", "asr"].includes(j.kind),
    );
    if (exJobs.some((j) => j.state === "blocked"))
      return <Tag color="gold">文字待配置</Tag>;
    if (exJobs.some((j) => ["failed", "needs_review"].includes(j.state)))
      return <Tag color="orange">提取待处理</Tag>;
    if (exJobs.some((j) => ["running", "queued"].includes(j.state)))
      return <Tag color="blue">文字提取中</Tag>;
    return <Tag color="green">已采集</Tag>;
  };
  const columnOptions = [
    ["author", "博主"],
    ["likes", "点赞"],
    ["favorites", "收藏"],
    ["comments", "评论"],
    ["ratios", "赞藏 / 赞评"],
    ["time", "采集时间"],
    ["tags", "分类标签"],
    ["state", "状态"],
  ];
  const count = (n: number | null) => (n === null ? "—" : n.toLocaleString());
  const tableColumns: TableColumnsType<Note> = [
    {
      title: "标题",
      key: "title",
      width: 270,
      render: (_: unknown, n: Note) => {
        return (
          <div
            className="note-cell"
            role="button"
            tabIndex={0}
            aria-label={`查看笔记 ${n.title || "未命名笔记"}`}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setRevisionID("");
                setDetailID(n.id);
              }
            }}
            onClick={() => {
              setRevisionID("");
              setDetailID(n.id);
            }}
          >
            <div>
              <strong>{n.title || "未命名笔记"}</strong>
              <small>
                <span
                  className={`platform-badge platform-badge-${n.platform === "douyin" ? "douyin" : "xiaohongshu"}`}
                >
                  {n.platform === "douyin" ? "抖音" : "小红书"}
                </span>
                {n.kind === "video" ? "视频笔记" : "图文笔记"}
              </small>
            </div>
          </div>
        );
      },
    },
    {
      title: "封面",
      key: "cover",
      width: 100,
      render: (_: unknown, n: Note) => {
        const cover = assets.find(
          (a) =>
            a.revision_id === n.revision_id &&
            a.kind === "image" &&
            !a.deleted_at,
        );
        return (
          <div className="collection-cover">
            {cover ? (
              <Image
                width={58}
                height={72}
                style={{ objectFit: "cover" }}
                src={previewURL(cover)}
              />
            ) : n.kind === "video" ? (
              <VideoCameraOutlined />
            ) : (
              <FileImageOutlined />
            )}
          </div>
        );
      },
    },
    ...columnOptions
      .filter(([key]) => cols.includes(key))
      .map(([key, label]) => ({
        title: label,
        key,
        width: key === "time" ? 170 : key === "tags" ? 140 : 100,
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
                <Space wrap>
                  {n.tags?.length ? (
                    n.tags.map((t) => <Tag key={t}>{t}</Tag>)
                  ) : (
                    <span className="muted">未分类</span>
                  )}
                </Space>
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
      width: 178,
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
              {existingNoteIDs.has(n.id) ? "查看仿写项目" : "加入仿写库"}
            </Button>
            <Button
              type="link"
              className="neutral-action"
              icon={<EyeOutlined />}
              onClick={() => {
                setRevisionID("");
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
      <section className="capture-card">
        <div className="capture-title">
          <CloudDownloadOutlined />
          <strong>采集小红书 / 抖音内容</strong>
        </div>
        <Input.TextArea
          aria-label="笔记链接或分享文字"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="粘贴小红书或抖音链接、短链接或完整分享文字。支持混合提交，多个链接使用空格或换行分隔。"
          autoSize={{ minRows: 4, maxRows: 8 }}
        />
        <div className="capture-foot">
          <Space wrap>
            <Button disabled={!text || sending} onClick={() => setText("")}>
              清空
            </Button>
            <Button
              type="primary"
              icon={<CloudDownloadOutlined />}
              loading={sending}
              disabled={!text.trim()}
              onClick={() => submit()}
            >
              开始采集
            </Button>
          </Space>
        </div>
      </section>
      <section className="table-panel">
        <div className="panel-toolbar">
          <div className="panel-tabs">
            <strong>
              {trash ? "回收站" : "全部笔记"} <span>{total}</span>
            </strong>
          </div>
          <Space wrap>
            <Button
              icon={trash ? <UndoOutlined /> : <DeleteOutlined />}
              onClick={() => {
                setTrash(!trash);
                setPage(1);
                setSelected([]);
              }}
            >
              {trash ? "返回采集库" : "回收站"}
            </Button>
            <Input
              prefix={<SearchOutlined />}
              placeholder="搜索标题、博主或标签"
              allowClear
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              style={{ width: 230 }}
            />

            <Select
              aria-label="筛选采集平台"
              value={platform}
              onChange={(value) => {
                setPlatform(value);
                setPage(1);
                setSelected([]);
              }}
              style={{ width: 130 }}
              options={[
                { value: "", label: "全部平台" },
                { value: "xhs", label: "小红书" },
                { value: "douyin", label: "抖音" },
              ]}
            />
            <Select
              aria-label="笔记类型"
              value={kind}
              onChange={(v) => {
                setKind(v);
                setPage(1);
              }}
              style={{ width: 115 }}
              options={[
                { value: "", label: "全部类型" },
                { value: "image", label: "图文" },
                { value: "video", label: "视频" },
              ]}
            />
            <Popover
              trigger="click"
              placement="bottomRight"
              content={
                <div style={{ width: 160 }}>
                  <Checkbox.Group
                    value={cols}
                    onChange={(v) => {
                      setCols(v as string[]);
                      localStorage.setItem("gin.columns", JSON.stringify(v));
                    }}
                    options={columnOptions.map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                </div>
              }
            >
              <Button aria-label="列显示配置" icon={<SlidersOutlined />}>
                列配置
              </Button>
            </Popover>
            <Button
              aria-label="刷新采集库"
              icon={<ReloadOutlined />}
              onClick={() => {
                void load();
                void refresh();
              }}
            />
          </Space>
        </div>
        <div className="filter-line">
          <Space>
            <span className="muted">分类</span>
            <Input
              placeholder="分类标签"
              allowClear
              value={tag}
              onChange={(e) => {
                setTag(e.target.value);
                setPage(1);
              }}
              style={{ width: 150 }}
            />
            <Select
              value={sort + ":" + order}
              onChange={(v) => {
                const [s, o] = v.split(":");
                setSort(s);
                setOrder(o);
              }}
              options={[
                { value: "updated_at:desc", label: "最近采集优先" },
                { value: "updated_at:asc", label: "最早采集优先" },
                { value: "likes:desc", label: "点赞由高到低" },
                { value: "likes:asc", label: "点赞由低到高" },
              ]}
              style={{ width: 145 }}
            />
          </Space>
          {selected.length > 0 ? (
            <Space>
              <span>已选 {selected.length} 篇</span>
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
              <Button
                size="small"
                danger={!trash}
                disabled={changing}
                onClick={() =>
                  trash
                    ? changeDeleted(selected.map(String), false)
                    : confirmDelete(selected.map(String))
                }
              >
                {trash ? "批量恢复" : "批量删除"}
              </Button>
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
            </Space>
          ) : (
            <small className="muted">点击笔记查看详情</small>
          )}
        </div>
        <Table
          rowKey="id"
          dataSource={items}
          columns={tableColumns}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: setSelected,
            preserveSelectedRowKeys: true,
          }}
          scroll={{ x: 1200 }}
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
      </section>
      <Drawer
        width={780}
        title="笔记详情"
        open={!!detailID}
        onClose={() => {
          setDetailID("");
          setDetail(undefined);
        }}
        extra={
          detail &&
          (detail.note.deleted_at ? (
            <Space>
              <Button
                onClick={() => changeDeleted([detail.note.id], false)}
                disabled={changing}
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
            </Space>
          ) : (
            <Space>
              <Button type="primary" onClick={() => onCreate(detail.note.id)}>
                {existingNoteIDs.has(detail.note.id)
                  ? "查看仿写项目"
                  : "加入仿写库"}
              </Button>
              <Button
                danger
                disabled={changing}
                onClick={() =>
                  confirmDelete([detail.note.id], detail.note.title)
                }
              >
                删除
              </Button>
            </Space>
          ))
        }
      >
        {detail && (
          <>
            <div className="detail-heading">
              <Tag>{detail.note.kind === "image" ? "图文" : "视频"}</Tag>
              <h2>{detail.revision.title}</h2>
              <p className="muted">
                {detail.note.author} · 发布时间：
                {detail.revision.published_at || "—"}
              </p>
              <Space wrap>
                <Select
                  value={detail.revision.id}
                  style={{ width: 250 }}
                  options={detail.history.map((r, i) => ({
                    value: r.id,
                    label: `采集版本 ${detail.history.length - i} · ${date(r.created_at)}`,
                  }))}
                  onChange={setRevisionID}
                />
                <Button
                  onClick={() => {
                    setFreshLink(detail.note.url);
                    setRecollect(true);
                  }}
                >
                  重新采集
                </Button>
                <a href={detail.note.url} target="_blank" rel="noreferrer">
                  查看原笔记
                </a>
              </Space>
              <div className="tag-editor">
                <span>分类标签</span>
                <Select
                  mode="tags"
                  value={detail.note.tags}
                  placeholder="添加分类标签"
                  style={{ flex: 1 }}
                  onChange={async (tags) => {
                    try {
                      await patch("/collections/" + detail.note.id, { tags });
                      setDetail({ ...detail, note: { ...detail.note, tags } });
                      load();
                    } catch (e) {
                      message.error((e as Error).message);
                    }
                  }}
                />
              </div>
            </div>
            <Tabs
              items={[
                {
                  key: "original",
                  label: "原文与媒体",
                  children: (
                    <>
                      <p className="source-body">{detail.revision.body}</p>
                      <Space wrap>
                        {detail.revision.topics?.map((t) => (
                          <Tag color="blue" key={t}>
                            {t}
                          </Tag>
                        ))}
                      </Space>
                      <div style={{ margin: "16px 0" }}>
                        <p className="muted">
                          图片和视频不会自动下载到素材库。在线预览需要网络；选择需要的素材后下载，才能用于
                          OCR、转写和创作。预览失效时可打开原笔记或重新采集。
                        </p>
                        {!!downloadable.length && !detail.note.deleted_at && (
                          <Space wrap>
                            <Checkbox
                              disabled={downloadSubmitting}
                              checked={
                                selectedDownloads.length === downloadable.length
                              }
                              indeterminate={
                                selectedDownloads.length > 0 &&
                                selectedDownloads.length < downloadable.length
                              }
                              onChange={(e) =>
                                setDownloadSelected(
                                  e.target.checked
                                    ? downloadable.map((a) => a.id)
                                    : [],
                                )
                              }
                            >
                              全选未下载素材
                            </Checkbox>
                            <span>已选 {selectedDownloads.length} 份</span>
                            <Button
                              type="primary"
                              loading={downloadSubmitting}
                              disabled={
                                !selectedDownloads.length ||
                                selectedDownloads.length > 100
                              }
                              onClick={() => downloadMedia(selectedDownloads)}
                            >
                              下载所选到素材库
                            </Button>
                            {selectedDownloads.length > 100 && (
                              <span>每次最多选择 100 份</span>
                            )}
                          </Space>
                        )}
                      </div>
                      {ocrImages.length > 0 && (
                        <div style={{ margin: "16px 0" }}>
                          <p className="muted">
                            图片不会自动提取文字。勾选需要识别的图片后提交，也可以逐张点击「提取文字」。
                          </p>
                          <Space wrap>
                            <Checkbox
                              disabled={ocrSubmitting}
                              checked={
                                selectedImages.length === ocrImages.length
                              }
                              indeterminate={
                                selectedImages.length > 0 &&
                                selectedImages.length < ocrImages.length
                              }
                              onChange={(e) =>
                                setOcrSelected(
                                  e.target.checked
                                    ? ocrImages.map((a) => a.id)
                                    : [],
                                )
                              }
                            >
                              全选可用图片
                            </Checkbox>
                            <span>已选 {selectedImages.length} 张</span>
                            <Button
                              type="primary"
                              loading={ocrSubmitting}
                              disabled={
                                !selectedImages.length ||
                                selectedImages.length > 50
                              }
                              onClick={extractSelectedImages}
                            >
                              提取所选图片文字
                            </Button>
                            {selectedImages.length > 50 && (
                              <span>每次最多选择 50 张</span>
                            )}
                          </Space>
                        </div>
                      )}
                      <div className="detail-media">
                        <Image.PreviewGroup>
                          {detail.assets.map((a) => (
                            <div className="detail-asset" key={a.id}>
                              {a.status !== "ready" &&
                                !a.deleted_at &&
                                !detail.note.deleted_at && (
                                  <Checkbox
                                    style={{ marginBottom: 8 }}
                                    disabled={
                                      downloadSubmitting || downloadActive(a.id)
                                    }
                                    checked={selectedDownloads.includes(a.id)}
                                    onChange={(e) =>
                                      setDownloadSelected((old) =>
                                        e.target.checked
                                          ? [...new Set([...old, a.id])]
                                          : old.filter((id) => id !== a.id),
                                      )
                                    }
                                  >
                                    选择下载到素材库
                                  </Checkbox>
                                )}
                              {a.kind === "image" && a.status === "ready" && (
                                <Checkbox
                                  style={{ marginBottom: 8 }}
                                  disabled={ocrSubmitting}
                                  checked={selectedImages.includes(a.id)}
                                  onChange={(e) =>
                                    setOcrSelected((old) =>
                                      e.target.checked
                                        ? [...old, a.id]
                                        : old.filter((id) => id !== a.id),
                                    )
                                  }
                                >
                                  选择此图提取文字
                                </Checkbox>
                              )}
                              {!a.deleted_at ? (
                                a.kind === "image" ? (
                                  <Image src={previewURL(a)} alt={a.name} />
                                ) : (
                                  <video
                                    controls
                                    preload="none"
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
                                    ? "正在下载到素材库…"
                                    : a.error || "在线预览 · 尚未下载到素材库"}
                                </p>
                              )}
                              <div className="row-between">
                                <small>
                                  {a.role === "cover"
                                    ? "封面"
                                    : a.role === "live"
                                      ? "实况片段"
                                      : a.kind === "image"
                                        ? "图片"
                                        : "视频"}
                                </small>
                                <Space>
                                  {a.status !== "ready" &&
                                    !a.deleted_at &&
                                    !detail.note.deleted_at && (
                                      <Button
                                        size="small"
                                        loading={downloadActive(a.id)}
                                        disabled={downloadSubmitting}
                                        onClick={() => downloadMedia([a.id])}
                                      >
                                        {a.status === "failed"
                                          ? "重试下载到素材库"
                                          : "下载到素材库"}
                                      </Button>
                                    )}
                                  {a.status === "ready" && (
                                    <>
                                      <Tag color="green">已下载到素材库</Tag>
                                      <a href={fileURL(a.id) + "?download=1"}>
                                        下载
                                      </a>
                                      <Button
                                        size="small"
                                        onClick={async () => {
                                          try {
                                            await post(
                                              "/assets/" + a.id + "/extract",
                                            );
                                            message.success(
                                              "已提交文字提取任务",
                                            );
                                            refresh();
                                          } catch (e) {
                                            message.error((e as Error).message);
                                          }
                                        }}
                                      >
                                        {a.kind === "image"
                                          ? "提取文字"
                                          : "转写音频"}
                                      </Button>
                                    </>
                                  )}
                                </Space>
                              </div>
                            </div>
                          ))}
                        </Image.PreviewGroup>
                      </div>
                    </>
                  ),
                },
                {
                  key: "extraction",
                  label: "OCR / 转写",
                  children: detail.extractions.length ? (
                    detail.extractions.map((x) => (
                      <div className="extraction-card" key={x.id}>
                        <div className="row-between">
                          <Space>
                            <Tag>
                              {x.kind === "ocr" ? "图片 OCR" : "视频转写"}
                            </Tag>
                            {x.edited && <Tag color="blue">已人工修正</Tag>}
                          </Space>
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
                    <Empty description="尚无提取结果，可在媒体下方发起提取；待配置任务可在设置完成后重试。" />
                  ),
                },
                {
                  key: "tasks",
                  label: "处理记录",
                  children: detail.jobs.map((j) => (
                    <div className="job-card" key={j.id}>
                      <Space>
                        <Tag color={stateColor[j.state]}>
                          {stateLabel[j.state]}
                        </Tag>
                        <strong>{j.stage}</strong>
                      </Space>
                      {j.error && <p className="job-error">{j.error}</p>}
                      {["failed", "blocked"].includes(j.state) && (
                        <Button
                          size="small"
                          onClick={async () => {
                            try {
                              await post("/jobs/" + j.id + "/retry");
                              refresh();
                            } catch (e) {
                              message.error((e as Error).message);
                            }
                          }}
                        >
                          重试此步骤
                        </Button>
                      )}
                    </div>
                  )),
                },
              ]}
            />
          </>
        )}
      </Drawer>
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
            const d = await api<Detail>(
              "/collections/" +
                detailID +
                (revisionID ? "?revision_id=" + revisionID : ""),
            );
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
      <Modal
        title="重新采集笔记"
        open={recollect}
        onCancel={() => setRecollect(false)}
        onOk={async () => {
          try {
            await post("/collections/" + detailID + "/recollect", {
              url: freshLink,
            });
            setRecollect(false);
            message.success("已提交重新采集，旧来源版本继续保留");
            refresh();
          } catch (e) {
            message.error((e as Error).message);
          }
        }}
      >
        <p>链接失效时可粘贴同一笔记的新分享链接。</p>
        <Input.TextArea
          value={freshLink}
          onChange={(e) => setFreshLink(e.target.value)}
        />
      </Modal>
    </>
  );
}
