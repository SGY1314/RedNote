import { Alert, Button, Modal, Select, Space, Tag } from "antd";
import { useEffect, useState } from "react";
import type { Asset, Version } from "../api";
import { date } from "../api";
import { VersionCreative } from "../creative";
import { hookLabel } from "../rewriteHooks";
import VersionDiff from "../versionDiff";
import VersionMedia from "../VersionMedia";
import { versionLabel } from "./versionLabels";
type Props = {
  open: boolean;
  onClose: () => void;
  versions: Version[];
  currentID: string;
  assets: Asset[];
  mediaDisabled: boolean;
  onChoose: (version: Version, confirm?: boolean) => void;
};
export default function VersionComparison({
  open,
  onClose,
  versions,
  currentID,
  assets,
  mediaDisabled,
  onChoose,
}: Props) {
  const [compareID, setCompareID] = useState("");
  const [compareRightID, setCompareRightID] = useState("");
  useEffect(() => {
    if (!open) return;
    setCompareID(versions.find((v) => v.id !== currentID)?.id || "");
    setCompareRightID(currentID || versions[0]?.id || "");
  }, [open, currentID]);
  return (
    <Modal
      title="完整发布稿版本对比"
      open={open}
      onCancel={onClose}
      footer={null}
      width={1000}
    >
      <Alert
        type="info"
        message="每个版本包含文案、素材、封面及顺序，整体比较和选用。修改后点击「保存完整版本」，旧版本不变。"
        style={{ marginBottom: 16 }}
      />
      <div className="comparison-selectors">
        <Select
          aria-label="左侧对比版本"
          value={compareID}
          style={{ width: "100%" }}
          options={versions
            .filter((v) => v.id !== compareRightID)
            .map((v) => ({
              value: v.id,
              label: versionLabel(v),
            }))}
          onChange={setCompareID}
        />
        <Select
          aria-label="右侧对比版本"
          style={{ width: "100%" }}
          value={compareRightID}
          onChange={setCompareRightID}
          options={versions
            .filter((v) => v.id !== compareID)
            .map((v) => ({ value: v.id, label: versionLabel(v) }))}
        />
      </div>
      <VersionDiff
        left={versions.find((v) => v.id === compareID)}
        right={versions.find((v) => v.id === compareRightID)}
      />
      <div className="compare-grid">
        {[
          versions.find((v) => v.id === compareID),
          versions.find((v) => v.id === compareRightID),
        ].map((v, i) => (
          <div key={i}>
            <Tag>{v ? versionLabel(v) : "请选择版本"}</Tag>
            {v && (
              <>
                <p className="muted">
                  生成时钩子：{hookLabel(v.hook)}
                  {v.parent_id && v.hook ? "（沿用来源版本的生成记录）" : ""}
                </p>
                <VersionCreative version={v} />
              </>
            )}
            <p className="muted">
              {v ? date(v.created_at) : "—"} · {v?.body.length || 0} 字
            </p>
            <details>
              <summary>查看生成要求</summary>
              <p className="source-body">
                {v?.instructions || "手动编辑，无生成要求"}
              </p>
            </details>
            <h3>{v?.title}</h3>
            <p className="source-body">{v?.body}</p>
            <p>{v?.topics?.map((t) => "#" + t).join(" ")}</p>
            {v && <VersionMedia version={v} assets={assets} />}
            {v && (
              <Space wrap>
                <Button disabled={mediaDisabled} onClick={() => onChoose(v)}>
                  选用并编辑
                </Button>
                <Button
                  type="primary"
                  disabled={
                    mediaDisabled || v.generated || !v.media?.asset_ids.length
                  }
                  onClick={() => onChoose(v, true)}
                >
                  设为当前选用版本
                </Button>
              </Space>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
