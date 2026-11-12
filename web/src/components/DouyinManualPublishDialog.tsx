import { useState } from "react";
import { Alert, App, Button, Checkbox, Image, Input, Modal, Space } from "antd";
import {
  CopyOutlined,
  DownloadOutlined,
  ExportOutlined,
} from "@ant-design/icons";
import { fileURL, type Asset, type Publication } from "../api";

type Directory = {
  getFileHandle: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
};
export default function DouyinManualPublishDialog({
  publication: p,
  assets,
  onClose,
}: {
  publication: Publication;
  assets: Asset[];
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [selectedIDs, setSelectedIDs] = useState(() => [...p.asset_ids]);
  const [feedback, setFeedback] = useState("");
  const [feedbackType, setFeedbackType] = useState<
    "info" | "success" | "warning" | "error"
  >("info");
  const body = [
    p.body,
    p.topics.map((t) => "#" + t.replace(/^#+/, "")).join(" "),
  ]
    .filter(Boolean)
    .join("\n\n");
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success("已复制");
    } catch {
      message.error("复制失败，请在下方文本框中手动复制");
    }
  };
  const allMedia = p.asset_ids.map((id, i) => {
    const asset = assets.find((a) => a.id === id);
    const extensions: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "video/mp4": "mp4",
      "video/webm": "webm",
      "video/quicktime": "mov",
    };
    const original = asset?.original_name || asset?.name || "";
    const ext =
      extensions[asset?.mime || ""] ||
      original.match(/\.([a-zA-Z0-9]{1,8})$/)?.[1] ||
      ((asset?.kind || p.kind) === "video" ? "mp4" : "jpg");
    return {
      id,
      kind: asset?.kind || p.kind,
      label: asset?.name || `素材 ${i + 1}`,
      name: `${String(i + 1).padStart(2, "0")}-${(
        asset?.name || (p.kind === "video" ? "视频" : "图片")
      )
        .replace(/\.[a-zA-Z0-9]{1,8}$/, "")
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
        .trim()
        .slice(0, 100)}.${ext}`,
    };
  });
  const media = allMedia.filter((item) => selectedIDs.includes(item.id));
  const picker = (
    window as typeof window & {
      showDirectoryPicker?: (options: { mode: string }) => Promise<Directory>;
    }
  ).showDirectoryPicker;
  const save = async () => {
    if (!picker || saving || !media.length) return;
    let saved = 0;
    let folderSelected = false;
    setSaving(true);
    setFeedbackType("info");
    setFeedback("正在打开文件夹选择窗口…");
    try {
      const directory = await picker.call(window, { mode: "readwrite" });
      folderSelected = true;
      for (const item of media) {
        setFeedback(`正在保存 ${saved + 1} / ${media.length}：${item.name}`);
        const response = await fetch(fileURL(item.id), {
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error(`素材下载失败（${response.status}）`);
        const blob = await response.blob();
        if (!blob.size) throw new Error("素材文件为空");
        let name = item.name;
        // Check before creating to avoid overwriting files already in the selected folder.
        for (let suffix = 1; ; suffix++) {
          try {
            await directory.getFileHandle(name);
            name = item.name.replace(/(\.[^.]+)$/, `-${suffix}$1`);
          } catch (e) {
            if ((e as DOMException).name === "NotFoundError") break;
            throw e;
          }
        }
        const handle = await directory.getFileHandle(name, { create: true });
        const stream = await handle.createWritable();
        await stream.write(blob);
        await stream.close();
        saved++;
      }
      setFeedbackType("success");
      setFeedback(`已保存 ${saved} 个素材到所选文件夹`);
    } catch (e) {
      setFeedbackType(
        (e as DOMException).name === "AbortError" ? "warning" : "error",
      );
      setFeedback(
        (e as DOMException).name === "AbortError"
          ? folderSelected
            ? `保存已中断，已保存 ${saved} / ${media.length} 个素材。请单独下载剩余素材。`
            : "未选择文件夹，尚未保存素材。若没有出现文件夹窗口，请使用“浏览器下载素材”，或在 Chrome / Edge 中打开本站后重试。"
          : `已保存 ${saved} / ${media.length} 个素材：${(e as Error).message}。可单独下载剩余素材。`,
      );
    } finally {
      setSaving(false);
    }
  };
  const download = async () => {
    if (saving || !media.length) return;
    setSaving(true);
    setFeedbackType("info");
    let submitted = 0;
    try {
      for (const item of media) {
        setFeedback(
          `正在准备下载 ${submitted + 1} / ${media.length}：${item.name}`,
        );
        const response = await fetch(fileURL(item.id), {
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error(`素材下载失败（${response.status}）`);
        const blob = await response.blob();
        if (!blob.size) throw new Error("素材文件为空");
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = item.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
        submitted++;
      }
      setFeedback(
        `已向浏览器发起 ${submitted} 个素材下载，请查看下载列表。保存位置由浏览器设置决定；如提示允许下载多个文件，请允许，或使用下方链接逐个下载。`,
      );
    } catch (e) {
      setFeedbackType("error");
      setFeedback(
        `已发起 ${submitted} / ${media.length} 个下载：${(e as Error).message}。可使用下方链接单独重试剩余素材。`,
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      width={720}
      title="抖音手动发布"
      styles={{
        body: {
          maxHeight: "calc(100vh - 260px)",
          overflowY: "auto",
          paddingRight: 4,
        },
      }}
      footer={
        <Button aria-label="关闭" onClick={onClose} disabled={saving}>
          关闭
        </Button>
      }
      closable={!saving}
      maskClosable={!saving}
      onCancel={onClose}
    >
      <p>复制标题和正文，保存素材后，打开抖音发布页面自行上传。</p>
      <Space wrap>
        <Button
          aria-label="复制标题"
          icon={<CopyOutlined />}
          onClick={() => void copy(p.title)}
        >
          复制标题
        </Button>
        <Button
          aria-label="复制正文（含话题）"
          icon={<CopyOutlined />}
          onClick={() => void copy(body)}
        >
          复制正文（含话题）
        </Button>
      </Space>
      <Input
        aria-label="发布标题"
        value={p.title}
        readOnly
        style={{ marginTop: 12 }}
      />
      <Input.TextArea
        aria-label="发布正文和话题"
        value={body}
        readOnly
        rows={6}
        style={{ marginTop: 12, marginBottom: 16 }}
      />
      <Space wrap>
        <Button
          aria-label="选择文件夹并保存素材"
          icon={<DownloadOutlined />}
          loading={saving}
          disabled={!picker || !media.length}
          onClick={() => void save()}
        >
          选择文件夹并保存素材
        </Button>
        <Button
          aria-label="浏览器下载素材"
          icon={<DownloadOutlined />}
          disabled={saving || !media.length}
          onClick={() => void download()}
        >
          浏览器下载素材
        </Button>
        <Button
          aria-label="打开抖音发布页面"
          icon={<ExportOutlined />}
          href="https://creator.douyin.com/creator-micro/content/upload"
          target="_blank"
          rel="noopener noreferrer"
        >
          打开抖音发布页面
        </Button>
      </Space>
      {!picker && (
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          message="当前浏览器不支持选择文件夹，请逐个下载素材；保存位置由浏览器下载设置决定。"
        />
      )}
      <div
        style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}
      >
        {allMedia.map((item) => (
          <article
            key={item.id}
            style={{
              width: 190,
              padding: 8,
              border: "1px solid var(--border-color, #dce4e9)",
              borderRadius: 10,
            }}
          >
            {item.kind === "video" ? (
              <video
                aria-label={item.label}
                src={fileURL(item.id)}
                controls
                preload="metadata"
                style={{
                  width: "100%",
                  height: 135,
                  objectFit: "contain",
                  background: "#101010",
                }}
              />
            ) : (
              <Image
                src={fileURL(item.id)}
                alt={item.label}
                width="100%"
                height={135}
                style={{ objectFit: "contain" }}
              />
            )}
            <Checkbox
              aria-label={`保存${item.label}`}
              disabled={saving}
              checked={selectedIDs.includes(item.id)}
              onChange={(e) => {
                setSelectedIDs((ids) =>
                  e.target.checked
                    ? [...ids, item.id]
                    : ids.filter((id) => id !== item.id),
                );
                setFeedback("");
              }}
            >
              保存此素材
            </Checkbox>
            {selectedIDs.includes(item.id) && (
              <a
                style={{ display: "block", marginTop: 6 }}
                download={item.name}
                href={fileURL(item.id) + "?download=1"}
              >
                下载 {item.name}
              </a>
            )}
          </article>
        ))}
      </div>
      <p className="muted">
        已选 {media.length} / {allMedia.length} 个素材，仅保存勾选的素材。
      </p>
      {feedback && (
        <Alert
          style={{ marginTop: 12 }}
          message={feedback}
          type={feedbackType}
        />
      )}
      <p className="muted">
        复制、下载和打开平台后仍为等待发布。完成上传发布后，请手动选择“已发布”。
      </p>
    </Modal>
  );
}
