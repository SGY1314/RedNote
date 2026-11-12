import { useEffect, useState } from "react";
import { Alert, Modal, Segmented, Spin } from "antd";
import type { Asset, Publication } from "../api";
import { api, post } from "../api";
import PublicationDraftEditor from "./PublicationDraftEditor";
import { splitNoteText } from "../noteText";
import "./publication-confirmation.css";

export default function PublicationConfirmation({
  publications,
  assets,
  onClose,
  onConfirmed,
  prepared = false,
}: {
  prepared?: boolean;
  publications: Publication[];
  assets: Asset[];
  onClose: () => void;
  onConfirmed: () => void | Promise<void>;
}) {
  const [items, setItems] = useState(publications);
  const [selected, setSelected] = useState(publications[0]?.id);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reviewNotice, setReviewNotice] = useState(false);
  const reload = async () => {
    if (prepared) {
      const result = await post<{ items: Publication[] }>(
        "/publications/preview",
        {
          items: items.map((p) => ({
            id: p.id,
            prepared_version_id: p.version_id,
            target_platform: p.target_platform,
          })),
        },
      );
      setItems(
        result.items.map((p) => {
          const edited = items.find(
            (old) =>
              old.project_id === p.project_id &&
              old.target_platform === p.target_platform,
          );
          return edited
            ? {
                ...p,
                title: edited.title,
                body: edited.body,
                topics: edited.topics,
                asset_ids: edited.asset_ids.filter((id) =>
                  p.asset_ids.includes(id),
                ),
                cover_id:
                  edited.cover_id && p.asset_ids.includes(edited.cover_id)
                    ? edited.cover_id
                    : p.cover_id,
              }
            : { ...p, ...splitNoteText(p.body, p.topics) };
        }),
      );
      setReviewNotice(true);
      return;
    }
    const latest = await api<Publication[]>("/publications");
    const current = publications.map((p) =>
      latest.find((item) => item.id === p.id),
    );
    if (current.some((p) => !p)) throw new Error("发布稿已移除，请重新打开");
    setItems(
      (current as Publication[]).map((p) => ({
        ...p,
        ...splitNoteText(p.body, p.topics),
      })),
    );
  };
  useEffect(() => {
    let live = true;
    (prepared ? Promise.resolve() : reload())
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);
  const current = items.find((p) => p.id === selected) || items[0];
  return (
    <Modal
      open
      title="确认发布稿"
      width={960}
      className="publication-confirmation"
      onCancel={() => {
        if (!saving) onClose();
      }}
      maskClosable={!saving}
      closable={!saving}
      cancelText="暂不确认"
      okText="确认，加入发布管理"
      confirmLoading={saving}
      okButtonProps={{
        disabled:
          loading ||
          !!error ||
          items.some(
            (p) =>
              !p.asset_ids.length ||
              !p.body.trim() ||
              (p.target_platform !== "douyin" && !p.title.trim()),
          ),
      }}
      onOk={async () => {
        setSaving(true);
        setError("");
        try {
          await post("/publications/confirm", {
            items: items.map((p) => ({
              id: p.id,
              revision: p.revision || 0,
              ...(prepared
                ? {
                    prepared_version_id: p.version_id,
                    target_platform: p.target_platform,
                  }
                : {}),
              edit: {
                title: p.title,
                body: p.body,
                topics: p.topics,
                asset_ids: p.asset_ids,
                cover_id: p.cover_id || "",
              },
            })),
          });
          await onConfirmed();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setSaving(false);
        }
      }}
    >
      {reviewNotice && (
        <Alert
          type="info"
          showIcon
          message="已重新读取发布状态，弹窗中的文字修改已保留，请再次核对后确认。"
        />
      )}
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            <button
              className="publication-confirm-retry"
              onClick={() => {
                setError("");
                setLoading(true);
                void reload()
                  .catch((e) => setError(e.message))
                  .finally(() => setLoading(false));
              }}
            >
              重新核对
            </button>
          }
        />
      )}
      {items.length > 1 && (
        <Segmented
          value={selected}
          onChange={(value) => setSelected(value as string)}
          options={items.map((p) => ({
            value: p.id,
            label: p.target_platform === "douyin" ? "抖音" : "小红书",
          }))}
        />
      )}
      {loading ? (
        <Spin />
      ) : (
        current && (
          <PublicationDraftEditor
            key={current.id}
            publication={current}
            assets={assets}
            disabled={saving}
            onChange={(patch) => {
              setError("");
              setItems((old) =>
                old.map((p) => (p.id === current.id ? { ...p, ...patch } : p)),
              );
            }}
          />
        )
      )}
    </Modal>
  );
}
