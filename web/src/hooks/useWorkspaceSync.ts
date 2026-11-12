import { useCallback, useEffect, useRef, useState } from "react";
import type { Asset, Job, Project, Publication } from "../api";
import { api, APIError } from "../api";
import type { SyncBatch } from "../sync";
import { mergeChanges } from "../sync";
export function useWorkspaceSync() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [connected, setConnected] = useState(true);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);
  const syncCursor = useRef({ cursor: 0, epoch: "" });
  const legacyJobs = useRef("");
  const refreshRunning = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const refresh = useCallback(() => {
    const run = async () => {
      try {
        for (let page = 0; page < 20; page++) {
          const batch = await api<SyncBatch>(
            `/sync?cursor=${syncCursor.current.cursor}&epoch=${encodeURIComponent(syncCursor.current.epoch)}`,
          );
          if (!mounted.current) return;
          setJobs((old) => mergeChanges(old, "jobs", batch));
          setAssets((old) => mergeChanges(old, "assets", batch));
          setProjects((old) => mergeChanges(old, "projects", batch));
          setPublications((old) => mergeChanges(old, "publications", batch));
          if (batch.reset || batch.changes.some((v) => v.entity === "jobs"))
            setTick((x) => x + 1);
          syncCursor.current = { cursor: batch.cursor, epoch: batch.epoch };
          setConnected(true);
          if (!batch.more) {
            setReady(true);
            break;
          }
        }
      } catch (e) {
        // Allow the old running backend to serve the newly built UI until
        // restart.cmd installs the staged executable. Retry /sync next time.
        if (e instanceof APIError && e.status === 404) {
          try {
            const [js, as, ps, pubs] = await Promise.all([
              api<Job[]>("/jobs"),
              api<Asset[]>("/assets?include_remote=true&include_results=true"),
              api<Project[]>("/rewrites?include_deleted=true"),
              api<Publication[]>("/publications?include_deleted=true"),
            ]);
            if (!mounted.current) return;
            if (legacyJobs.current !== JSON.stringify(js)) {
              setTick((x) => x + 1);
              legacyJobs.current = JSON.stringify(js);
            }
            setJobs(js);
            setAssets(as);
            setProjects(ps);
            setPublications(pubs);
            setConnected(true);
            setReady(true);
            syncCursor.current = { cursor: 0, epoch: "" };
            return;
          } catch {
            /* report connection failure below */
          }
        }
        if (mounted.current) setConnected(false);
      }
    };
    // Explicit refreshes queue behind an in-flight read so a mutation cannot
    // accidentally await a response taken before that mutation.
    const pending = (refreshRunning.current || Promise.resolve()).then(run);
    refreshRunning.current = pending;
    void pending.finally(() => {
      if (refreshRunning.current === pending) refreshRunning.current = null;
    });
    return pending;
  }, []);
  useEffect(() => {
    mounted.current = true;
    refresh();
    const id = setInterval(() => {
      if (!refreshRunning.current && !document.hidden) void refresh();
    }, 2000);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [refresh]);
  return {
    jobs,
    assets,
    projects,
    publications,
    setProjects,
    connected,
    ready,
    tick,
    refresh,
  };
}
