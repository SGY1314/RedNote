import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { RewriteModel } from "../RewriteModels";

type Capability = "rewrite" | "image" | "video";

// One catalog per capability. A late response must not replace a newer reload.
export function useModelCatalog(capability: Capability) {
  const [models, setModels] = useState<RewriteModel[]>([]);
  const [selectedID, select] = useState("");
  const [error, setError] = useState("");
  const request = useRef(0);
  const reload = useCallback(
    async (preferredID?: string) => {
      const current = ++request.current;
      try {
        const list = await api<RewriteModel[]>(`/${capability}-models`);
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
    [capability],
  );
  useEffect(() => {
    void reload();
    return () => {
      request.current++;
    };
  }, [reload]);
  return { models, selectedID, select, error, reload };
}
