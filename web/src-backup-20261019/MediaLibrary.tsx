import {
  DeleteOutlined,
  DownOutlined,
  DownloadOutlined,
  EllipsisOutlined,
  PlusOutlined,
  EditOutlined,
  FileImageOutlined,
  FilterOutlined,
  FolderOpenOutlined,
  PlayCircleOutlined,
  UndoOutlined,
  UploadOutlined,
  UpOutlined,
} from "@ant-design/icons";
import {
  App,
  AutoComplete,
  Button,
  Checkbox,
  Dropdown,
  Empty,
  Input,
  Modal,
  Pagination,
  Segmented,
  Select,
  Space,
  Upload,
} from "antd";
import { useEffect, useId, useRef, useState } from "react";
import type { Asset } from "./api";
import { api, APIError, date, fileURL, patch, post } from "./api";
import { inMediaLibrary } from "./assetLibrary";
import WorkspaceSurface from "./WorkspaceSurface";

export default function MediaLibrary({
  embedded = false,
  open,
  onClose,
  assets: allAssets,
  refresh,
  onAdd,
}: {
  embedded?: boolean;
  open: boolean;
  onClose: () => void;
  assets: Asset[];
  refresh: () => Promise<void>;
  onAdd?: (asset: Asset) => Promise<void>;
}) {
  const { message, modal } = App.useApp();
  const assets = allAssets.filter(inMediaLibrary);
  const [trash, setTrash] = useState(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [source, setSource] = useState("all");
  const [category, setCategory] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersID = useId();
  const filterCount =
    Number(kind !== "all") + Number(source !== "all") + Number(!!category);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [previewID, setPreviewID] = useState("");
  const [editing, setEditing] = useState<Asset>();
  const [name, setName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchCategory, setBatchCategory] = useState("");
  const [uploadCategory, setUploadCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingUploads, setPendingUploads] = useState(0);
  const uploads = useRef(Promise.resolve());
  const categories = [
    ...new Set(assets.map((a) => a.category).filter((x): x is string => !!x)),
  ].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const categoryOptions = categories.map((value) => ({ value }));
  const filtered = assets.filter(
    (a) =>
      !!a.deleted_at === trash &&
      (kind === "all" || a.kind === kind) &&
      (source === "all" || a.source === source) &&
      (!category ||
        (category === "uncategorized"
          ? !a.category
          : a.category === category.slice(9))) &&
      (!query ||
        [a.name, a.original_name, a.category].some((x) =>
          x?.toLowerCase().includes(query.toLowerCase()),
        )),
  );
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / 24)),
  );
  const visible = filtered.slice((currentPage - 1) * 24, currentPage * 24);
  const preview = assets.find((a) => a.id === previewID);
  const selectedIDs = selected.filter((id) =>
    assets.some((a) => a.id === id && !!a.deleted_at === trash),
  );
  useEffect(() => setPage(1), [query, kind, source, category, trash]);
  const changeTrash = async (ids: string[], deleted: boolean) => {
    await post("/assets/batch-trash", { ids, deleted });
    await refresh();
    setSelected([]);
    setPreviewID("");
    message.success(deleted ? "已移入素材回收站" : "素材已恢复");
  };
  const remove = (ids: string[], permanent = false) => {
    const names = assets.filter((a) => ids.includes(a.id)).map((a) => a.name);
    modal.confirm({
      title: permanent
        ? `彻底删除 ${ids.length} 份素材？`
        : `删除 ${ids.length} 份素材？`,
      content: (
        <>
          <p>
            {names.slice(0, 3).join("、")}
            {names.length > 3 ? "等" : ""}
          </p>
          <p>
            {permanent
              ? "此操作不可恢复。仅清理工作台内的文件副本，不影响电脑上的原文件。被采集记录、文稿或正在执行的任务引用时会阻止整批删除。"
              : "素材将移入回收站，可以恢复；已有采集记录、文稿及发布稿的引用继续保留。"}
          </p>
        </>
      ),
      okText: permanent ? "彻底删除" : "移入回收站",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          if (permanent) {
            const result = await post<{ cleanup_job_id?: string }>(
              "/assets/batch-purge",
              { ids, confirm: true },
            );
            setPreviewID("");
            await refresh();
            setSelected([]);
            message.success(
              result.cleanup_job_id
                ? "素材已删除，文件正在后台清理；可在后台任务查看结果"
                : "素材已彻底删除",
            );
          } else await changeTrash(ids, true);
        } catch (e) {
          if (permanent && e instanceof APIError && e.blocked?.length) {
            const blocked = e.blocked;
            const blockedIDs = new Set(blocked.map((item) => item.id));
            const removable = ids.filter((id) => !blockedIDs.has(id));
            modal.warning({
              title: `${blocked.length} 份素材仍被使用，本次没有删除任何素材`,
              width: 660,
              content: (
                <>
                  <p>
                    删除仿写项目后，发布稿和采集记录仍可能保留素材。请根据下面的占用来源处理。
                  </p>
                  <div style={{ maxHeight: 320, overflowY: "auto" }}>
                    {blocked.map((item) => (
                      <div key={item.id} style={{ marginBottom: 12 }}>
                        <strong>{item.name}</strong>
                        <div>{item.reason}</div>
                      </div>
                    ))}
                  </div>
                  {removable.length > 0 && (
                    <p>
                      其余 {removable.length}{" "}
                      份目前未占用，可以先选中，再点击「批量彻底删除」。
                    </p>
                  )}
                </>
              ),
              okText: removable.length
                ? `选择 ${removable.length} 份未占用素材`
                : "知道了",
              onOk: () => {
                if (removable.length) setSelected(removable);
              },
            });
            return;
          }
          message.error((e as Error).message);
          throw e;
        }
      },
    });
  };
  const restore = async (ids: string[]) => {
    try {
      await changeTrash(ids, false);
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  const openEdit = (asset: Asset) => {
    setEditing(asset);
    setName(asset.name);
    setEditCategory(asset.category || "");
  };
  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await patch("/assets/" + editing.id, {
        name: name.trim(),
        category: editCategory.trim(),
      });
      await refresh();
      setEditing(undefined);
      message.success("素材信息已保存");
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const saveBatch = async () => {
    setSaving(true);
    try {
      await patch("/assets/category", {
        ids: selectedIDs,
        category: batchCategory.trim(),
      });
      await refresh();
      setBatchOpen(false);
      setSelected([]);
      message.success("分类已更新");
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <WorkspaceSurface
        embedded={embedded}
        title={
          embedded ? null : (
            <Space>
              <FolderOpenOutlined />
              本地素材
            </Space>
          )
        }
        width={1180}
        open={open}
        onClose={() => {
          setPreviewID("");
          setEditing(undefined);
          setBatchOpen(false);
          onClose();
        }}
      >
        <div className="media-library-heading">
          <h2>{trash ? "素材回收站" : "素材库"}</h2>
          <span className="muted">
            {assets.filter((a) => !!a.deleted_at === trash).length} 个素材
          </span>
        </div>
        {!trash && (
          <details className="media-upload-box">
            <summary>
              <UploadOutlined /> 上传图片或视频
            </summary>
            <div className="row-between">
              <strong>上传自己的素材</strong>
              <Space>
                <span className="muted">上传后归类到</span>
                <AutoComplete
                  aria-label="上传素材分类"
                  value={uploadCategory}
                  onChange={setUploadCategory}
                  options={categoryOptions}
                  maxLength={40}
                  placeholder="输入或选择分类，可留空"
                  style={{ width: 230 }}
                  allowClear
                />
              </Space>
            </div>
            <Upload.Dragger
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
              showUploadList={{ showRemoveIcon: false }}
              beforeUpload={(file) => {
                if (file.size > 512 * 1024 * 1024) {
                  message.error(`${file.name} 超过 512 MB`);
                  return Upload.LIST_IGNORE;
                }
                return true;
              }}
              customRequest={({ file, onSuccess, onError }) => {
                const assignedCategory = uploadCategory.trim();
                setPendingUploads((n) => n + 1);
                uploads.current = uploads.current.then(async () => {
                  try {
                    const data = new FormData();
                    data.append("file", file as File);
                    data.append("category", assignedCategory);
                    const asset = await api<Asset>("/assets", {
                      method: "POST",
                      body: data,
                    });
                    onSuccess?.(asset);
                    await refresh();
                  } catch (e) {
                    onError?.(e as Error);
                    message.error(`上传失败：${(e as Error).message}`);
                  } finally {
                    setPendingUploads((n) => n - 1);
                  }
                });
              }}
            >
              <p className="ant-upload-drag-icon">
                <UploadOutlined />
              </p>
              <strong>点击选择文件，或将图片、视频拖到这里</strong>
              <p className="muted">支持多文件上传，单个文件最多 512 MB</p>
            </Upload.Dragger>
            {pendingUploads > 0 && (
              <small className="blue-text">
                正在上传或排队：{pendingUploads} 份，请保持工作台页面打开。
              </small>
            )}
          </details>
        )}
        <div className="media-library-toolbar">
          <div className="media-library-toolbar-row">
            <Segmented
              aria-label="素材库范围"
              value={trash ? "trash" : "active"}
              onChange={(value) => {
                setTrash(value === "trash");
                setSelected([]);
              }}
              options={[
                { value: "active", label: "素材库" },
                {
                  value: "trash",
                  label: `回收站（${assets.filter((a) => a.deleted_at).length}）`,
                },
              ]}
            />
            <Input.Search
              aria-label="搜索素材"
              placeholder="搜索名称、原文件名或分类"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              allowClear
            />
            <Button
              className="media-filter-toggle"
              icon={<FilterOutlined />}
              aria-expanded={filtersOpen}
              aria-controls={filtersID}
              aria-label={`${filtersOpen ? "收起" : "展开"}素材筛选${filterCount ? `（${filterCount} 项已启用）` : ""}`}
              onClick={() => setFiltersOpen((value) => !value)}
            >
              筛选
              {filterCount > 0 && (
                <span className="media-filter-count">{filterCount}</span>
              )}
              {filtersOpen ? <UpOutlined /> : <DownOutlined />}
            </Button>
          </div>
          {filtersOpen && (
            <div
              className="media-library-filters"
              id={filtersID}
              role="region"
              aria-label="素材筛选"
            >
              <div className="media-library-filter">
                <span>类型</span>
                <Segmented
                  block
                  aria-label="素材类型筛选"
                  value={kind}
                  onChange={(v) => setKind(String(v))}
                  options={[
                    { value: "all", label: "全部" },
                    { value: "image", label: "图片" },
                    { value: "video", label: "视频" },
                  ]}
                />
              </div>
              <div className="media-library-filter">
                <span>分类</span>
                <Select
                  aria-label="素材分类筛选"
                  value={category}
                  onChange={setCategory}
                  options={[
                    { value: "", label: "全部分类" },
                    { value: "uncategorized", label: "未分类" },
                    ...categories.map((c) => ({
                      value: "category:" + c,
                      label: c,
                    })),
                  ]}
                />
              </div>
              <div className="media-library-filter">
                <span>来源</span>
                <Select
                  aria-label="素材来源筛选"
                  value={source}
                  onChange={setSource}
                  options={[
                    { value: "all", label: "全部来源" },
                    { value: "upload", label: "我的上传" },
                    { value: "generated", label: "AI 生成" },
                    { value: "collection", label: "采集素材" },
                  ]}
                />
              </div>
              <Button
                className="media-filter-reset"
                type="text"
                disabled={!filterCount}
                onClick={() => {
                  setKind("all");
                  setSource("all");
                  setCategory("");
                }}
              >
                重置筛选
              </Button>
            </div>
          )}
        </div>
        <div className="media-selection-bar">
          <Space>
            <Checkbox
              checked={
                visible.length > 0 &&
                visible.every((a) => selectedIDs.includes(a.id))
              }
              indeterminate={
                visible.some((a) => selectedIDs.includes(a.id)) &&
                !visible.every((a) => selectedIDs.includes(a.id))
              }
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [
                        ...new Set([
                          ...selectedIDs,
                          ...visible.map((a) => a.id),
                        ]),
                      ]
                    : selectedIDs.filter(
                        (id) => !visible.some((a) => a.id === id),
                      ),
                )
              }
            >
              选择本页
            </Checkbox>
            <span className="muted">
              筛选结果 {filtered.length} 份 · 已选 {selectedIDs.length} 份
            </span>
          </Space>
          {selectedIDs.length > 0 && (
            <Space>
              {trash ? (
                <>
                  <Button
                    disabled={!selectedIDs.length || selectedIDs.length > 500}
                    icon={<UndoOutlined />}
                    onClick={() => restore(selectedIDs)}
                  >
                    批量恢复
                  </Button>
                  <Button
                    danger={!embedded}
                    className={embedded ? "rewrite-delete-button" : undefined}
                    disabled={!selectedIDs.length || selectedIDs.length > 500}
                    onClick={() => remove(selectedIDs, true)}
                  >
                    批量彻底删除
                  </Button>
                </>
              ) : (
                <Button
                  danger={!embedded}
                  className={embedded ? "rewrite-delete-button" : undefined}
                  icon={<DeleteOutlined />}
                  disabled={!selectedIDs.length || selectedIDs.length > 500}
                  onClick={() => remove(selectedIDs)}
                >
                  批量删除
                </Button>
              )}
              <Button
                disabled={
                  trash || !selectedIDs.length || selectedIDs.length > 500
                }
                onClick={() => {
                  setBatchCategory("");
                  setBatchOpen(true);
                }}
              >
                批量分类
              </Button>
              <Button
                type="text"
                disabled={!selectedIDs.length}
                onClick={() => setSelected([])}
              >
                取消选择
              </Button>
            </Space>
          )}
        </div>
        {filtered.length ? (
          <div className="local-media-grid">
            {visible.map((asset) => (
              <article className="local-media-card" key={asset.id}>
                <button
                  className="media-preview-button"
                  aria-label={`预览 ${asset.name}`}
                  disabled={asset.status !== "ready"}
                  onClick={() => setPreviewID(asset.id)}
                >
                  {asset.status !== "ready" ? (
                    <FileImageOutlined />
                  ) : asset.kind === "image" ? (
                    <img
                      loading="lazy"
                      alt={asset.name}
                      src={fileURL(asset.id)}
                    />
                  ) : (
                    <>
                      <video
                        src={fileURL(asset.id)}
                        muted
                        preload="metadata"
                        style={{
                          aspectRatio:
                            asset.width && asset.height
                              ? `${asset.width}/${asset.height}`
                              : undefined,
                        }}
                      />
                      <PlayCircleOutlined className="video-preview-play" />
                    </>
                  )}
                </button>
                <Dropdown
                  trigger={["click"]}
                  placement="bottomRight"
                  menu={{
                    items: trash
                      ? [
                          {
                            key: "restore",
                            label: "恢复素材",
                            icon: <UndoOutlined />,
                            onClick: () => void restore([asset.id]),
                          },
                          {
                            key: "purge",
                            label: "彻底删除",
                            danger: !embedded,
                            className: embedded
                              ? "rewrite-delete-menu-item"
                              : undefined,
                            icon: <DeleteOutlined />,
                            onClick: () => remove([asset.id], true),
                          },
                        ]
                      : [
                          ...(onAdd
                            ? [
                                {
                                  key: "add",
                                  label: "加入发布素材",
                                  icon: <PlusOutlined />,
                                  disabled: asset.status !== "ready",
                                  onClick: () =>
                                    void onAdd(asset).catch((e) =>
                                      message.error((e as Error).message),
                                    ),
                                },
                              ]
                            : []),
                          {
                            key: "download",
                            icon: <DownloadOutlined />,
                            disabled: asset.status !== "ready",
                            label: (
                              <a
                                href={fileURL(asset.id) + "?download=1"}
                                download={asset.name}
                              >
                                下载
                              </a>
                            ),
                          },
                          {
                            key: "edit",
                            label: "重命名与分类",
                            icon: <EditOutlined />,
                            onClick: () => openEdit(asset),
                          },
                          { type: "divider" },
                          {
                            key: "delete",
                            label: "删除",
                            danger: !embedded,
                            className: embedded
                              ? "rewrite-delete-menu-item"
                              : undefined,
                            icon: <DeleteOutlined />,
                            onClick: () => remove([asset.id]),
                          },
                        ],
                  }}
                >
                  <Button
                    className="media-float-button"
                    shape="circle"
                    icon={<EllipsisOutlined />}
                    aria-label={`素材操作 ${asset.name}`}
                  />
                </Dropdown>
                <Checkbox
                  className="media-round-select"
                  aria-label={`选择 ${asset.name}`}
                  checked={selectedIDs.includes(asset.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selectedIDs, asset.id]
                        : selectedIDs.filter((id) => id !== asset.id),
                    )
                  }
                />
              </article>
            ))}
          </div>
        ) : (
          <Empty
            description={
              trash
                ? "回收站中没有符合条件的素材"
                : "没有符合条件的素材，可上传自己的图片或视频"
            }
          />
        )}
        <div className="media-library-pagination">
          <Pagination
            current={currentPage}
            pageSize={24}
            total={filtered.length}
            onChange={setPage}
            showSizeChanger={false}
          />
        </div>
      </WorkspaceSurface>
      <Modal
        title={preview?.name || "素材预览"}
        open={!!preview}
        onCancel={() => setPreviewID("")}
        width={960}
        footer={
          preview ? (
            <Space>
              <Button icon={<EditOutlined />} onClick={() => openEdit(preview)}>
                重命名 / 分类
              </Button>
              <Button href={fileURL(preview.id) + "?download=1"}>
                下载素材
              </Button>
            </Space>
          ) : null
        }
        destroyOnHidden
      >
        {preview && (
          <>
            <div className="media-preview-large">
              {preview.kind === "image" ? (
                <img alt={preview.name} src={fileURL(preview.id)} />
              ) : (
                <video
                  key={preview.id}
                  src={fileURL(preview.id)}
                  controls
                  preload="metadata"
                />
              )}
            </div>
            <p className="muted">
              {preview.width} × {preview.height} ·{" "}
              {(preview.size / 1024 / 1024).toFixed(1)} MB ·{" "}
              {preview.category || "未分类"} · {date(preview.created_at)}
            </p>
            {preview.original_name &&
              preview.original_name !== preview.name && (
                <p className="muted">原文件名：{preview.original_name}</p>
              )}
          </>
        )}
      </Modal>
      <Modal
        title="重命名与分类"
        open={!!editing}
        onCancel={() => setEditing(undefined)}
        onOk={saveEdit}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        okButtonProps={{ disabled: !name.trim() }}
      >
        <div className="settings-form">
          <label>
            素材名称
            <Input
              aria-label="素材名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={180}
            />
          </label>
          <label>
            分类
            <AutoComplete
              aria-label="素材分类"
              value={editCategory}
              onChange={setEditCategory}
              options={categoryOptions}
              maxLength={40}
              placeholder="输入新分类或选择已有分类"
              allowClear
            />
          </label>
          <p className="muted">
            名称和分类会同步到素材选择器，已有文稿与发布稿中的素材引用保持有效。
          </p>
        </div>
      </Modal>
      <Modal
        title={`为 ${selectedIDs.length} 份素材设置分类`}
        open={batchOpen}
        onCancel={() => setBatchOpen(false)}
        onOk={saveBatch}
        confirmLoading={saving}
        okText="保存分类"
        cancelText="取消"
      >
        <AutoComplete
          aria-label="批量素材分类"
          value={batchCategory}
          onChange={setBatchCategory}
          options={categoryOptions}
          maxLength={40}
          placeholder="输入或选择分类，留空设为未分类"
          style={{ width: "100%" }}
          allowClear
        />
      </Modal>
    </>
  );
}
