import { App, Button } from "antd";
import { useRef, useState } from "react";
import type { Asset } from "./api";
import { post } from "./api";
import { inMediaLibrary } from "./assetLibrary";

export default function SaveToLibrary({
  asset,
  refresh,
  disabled = false,
}: {
  asset?: Asset;
  refresh: () => Promise<void>;
  disabled?: boolean;
}) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [savedID, setSavedID] = useState("");
  const sending = useRef(false);
  const saved = !!asset && (inMediaLibrary(asset) || savedID === asset.id);
  return (
    <Button
      loading={busy}
      disabled={
        disabled ||
        !asset ||
        !!asset.deleted_at ||
        asset.status !== "ready" ||
        saved
      }
      onClick={async () => {
        if (!asset || sending.current) return;
        sending.current = true;
        setBusy(true);
        try {
          await post(`/assets/${asset.id}/save-to-library`);
          setSavedID(asset.id);
          message.success("已保存到素材库，复用现有文件");
          await refresh();
        } catch (e) {
          message.error((e as Error).message);
        } finally {
          sending.current = false;
          setBusy(false);
        }
      }}
    >
      {saved ? "已存入素材库" : "下载到素材库"}
    </Button>
  );
}
