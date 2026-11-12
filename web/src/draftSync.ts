// Serialize saves per project/format. A delayed response cannot replace a newer edit.
export class DraftSync {
  private entries = new Map<
    string,
    {
      revision: number;
      pending?: unknown;
      last?: string;
      running: boolean;
      blocked: boolean;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private send: (
      key: string,
      body: unknown,
    ) => Promise<{ revision: number; saved_at: string }>,
    private notify: (key: string, message: string) => void,
  ) {}
  seed(key: string, revision: number) {
    if (!this.entries.has(key))
      this.entries.set(key, { revision, running: false, blocked: false });
  }
  enqueue(key: string, data: unknown) {
    const e = this.entries.get(key);
    if (!e) return;
    const raw = JSON.stringify(data);
    if (raw === e.last && !e.pending) return;
    e.pending = data;
    if (e.blocked) return;
    clearTimeout(e.timer);
    this.notify(key, "草稿待保存");
    e.timer = setTimeout(() => void this.flush(key), 800);
  }
  async flush(key: string) {
    const e = this.entries.get(key);
    if (!e || e.running || e.blocked || !e.pending) return;
    clearTimeout(e.timer);
    const data = e.pending;
    e.pending = undefined;
    e.running = true;
    this.notify(key, "正在保存草稿…");
    try {
      const saved = await this.send(key, {
        ...(data as object),
        revision: e.revision,
      });
      e.revision = saved.revision;
      e.last = JSON.stringify(data);
      this.notify(
        key,
        `草稿已保存 · ${new Date(saved.saved_at).toLocaleTimeString()}`,
      );
    } catch (error) {
      e.pending = e.pending || data;
      e.blocked = true;
      this.notify(key, `草稿未同步：${(error as Error).message}`);
    } finally {
      e.running = false;
    }
    if (e.pending && !e.blocked) await this.flush(key);
  }
  flushAll() {
    for (const key of this.entries.keys()) void this.flush(key);
  }
  retry(key: string) {
    const e = this.entries.get(key);
    if (e) {
      e.blocked = false;
      void this.flush(key);
    }
  }
}

export function preferredDraft(local: any, server: any) {
  if (!local) return server;
  if (!server) return local;
  // Retain legacy local unsaved text. New drafts have edit timestamps.
  if (!local.edited_at) return local;
  return Date.parse(server.edited_at || server.saved_at) >
    Date.parse(local.edited_at)
    ? server
    : local;
}
