import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { RewriteModel } from "../RewriteModels";

// 工作区与后台管理控制台共用同一组模型分组标识。两侧 URL 不同
// （/image-models 与 /admin/models/image），但分组名必须一致，
// 否则同一份配置会在两个入口被读成不同的目录。
export type ModelCapability =
  | "rewrite"
  | "image"
  | "video"
  | "angle"
  | "title"
  | "copy"
  | "image-plan"
  | "video-script";

// One catalog per capability. A late response must not replace a newer reload.
// `endpoint` 让管理端复用完全相同的加载语义，只换地址，不改行为。
export function useModelCatalog(
  capability: ModelCapability,
  endpoint?: string,
) {
  const url = endpoint || `/${capability}-models`;
  const [models, setModels] = useState<RewriteModel[]>([]);
  const [selectedID, select] = useState("");
  const [error, setError] = useState("");
  const request = useRef(0);
  const reload = useCallback(
    async (preferredID?: string) => {
      const current = ++request.current;
      try {
        const response = await api<RewriteModel[] | null>(url);
        const list = response ?? [];
        if (current !== request.current) return;
        setModels(list);
        setError("");
        select((old) => {
          const preferred = preferredID || old;
          return list.some((model) => model.id === preferred)
            ? preferred
            : list[0]?.id || "";
        });
      } catch (e) {
        if (current === request.current) setError((e as Error).message);
      }
    },
    [url],
  );
  useEffect(() => {
    void reload();
    return () => {
      request.current++;
    };
  }, [reload]);
  return { models, selectedID, select, error, reload };
}
