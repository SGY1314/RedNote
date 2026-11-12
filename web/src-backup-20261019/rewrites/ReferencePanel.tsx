import { FileImageOutlined } from "@ant-design/icons";
import { Button, Checkbox, Image, Space } from "antd";
import type { Dispatch, SetStateAction } from "react";
import type { Asset, Project } from "../api";
import { fileURL } from "../api";
type Selection = Dispatch<SetStateAction<string[]>>;
type Props = {
  project?: Project;
  workspaceKind: "image" | "video";
  referenceAssets: Asset[];
  referenceVideos: Asset[];
  selectedReferenceIDs: string[];
  setSelectedReferenceIDs: Selection;
  videoReferenceIDs: string[];
  setVideoReferenceIDs: Selection;
  sourceIDs: string[];
  setSourceIDs: Selection;
  refreshing: boolean;
  onRefreshSources: () => Promise<void>;
};
export default function ReferencePanel({
  project,
  workspaceKind,
  referenceAssets,
  referenceVideos,
  selectedReferenceIDs,
  setSelectedReferenceIDs,
  videoReferenceIDs,
  setVideoReferenceIDs,
  sourceIDs,
  setSourceIDs,
  refreshing,
  onRefreshSources,
}: Props) {
  return (
    <details className="reference-panel">
      <summary>
        参考内容 · 原文、图片与视频 <span>展开选择本次参考素材</span>
      </summary>
      <div className="section-heading">
        <span className="section-index">01</span>
        <strong>参考内容</strong>
        <small>勾选本次使用的内容</small>
      </div>
      <div className="reference-scroll">
        <div className="source-card">
          <strong>
            {workspaceKind === "video"
              ? "参考图片 · AI 视频使用"
              : "参考图片 · AI 配图使用"}
          </strong>
          <p className="muted">
            {workspaceKind === "video"
              ? "勾选一张或多张图片，进入「AI 视频导演」时自动带入，结合当前文案规划连续视频。图片与视频合计最多 7 份，其中视频最多 2 份。"
              : "可勾选一张或多张参考图片，再点击「AI 生成图片」。无需提取文字；图号按勾选顺序排列，数量上限以所选模型为准。"}
          </p>
          {referenceAssets.length ? (
            <Space wrap align="start">
              {referenceAssets.map((a, index) => (
                <div key={a.id} style={{ width: 126 }}>
                  {a.status === "ready" ? (
                    <Image
                      src={fileURL(a.id)}
                      width={120}
                      height={100}
                      style={{ objectFit: "cover" }}
                    />
                  ) : (
                    <div className="muted">
                      请在采集库选择下载到素材库后再使用
                    </div>
                  )}
                  <Checkbox
                    checked={selectedReferenceIDs.includes(a.id)}
                    disabled={a.status !== "ready"}
                    onChange={(e) =>
                      setSelectedReferenceIDs((ids) =>
                        e.target.checked
                          ? [...ids, a.id]
                          : ids.filter((id) => id !== a.id),
                      )
                    }
                  >
                    {selectedReferenceIDs.includes(a.id)
                      ? `参考图 ${selectedReferenceIDs.filter((id) => referenceAssets.some((r) => r.id === id)).indexOf(a.id) + 1}`
                      : `来源图片 ${index + 1}`}
                  </Checkbox>
                </div>
              ))}
            </Space>
          ) : (
            <small className="muted">当前项目没有来源图片。</small>
          )}
          {!!selectedReferenceIDs.some((id) =>
            referenceAssets.some((a) => a.id === id),
          ) && (
            <p>
              已选{" "}
              {
                selectedReferenceIDs.filter((id) =>
                  referenceAssets.some((a) => a.id === id),
                ).length
              }{" "}
              张{" "}
              <Button
                size="small"
                type="link"
                onClick={() =>
                  setSelectedReferenceIDs((ids) =>
                    ids.filter(
                      (id) => !referenceAssets.some((a) => a.id === id),
                    ),
                  )
                }
              >
                清空选择
              </Button>
            </p>
          )}
        </div>
        {workspaceKind === "video" && (
          <div className="source-card">
            <strong>参考视频</strong>
            {referenceVideos.length ? (
              referenceVideos.map((a) => (
                <div key={a.id}>
                  <video
                    controls
                    preload="metadata"
                    src={fileURL(a.id)}
                    style={{ width: "100%" }}
                  />
                  <Checkbox
                    aria-label={`参考视频 ${a.name}`}
                    checked={videoReferenceIDs.includes(a.id)}
                    disabled={a.status !== "ready"}
                    onChange={(e) =>
                      setVideoReferenceIDs((ids) =>
                        e.target.checked
                          ? [...ids, a.id]
                          : ids.filter((id) => id !== a.id),
                      )
                    }
                  >
                    {a.name} · 用于视频规划
                  </Checkbox>
                </div>
              ))
            ) : (
              <p className="muted">
                当前项目没有来源视频，可参考下方原文或视频转写。
              </p>
            )}
          </div>
        )}
        {project?.revision_id && (
          <Button disabled={refreshing} onClick={onRefreshSources}>
            更新参考文字（OCR / 转写）
          </Button>
        )}
        {project?.sources.length ? (
          project.sources.map((s) => (
            <div
              className={
                "source-card " +
                (sourceIDs.includes(s.id) ? "source-selected" : "")
              }
              key={s.id}
            >
              <Checkbox
                checked={sourceIDs.includes(s.id)}
                onChange={(e) =>
                  setSourceIDs(
                    e.target.checked
                      ? [...sourceIDs, s.id]
                      : sourceIDs.filter((id) => id !== s.id),
                  )
                }
              >
                <strong>{s.label}</strong>
              </Checkbox>
              <p>{s.text}</p>
            </div>
          ))
        ) : (
          <div className="source-empty">
            <FileImageOutlined />
            <h3>自由创作，没有边界</h3>
            <p>填写创作要求生成文案，也可以直接编辑标题和正文。</p>
          </div>
        )}
      </div>
      <div className="reference-footer">
        {project?.revision_id
          ? "来源已保存为快照，可追溯本次参考内容。"
          : "这是一个独立创作项目。"}
      </div>
    </details>
  );
}
