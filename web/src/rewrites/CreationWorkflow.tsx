import DraftConflictDialog from "./DraftConflictDialog";
import { backupDraft, readDraftRecovery } from "./draftRecovery";
import SystemPromptEditor, {
  type PromptChoice,
  type PromptTemplate,
} from "./SystemPromptEditor";
import "./creation-workflow.css";
import ReferenceInputPanel, {
  type ReferenceInput,
} from "./ReferenceInputPanel";
import "./workflow-navigation.css";
import {
  CheckOutlined,
  FileTextOutlined,
  FontSizeOutlined,
  IdcardOutlined,
  PictureOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Select } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Asset, Job, Project, Publication, Version } from "../api";
import { api, post, APIError } from "../api";
import type { RewriteModel } from "../RewriteModels";
import TitleRewriteStep from "./TitleRewriteStep";
import CopyRewriteStep from "./CopyRewriteStep";
import MediaRewriteStep from "./MediaRewriteStep";
import VideoScriptEditor from "./VideoScriptEditor";
import { useStickyWorkflowNavigation } from "./useStickyWorkflowNavigation";
import PublicationConfirmation from "../components/PublicationConfirmation";
import OriginalCreationInput, {
  type OriginalInput,
} from "./OriginalCreationInput";
import AccountProfileStep, {
  accountFields,
  type AccountFields,
  type AccountProfile,
} from "./AccountProfileStep";

type Scope =
  | "source"
  | "account"
  | "angle"
  | "title"
  | "copy"
  | "image-plan"
  | "image"
  | "video-script"
  | "video"
  | "publish";
type Form = Partial<AccountFields> & {
  system_prompt_choice?: PromptChoice;
  reference_input?: ReferenceInput;
  angle?: string;
  angle_record_id?: string;
  angle_notices?: string[];
  model_id?: string;
  preset_id?: string;
  prompt?: string;
  requirements?: string;
  text?: string;
  title?: string;
  body?: string;
  custom_title?: string;
  selection_kind?: "candidate" | "custom" | "source";
  candidate_titles?: Record<string, string[]>;
  candidate_copies?: Record<string, { body: string; topics: string[] }[]>;
  source_copy?: { body: string; topics: string[] };
  upload_slots?: string[];
  result_asset_ids?: string[];
  excluded_result_asset_ids?: string[];
  topics?: string[];
  generation_id?: string;
  candidate_index?: number;
  scenes?: string[];
  reference_asset_ids?: string[];
  excluded_reference_asset_ids?: string[];
  count?: number;
  size?: string;
  parent_id?: string;
  copy_key?: string;
  kind?: string;
  asset_ids?: string[];
  selected_asset_ids?: string[];
  cover_id?: string;
  name?: string;
  reviewed_key?: string;
  target_platform?: "xhs" | "douyin" | "both";
  director_draft?: unknown;
  quality?: string;
  ratio?: string;
  duration?: number;
  audio?: boolean;
  request_id?: string;
  input_key?: string;
  applied_job_id?: string;
};
type Workflow = {
  id: string;
  stage_versions?: Partial<
    Record<"title" | "copy" | "image" | "video", string>
  >;
  account_profile?: AccountProfile;
  title: {
    angle?: string;
    key: string;
    text: string;
    generation_id: string;
    confirmed_at: string;
  };
  copy: {
    key: string;
    title_key: string;
    body: string;
    topics: string[];
    generation_id: string;
    confirmed_at: string;
  };
  image_plan_id: string;
  drafts: Partial<
    Record<Scope, { revision: number; data: Form; saved_at: string }>
  >;
};
type Generation = {
  id: string;
  title_key?: string;
  titles?: string[];
  copies?: { body: string; topics: string[] }[];
  model: string;
  angle?: string;
  prompt: string;
  preset_name?: string;
  preset_revision?: number;
  requirements: string;
  created_at: string;
};
type Plan = {
  id: string;
  copy_key: string;
  scenes: string[];
  reference_asset_ids: string[];
  parent_id?: string;
  confirmed_at?: string;
  model: string;
  created_at: string;
};
type AngleRecord = {
  id: string;
  model: string;
  preset_name?: string;
  created_at: string;
  notices: string[];
  angles: { name: string; description: string }[];
};
type Data = {
  title_system_prompts?: Record<string, string>;
  copy_system_prompts?: Record<string, string>;
  media_system_prompts?: Record<string, string>;
  angles: AngleRecord[];
  workflow: Workflow;
  basis?: Pick<Workflow, "title" | "copy">;
  reference: {
    id: string;
    title: string;
    body: string;
    topics: string[];
    asset_ids?: string[];
  };
  titles: Generation[];
  copies: Generation[];
  image_plans: Plan[];
};
const labels: Record<Scope, string> = {
  source: "创作素材",
  account: "基本信息",
  angle: "发帖角度",
  title: "标题仿写",
  copy: "文案仿写",
  "image-plan": "自动规划画面",
  image: "生成图片",
  "video-script": "生成完整脚本",
  video: "生成视频",
  publish: "发布素材",
};
export default function CreationWorkflow({
  active: visible = true,
  onReady,
  project: initialProject,
  assets,
  jobs,
  refresh,
}: {
  active?: boolean;
  onReady?: (id: string) => void;
  project: Project;
  assets: Asset[];
  jobs: Job[];
  refresh: () => Promise<void>;
  onPublish: () => void;
}) {
  const { message } = App.useApp();
  const root = useRef<HTMLElement>(null);
  const [project, setCurrentProject] = useState(initialProject);
  const [data, setData] = useState<Data>();
  useEffect(() => {
    if (data) onReady?.(initialProject.id);
  }, [data, onReady, initialProject.id]);
  useEffect(() => {
    if (!visible)
      root.current?.querySelectorAll("video").forEach((video) => video.pause());
  }, [visible]);
  const { navigation, compact } = useStickyWorkflowNavigation(
    root,
    data?.workflow.id,
  );
  const [detail, setDetail] = useState<{
    project?: Project;
    versions: Version[];
    reference_assets: Asset[];
    reference_videos: Asset[];
  }>();
  const [catalogs, setCatalogs] = useState<
    Partial<Record<Scope, RewriteModel[]>>
  >({});
  const [forms, setForms] = useState<Partial<Record<Scope, Form>>>({});
  const formRef = useRef(forms);
  formRef.current = forms;
  const stepKey = "rednote.workflow.step." + project.id;
  const readStep = () => {
    try {
      const value = localStorage.getItem(stepKey);
      return ["account", "title", "copy", "image", "video"].includes(
        value || "",
      )
        ? value
        : null;
    } catch {
      return null;
    }
  };
  const [step, updateStep] = useState(() => readStep() || "account");
  const setStep = (next: string) => {
    updateStep(next);
    try {
      localStorage.setItem(stepKey, next);
    } catch {}
  };
  useEffect(() => {
    if (root.current) {
      const top = root.current.getBoundingClientRect().top;
      if (top < 0)
        root.current
          .closest<HTMLElement>(".rewrite-main")
          ?.scrollTo({ top: 0, behavior: "instant" });
    }
  }, [step]);
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>(
      ".creation-workflow .workflow-steps",
    );
    if (!nav) return;
    const reveal = () => {
      const selected = nav.querySelector<HTMLElement>('[aria-current="step"]');
      if (!selected) return;
      const nr = nav.getBoundingClientRect(),
        sr = selected.getBoundingClientRect();
      if (sr.left < nr.left || sr.right > nr.right)
        nav.scrollLeft += sr.left - nr.left - (nr.width - sr.width) / 2;
    };
    const observer = new ResizeObserver(reveal);
    observer.observe(nav);
    reveal();
    return () => observer.disconnect();
  }, [step, data?.workflow.id]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("草稿 · 已自动保存");
  const [uploadedAssets, setUploadedAssets] = useState<Asset[]>([]);
  const [publicationConfirmation, setPublicationConfirmation] = useState<
    Publication[]
  >([]);
  const revisions = useRef<Partial<Record<Scope, number>>>({});
  const pending = useRef(new Map<Scope, Form>());
  const initialized = useRef(false);
  const saving = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const endpoint = `/rewrites/${project.id}`;
  const blockedDrafts = useRef(new Set<Scope>());
  const [conflictScopes, setConflictScopes] = useState<Scope[]>([]);
  const [conflictScope, setConflictScope] = useState<Scope>();
  const [conflictServer, setConflictServer] = useState<{
    revision: number;
    data: Form;
  }>();
  const [conflictReadError, setConflictReadError] = useState("");
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const openDraftConflict = useCallback(
    async (scope: Scope) => {
      setConflictScope(scope);
      setConflictServer(undefined);
      setConflictReadError("");
      try {
        const latest = await api<Data>(endpoint + "/workflow");
        const draft = latest.workflow.drafts[scope];
        setConflictServer({
          revision: draft?.revision || 0,
          data: draft?.data || {},
        });
      } catch (e) {
        setConflictReadError((e as Error).message);
      }
    },
    [endpoint],
  );
  const flush = useCallback(async () => {
    if (saving.current) {
      await saving.current;
      if (pending.current.size) return flush();
      return;
    }
    const run = async () => {
      if (blockedDrafts.current.size)
        throw new Error("存在未核对的草稿，请先处理草稿冲突");
      while (pending.current.size) {
        const [scope, value] = pending.current.entries().next().value!;
        pending.current.delete(scope);
        try {
          const d = await post<{
            revision: number;
            project?: Project;
            reference?: Data["reference"];
            basis?: Data["basis"];
          }>(`${endpoint}/workflow/drafts/${scope}`, {
            revision: revisions.current[scope] || 0,
            data: value,
          });
          revisions.current[scope] = d.revision;
          if (!pending.current.has(scope)) backupDraft(project.id, scope);
          if (d.project) setCurrentProject(d.project);
          if (d.reference)
            setData((old) =>
              old
                ? {
                    ...old,
                    reference: d.reference!,
                    basis: d.basis || old.basis,
                  }
                : old,
            );
        } catch (e) {
          if (!pending.current.has(scope)) pending.current.set(scope, value);
          backupDraft(project.id, scope, pending.current.get(scope));
          if (e instanceof APIError && e.status === 409) {
            blockedDrafts.current.add(scope);
            if (mounted.current) {
              setConflictScopes([...blockedDrafts.current]);
              void openDraftConflict(scope);
            }
          }
          if (mounted.current) {
            setStatus("草稿保存失败，请重试");
            setError((e as Error).message);
          }
          throw e;
        }
      }
      if (mounted.current) setStatus("草稿 · 已自动保存");
    };
    saving.current = run();
    try {
      await saving.current;
    } finally {
      saving.current = null;
    }
  }, [endpoint, project.id, openDraftConflict]);
  useEffect(
    () => () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      void flush().catch(() => {});
    },
    [flush],
  );
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current.size || saving.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const edit = useCallback(
    (scope: Scope, patch: Partial<Form>) => {
      const value = { ...formRef.current[scope], ...patch };
      formRef.current = { ...formRef.current, [scope]: value };
      setForms(formRef.current);
      pending.current.set(scope, value);
      backupDraft(project.id, scope, value);
      setStatus("草稿 · 保存中…");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush().catch(() => {});
      }, 600);
    },
    [flush, project.id],
  );
  const [optionalError, setOptionalError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const load = useCallback(async () => {
    const [result, d, defaultsResult, templatesResult] = await Promise.all([
      api<Data>(endpoint + "/workflow"),
      api<{
        project?: Project;
        versions: Version[];
        reference_assets: Asset[];
        reference_videos: Asset[];
      }>(endpoint),
      api<Partial<AccountFields>>("/profile/default").then(
        (value) => ({ value, error: "" }),
        (e: Error) => ({
          value: {} as Partial<AccountFields>,
          error: `默认资料加载失败：${e.message}`,
        }),
      ),
      api<PromptTemplate[]>("/prompt-presets").then(
        (value) => ({ value, error: "" }),
        (e: Error) => ({
          value: null,
          error: `提示词模板加载失败：${e.message}`,
        }),
      ),
    ]);
    if (!mounted.current) return;
    const defaults = defaultsResult.value;
    const templates = templatesResult.value || [];
    setOptionalError(
      [defaultsResult.error, templatesResult.error].filter(Boolean).join("；"),
    );
    if (templatesResult.value) setPromptTemplates(templates);
    setData({
      ...result,
      reference: { ...result.reference, topics: result.reference.topics ?? [] },
    });
    setDetail(d);
    if (d.project) setCurrentProject(d.project);
    if (!initialized.current) {
      initialized.current = true;
      const initial: Partial<Record<Scope, Form>> = {};
      for (const [scope, draft] of Object.entries(result.workflow.drafts)) {
        const value = { ...draft!.data };
        if ((scope === "title" || scope === "copy") && value.prompt?.trim()) {
          const combined = [value.requirements?.trim(), value.prompt.trim()]
            .filter(Boolean)
            .join("\n");
          if (Array.from(combined).length <= 4000) {
            value.requirements = combined;
            value.prompt = "";
            pending.current.set(scope as Scope, value);
          }
        }
        initial[scope as Scope] = value;
        revisions.current[scope as Scope] = draft!.revision;
      }
      for (const scope of [
        "title",
        "copy",
        "image",
        "video-script",
        "video",
      ] as Scope[]) {
        if (templatesResult.value && !initial[scope]?.system_prompt_choice) {
          const t =
            templates.find((t) => t.scope === scope && t.is_default) ||
            templates.find((t) => t.scope === scope);
          initial[scope] = {
            ...initial[scope],
            system_prompt_choice: {
              enabled: !!t,
              text: t?.prompt || "",
              template_id: t?.id,
              template_revision: t?.revision,
            },
          };
          pending.current.set(scope, initial[scope]!);
        }
      }
      // Migrate the former shared duration without changing existing project timing.
      if (!initial["video-script"]?.duration && initial.video?.duration) {
        initial["video-script"] = {
          ...initial["video-script"],
          duration: initial.video.duration,
        };
        pending.current.set("video-script", initial["video-script"]!);
      }
      if (!initial.account)
        initial.account = accountFields(
          result.workflow.account_profile?.status
            ? result.workflow.account_profile
            : defaults,
        );
      const initialReference: ReferenceInput = {
        title: result.workflow.title.key
          ? result.workflow.title.text
          : result.reference.title || "",
        body: result.workflow.copy.key
          ? result.workflow.copy.body
          : result.reference.body || "",
        topics: result.workflow.copy.key
          ? result.workflow.copy.topics
          : result.reference.topics || [],
        use_title: !!(result.workflow.title.key
          ? result.workflow.title.text
          : result.reference.title),
        use_body: !!(result.workflow.copy.key
          ? result.workflow.copy.body
          : result.reference.body),
        use_images: true,
        asset_ids: [...(d.reference_assets || [])]
          .filter((a) => a.kind === "image" && a.status === "ready")
          .sort((a, b) => a.position - b.position)
          .slice(0, 3)
          .map((a) => a.id),
      };
      for (const scope of [
        "title",
        "copy",
        "image",
        "video-script",
      ] as Scope[]) {
        if (!initial[scope]?.reference_input) {
          initial[scope] = {
            ...initial[scope],
            reference_input: {
              ...initialReference,
              policy_version: 1,
              title_source:
                scope !== "title" && result.workflow.title.key
                  ? "rewritten"
                  : "original",
              body_source:
                scope !== "copy" && result.workflow.copy.key
                  ? "rewritten"
                  : "original",
              ...(scope === "title"
                ? {
                    title: result.reference.title || "",
                    use_title: !!result.reference.title,
                  }
                : {}),
              ...(scope === "copy"
                ? {
                    body: result.reference.body || "",
                    topics: result.reference.topics || [],
                    use_body: !!result.reference.body,
                  }
                : {}),
              asset_ids:
                scope === "image"
                  ? (initial[scope]?.reference_asset_ids ??
                    initialReference.asset_ids)
                  : initialReference.asset_ids,
            },
          };
          pending.current.set(scope, initial[scope]!);
        }
      }
      const recovered = readDraftRecovery(project.id);
      for (const scope of [
        "source",
        "account",
        "angle",
        "title",
        "copy",
        "image-plan",
        "image",
        "video-script",
        "video",
        "publish",
      ] as Scope[]) {
        const value = recovered[scope];
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const server = result.workflow.drafts[scope]?.data || {};
          if (JSON.stringify(value) === JSON.stringify(server)) {
            backupDraft(project.id, scope);
            continue;
          }
          initial[scope] = value as Form;
          pending.current.set(scope, value as Form);
          blockedDrafts.current.add(scope);
        }
      }
      if (blockedDrafts.current.size) {
        setConflictScopes([...blockedDrafts.current]);
        setError("发现尚未保存的修改，请核对后继续");
        void openDraftConflict([...blockedDrafts.current][0]);
      }
      setStep(
        readStep() ||
          (result.workflow.account_profile?.status ? "title" : "account"),
      );
      formRef.current = initial;
      setForms(initial);
      if (pending.current.size)
        timer.current = setTimeout(() => {
          void flush().catch(() => {});
        }, 600);
    }
  }, [endpoint, flush, project.id, openDraftConflict]);
  useEffect(() => {
    void load().catch((e) => {
      setError(e.message);
      onReady?.(initialProject.id);
    });
    const scopes = [
      "title",
      "copy",
      "image",
      "video",
      "video-script",
    ] as Scope[];
    void Promise.allSettled(
      scopes.map(async (scope) => {
        const models = await api<RewriteModel[]>(`/${scope}-models`);
        if (mounted.current)
          setCatalogs((previous) => ({ ...previous, [scope]: models }));
        return models;
      }),
    ).then((results) => {
      if (!mounted.current) return;
      const loaded: Partial<Record<Scope, RewriteModel[]>> = {};
      const failures: string[] = [];
      results.forEach((result, index) => {
        const scope = scopes[index];
        if (result.status === "fulfilled") loaded[scope] = result.value;
        else
          failures.push(
            `${({ title: "标题", copy: "文案", image: "图片", video: "视频", "video-script": "脚本" } as Record<string, string>)[scope]}模型加载失败：${result.reason?.message || "请求失败"}`,
          );
      });
      setCatalogs((previous) => ({ ...previous, ...loaded }));
      setCatalogError(failures.join("；"));
    });
  }, [load]);
  const tick = jobs
    .filter((j) => j.target === project.id)
    .map((j) => j.id + j.state + j.updated_at)
    .join();
  useEffect(() => {
    if (initialized.current) void load().catch((e) => setError(e.message));
  }, [tick, load]);
  const action = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await flush();
      await fn();
      await load();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const resolveDraftConflict = async (keepLocal: boolean) => {
    if (!conflictScope || !conflictServer || resolvingConflict) return;
    const scope = conflictScope;
    setResolvingConflict(true);
    revisions.current[scope] = conflictServer.revision;
    if (keepLocal) {
      pending.current.set(scope, formRef.current[scope] || {});
      backupDraft(project.id, scope, formRef.current[scope] || {});
    } else {
      pending.current.delete(scope);
      backupDraft(project.id, scope);
      formRef.current = { ...formRef.current, [scope]: conflictServer.data };
      setForms(formRef.current);
    }
    blockedDrafts.current.delete(scope);
    setConflictScopes([...blockedDrafts.current]);
    setConflictScope(undefined);
    setConflictServer(undefined);
    try {
      if (blockedDrafts.current.size)
        void openDraftConflict([...blockedDrafts.current][0]);
      else {
        await flush();
        setError("");
        await load();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResolvingConflict(false);
    }
  };
  const f = (scope: Scope) => forms[scope] || {};
  const targetDuration =
    f("video-script").duration || f("video").duration || 10;
  const promptEditor = (scope: Scope) => (
    <SystemPromptEditor
      scope={scope}
      templates={promptTemplates}
      choice={f(scope).system_prompt_choice || { enabled: false, text: "" }}
      disabled={busy}
      onChange={(system_prompt_choice) => edit(scope, { system_prompt_choice })}
    />
  );
  const savedWorkflow = data?.workflow;
  const w = savedWorkflow ? { ...savedWorkflow, ...data?.basis } : undefined;
  const accountReady = !!savedWorkflow?.account_profile?.status;
  const titleConfirmed = !!savedWorkflow?.title.key;
  const copyConfirmed = !!savedWorkflow?.copy.key;
  const titleGeneration = data?.titles[0];
  const titleCandidates = titleGeneration
    ? (f("title").candidate_titles?.[titleGeneration.id] ??
      titleGeneration.titles ??
      [])
    : [];
  const titleText = f("title").text ?? savedWorkflow?.title.text ?? "";
  const customTitle =
    f("title").custom_title ??
    (!savedWorkflow?.title.generation_id ? savedWorkflow?.title.text : "") ??
    "";
  const customSelected =
    f("title").selection_kind === "custom" ||
    (!f("title").selection_kind &&
      !(f("title").generation_id ?? savedWorkflow?.title.generation_id) &&
      !!titleText);
  const titleSelection =
    titleGeneration?.id ===
    (f("title").generation_id ?? savedWorkflow?.title.generation_id)
      ? (f("title").candidate_index ??
        titleCandidates.findIndex((text) => text === titleText))
      : -1;
  const copyGeneration = data?.copies.find(
    (record) => record.title_key === w?.title.key,
  );
  const copyCandidates = copyGeneration
    ? (f("copy").candidate_copies?.[copyGeneration.id] ??
      copyGeneration.copies ??
      [])
    : [];
  const copyText = f("copy").text ?? savedWorkflow?.copy.body ?? "";
  const copyTopics = f("copy").topics ?? savedWorkflow?.copy.topics ?? [];
  // A new title can detach the selected copy from its generation. Keep the
  // selected text editable instead of silently replacing it with the source.
  const detachedCopy =
    !!(f("copy").generation_id ?? savedWorkflow?.copy.generation_id) &&
    copyGeneration?.id !==
      (f("copy").generation_id ?? savedWorkflow?.copy.generation_id);
  const sourceCopy = detachedCopy
    ? { body: copyText, topics: copyTopics }
    : (f("copy").source_copy ?? {
        body:
          f("copy").text ??
          (savedWorkflow?.copy.key
            ? savedWorkflow.copy.body
            : data?.reference.body || ""),
        topics:
          f("copy").topics ??
          (savedWorkflow?.copy.key
            ? savedWorkflow.copy.topics
            : data?.reference.topics || []),
      });
  const copySelection =
    copyGeneration?.id ===
    (f("copy").generation_id ?? savedWorkflow?.copy.generation_id)
      ? (f("copy").candidate_index ??
        copyCandidates.findIndex((copy) => copy.body === copyText))
      : -1;
  const ownJobs = jobs.filter((j) => j.target === project.id);
  const active = (kind: string) =>
    ownJobs.some(
      (j) => j.kind === kind && ["queued", "running"].includes(j.state),
    );
  const selectedModel = (scope: Scope) =>
    f(scope).model_id ||
    catalogs[scope]?.find(
      (m) =>
        m.configured &&
        m.id === localStorage.getItem("gin.workflow.model." + scope),
    )?.id ||
    catalogs[scope]?.find((m) => m.configured)?.id ||
    "";
  const modelReady = (scope: Scope) =>
    catalogs[scope]?.some((m) => m.id === selectedModel(scope) && m.configured);
  const modelControl = (scope: Scope, disabled = false) => (
    <label className="workflow-field">
      <span>{labels[scope]}模型</span>
      <Select
        aria-label={labels[scope] + "模型"}
        disabled={disabled}
        value={selectedModel(scope) || undefined}
        placeholder="请选择本环节模型"
        options={(catalogs[scope] || []).map((m) => ({
          value: m.id,
          label: m.name + (m.configured ? "" : " · 待配置"),
        }))}
        onChange={(id) => {
          localStorage.setItem("gin.workflow.model." + scope, id);
          edit(scope, { model_id: id });
        }}
      />
    </label>
  );
  const publishTarget =
    f("publish").target_platform || project.platform || "xhs";
  const selectedMedia = (scope: "image" | "video") =>
    (
      f(scope).selected_asset_ids ??
      ((f("publish").kind || project.kind || "image") === scope
        ? (f("publish").asset_ids ?? [])
        : [])
    ).filter((id) => !f(scope).excluded_result_asset_ids?.includes(id));
  const mediaKind = step === "video" ? "video" : "image";
  const chosen = selectedMedia(mediaKind);
  const mediaCover = (scope: "image" | "video") =>
    f(scope).cover_id ??
    (f("publish").kind === scope ? f("publish").cover_id : undefined) ??
    project.media_selections?.[scope]?.cover_id ??
    project.cover_id ??
    "";
  const allAssets = [
    ...new Map(
      [
        ...assets,
        ...uploadedAssets,
        ...(detail?.reference_assets || []),
        ...(detail?.reference_videos || []),
      ].map((a) => [a.id, a]),
    ).values(),
  ];
  const original = !project.note_id;
  const sourceForm = f("source");
  const originalInput: OriginalInput = {
    title: sourceForm.title ?? data?.reference.title ?? "",
    body: sourceForm.body ?? data?.reference.body ?? "",
    topics: sourceForm.topics ?? data?.reference.topics ?? [],
    asset_ids: sourceForm.asset_ids ?? data?.reference.asset_ids ?? [],
  };
  const sourceAssets = allAssets
    .filter(
      (asset) =>
        (original
          ? originalInput.asset_ids.includes(asset.id)
          : asset.revision_id === project.revision_id) &&
        !asset.deleted_at &&
        (asset.kind === "image" || asset.kind === "video"),
    )
    .sort((a, b) => (a.position || 0) - (b.position || 0));
  const referenceScope = step === "video" ? "video-script" : (step as Scope);
  const referenceValue: ReferenceInput = f(referenceScope).reference_input ?? {
    policy_version: 1,
    title_source:
      referenceScope !== "title" && savedWorkflow?.title.key
        ? "rewritten"
        : "original",
    body_source:
      referenceScope !== "copy" && savedWorkflow?.copy.key
        ? "rewritten"
        : "original",
    title:
      referenceScope !== "title" && savedWorkflow?.title.key
        ? savedWorkflow.title.text
        : originalInput.title,
    body:
      referenceScope !== "copy" && savedWorkflow?.copy.key
        ? savedWorkflow.copy.body
        : originalInput.body,
    topics:
      referenceScope !== "copy" && savedWorkflow?.copy.key
        ? savedWorkflow.copy.topics
        : originalInput.topics,
    use_title: !!(referenceScope !== "title" && savedWorkflow?.title.key
      ? savedWorkflow.title.text
      : originalInput.title),
    use_body: !!(referenceScope !== "copy" && savedWorkflow?.copy.key
      ? savedWorkflow.copy.body
      : originalInput.body),
    use_images: true,
    asset_ids: sourceAssets
      .filter((a) => a.kind === "image" && a.status === "ready")
      .slice(0, 3)
      .map((a) => a.id),
  };
  const sourceControl = (
    <ReferenceInputPanel
      key={project.id + referenceScope}
      value={referenceValue}
      titleRewritten={referenceScope !== "title" && !!savedWorkflow?.title.key}
      bodyRewritten={referenceScope !== "copy" && !!savedWorkflow?.copy.key}
      assets={allAssets}
      sourceAssets={sourceAssets}
      projectID={project.id}
      disabled={busy}
      onChange={(value) =>
        edit(referenceScope, {
          reference_input: value,
          ...(referenceScope === "image"
            ? { reference_asset_ids: value.use_images ? value.asset_ids : [] }
            : {}),
        })
      }
      onUploaded={(asset) => setUploadedAssets((old) => [...old, asset])}
    />
  );
  const currentKinds =
    step === "title"
      ? ["angle_recommend", "title_rewrite"]
      : step === "copy"
        ? ["copy_rewrite"]
        : step === "image"
          ? ["image_plan", "image_generation"]
          : [];
  const stageTasks = currentKinds
    .map(
      (kind) =>
        ownJobs
          .filter((j) => j.kind === kind)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0],
    )
    .filter(
      (j): j is Job =>
        !!j &&
        ["queued", "running", "failed", "needs_review", "blocked"].includes(
          j.state,
        ),
    );
  const taskFeedback = stageTasks.length > 0 && (
    <div className="workflow-task-feedback" role="status">
      {stageTasks.map((j) => (
        <Alert
          key={j.id}
          showIcon
          type={["queued", "running"].includes(j.state) ? "info" : "warning"}
          message={`${({ angle_recommend: "角度推荐", title_rewrite: "标题生成", copy_rewrite: "文案生成", image_plan: "画面规划", image_generation: "图片生成" } as Record<string, string>)[j.kind]} · ${j.error || j.stage}`}
          action={
            ["failed", "blocked"].includes(j.state) && (
              <Button
                size="small"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await post(`/jobs/${j.id}/retry`, {});
                  })
                }
              >
                重试
              </Button>
            )
          }
        />
      ))}
    </div>
  );
  const stageButton = (
    id: string,
    label: string,
    Icon: typeof IdcardOutlined,
    complete = false,
  ) => (
    <Button
      key={id}
      type="text"
      className="workflow-step-button"
      aria-label={label}
      aria-current={step === id ? "step" : undefined}
      title={complete ? `${label} · 已保存` : label}
      disabled={busy}
      onClick={() => {
        void flush()
          .then(() => setStep(id))
          .catch((error) => setError((error as Error).message));
      }}
    >
      <span className="workflow-step-icon" aria-hidden="true">
        <Icon />
        {complete && (
          <span className="workflow-step-complete">
            <CheckOutlined />
          </span>
        )}
      </span>
      <span className="workflow-step-label">{label}</span>
    </Button>
  );
  const generateText = (scope: "title" | "copy") =>
    action(async () => {
      edit(scope, { reference_input: referenceValue });
      await flush();
      await post(
        endpoint +
          (scope === "title" ? "/titles/generate" : "/copies/generate"),
        {
          ...f(scope),
          count: f(scope).count || 3,
          prompt: "",
          angle: scope === "title" ? "" : w?.title.angle,
          model_id: selectedModel(scope),
          preset_id: "",
        },
      );
    });
  const saveStage = async (
    scope: "title" | "copy" | "image" | "video",
    publish: boolean,
  ) => {
    const currentBasis = original
      ? (await api<Data>(endpoint + "/workflow")).basis
      : w;
    const ids = (
      scope === "image" || scope === "video" ? selectedMedia(scope) : []
    ).filter((id) => {
      const asset = allAssets.find((asset) => asset.id === id);
      return (
        asset?.kind === scope &&
        (scope !== "image" ||
          asset.source === "generated" ||
          !!f("image").upload_slots?.includes(id) ||
          !!f("image").result_asset_ids?.includes(id))
      );
    });
    const cover = mediaCover(scope === "video" ? "video" : "image");
    const result = await post<{
      workflow: Workflow;
      version: Version;
      publications: Publication[];
    }>(endpoint + "/workflow/stage", {
      step: scope,
      text:
        scope === "copy" && copySelection < 0
          ? sourceCopy.body
          : (f(scope).text ??
            (scope === "title" ? w?.title.text : w?.copy.body)),
      topics:
        scope === "copy" && copySelection < 0 ? sourceCopy.topics : copyTopics,
      generation_id:
        scope === "copy" && copySelection < 0
          ? ""
          : f(scope).generation_id || "",
      title_key: currentBasis?.title.key,
      copy_key: currentBasis?.copy.key,
      media:
        scope === "image" || scope === "video"
          ? {
              kind: scope,
              asset_ids: ids,
              cover_id:
                scope === "image"
                  ? ids.includes(cover)
                    ? cover
                    : ids[0] || ""
                  : cover,
            }
          : undefined,
      target_platform: publishTarget,
      use_project_image_results: scope === "image" || undefined,
      use_project_video_results: scope === "video" || undefined,
      publish,
    });
    if ((scope === "title" || scope === "copy") && result.workflow) {
      const next = { ...formRef.current };
      for (const target of [
        "title",
        "copy",
        "image",
        "video-script",
      ] as Scope[]) {
        const draft = result.workflow.drafts[target];
        if (!draft) continue;
        revisions.current[target] = draft.revision;
        next[target] = {
          ...next[target],
          reference_input: draft.data.reference_input,
        };
      }
      formRef.current = next;
      setForms(next);
    }
    message.success(publish ? "请核对发布内容" : "已保存");
    if (publish) setPublicationConfirmation(result.publications);
  };
  if (!data)
    return (
      <section className="creation-workflow">
        <Alert
          type={error ? "error" : "info"}
          message={error || "正在加载创作流程…"}
        />
        {error && (
          <Button onClick={() => void load().catch((e) => setError(e.message))}>
            重试加载
          </Button>
        )}
      </section>
    );
  return (
    <section
      className="creation-workflow"
      ref={root}
      data-project-id={project.id}
    >
      <div className="workflow-save-announcement" role="status">
        {status}
      </div>
      <div
        className={`workflow-navigation${compact ? " is-compact" : ""}`}
        ref={navigation}
      >
        <nav
          className="workflow-steps workflow-icon-toolbar"
          aria-label="仿写创作步骤"
        >
          {stageButton("account", "基本信息", IdcardOutlined, accountReady)}
          {stageButton("title", "标题仿写", FontSizeOutlined, titleConfirmed)}
          {stageButton("copy", "文案仿写", FileTextOutlined, copyConfirmed)}
          {stageButton("image", "图片仿写", PictureOutlined)}
          {stageButton("video", "视频仿写", VideoCameraOutlined)}
        </nav>
      </div>

      {!!conflictScopes.length && (
        <Alert
          type="warning"
          message="存在未保存或冲突的草稿，本页修改已保留。"
          action={
            <Button onClick={() => void openDraftConflict(conflictScopes[0])}>
              核对草稿冲突
            </Button>
          }
        />
      )}
      {conflictScope && (
        <DraftConflictDialog
          local={formRef.current[conflictScope] || {}}
          server={conflictServer?.data}
          error={conflictReadError}
          working={resolvingConflict}
          onReload={() => void openDraftConflict(conflictScope)}
          onLocal={() => void resolveDraftConflict(true)}
          onServer={() => void resolveDraftConflict(false)}
          onClose={() => setConflictScope(undefined)}
        />
      )}
      {(optionalError || catalogError) && (
        <Alert
          type="warning"
          message={[optionalError, catalogError].filter(Boolean).join("；")}
        />
      )}
      {error && (
        <Alert
          type="error"
          message={error}
          action={
            status.includes("失败") && !conflictScopes.length ? (
              <Button size="small" onClick={() => void flush().catch(() => {})}>
                重试保存
              </Button>
            ) : undefined
          }
          closable
          onClose={() => setError("")}
        />
      )}
      {step === "account" && (
        <AccountProfileStep
          value={f("account")}
          profile={w?.account_profile}
          busy={busy}
          onChange={(patch) => edit("account", patch)}
          onConfirm={() =>
            void action(async () => {
              await post(endpoint + "/workflow/account", {
                ...accountFields(formRef.current.account),
                revision: w?.account_profile?.revision || 0,
                draft_revision: revisions.current.account || 0,
              });
              setStep("title");
            })
          }
          onSkip={() =>
            void action(async () => {
              await post(endpoint + "/workflow/account", {
                skip: true,
                revision: w?.account_profile?.revision || 0,
                draft_revision: revisions.current.account || 0,
              });
              setStep("title");
            })
          }
        />
      )}
      {step === "title" && (
        <TitleRewriteStep
          promptControl={promptEditor("title")}
          sourceControl={sourceControl}
          reference={data.reference}
          assets={sourceAssets}
          systemPrompt={
            data.title_system_prompts?.[String(f("title").count || 3)] ||
            `结合原始标题、正文及标签，参考账号基本信息和补充要求，生成 ${f("title").count || 3} 个自然、准确、不夸张的标题。`
          }
          requirements={f("title").requirements || ""}
          modelControl={modelControl("title", busy || active("title_rewrite"))}
          modelName={
            catalogs["title"]?.find(
              (model) => model.id === selectedModel("title"),
            )?.name || "选择模型"
          }
          count={f("title").count || 3}
          working={busy || active("title_rewrite")}
          generating={active("title_rewrite")}
          modelReady={!!modelReady("title")}
          canGenerate={
            !!(
              (referenceValue.use_title && referenceValue.title) ||
              (referenceValue.use_body && referenceValue.body) ||
              (referenceValue.use_images && referenceValue.asset_ids.length) ||
              f("title").requirements?.trim() ||
              data.reference.title ||
              data.reference.body ||
              data.reference.topics.length ||
              (original &&
                (originalInput.title ||
                  originalInput.body ||
                  originalInput.topics.length ||
                  f("title").requirements?.trim() ||
                  (w?.account_profile?.status === "confirmed" &&
                    Object.values(accountFields(w.account_profile)).some(
                      (value) => value.trim(),
                    ))))
            )
          }
          selected={titleText}
          selectedIndex={titleSelection}
          candidates={titleCandidates}
          generationKey={titleGeneration?.id || ""}
          customTitle={customTitle}
          customSelected={customSelected}
          onEditCandidate={(index, text) => {
            if (!titleGeneration) return;
            const values = [...titleCandidates];
            values[index] = text;
            edit("title", {
              candidate_titles: {
                ...f("title").candidate_titles,
                [titleGeneration.id]: values,
              },
              ...(titleSelection === index ? { text } : {}),
            });
          }}
          onCustomEdit={(text) =>
            edit("title", {
              custom_title: text,
              text,
              selection_kind: "custom",
              generation_id: "",
              candidate_index: undefined,
            })
          }
          onCustomSelect={(selected) =>
            edit("title", {
              text: selected ? customTitle : "",
              selection_kind: selected ? "custom" : "candidate",
              generation_id: "",
              candidate_index: undefined,
            })
          }
          limit={project.platform === "douyin" ? 200 : 20}
          feedback={taskFeedback}
          onRequirements={(requirements) => edit("title", { requirements })}
          onCount={(count) => edit("title", { count })}
          onGenerate={() => void generateText("title")}
          onSelect={(index) =>
            edit("title", {
              text: index === null ? "" : titleCandidates[index],
              generation_id: index === null ? "" : titleGeneration!.id,
              selection_kind: "candidate",
              candidate_index: index ?? undefined,
            })
          }
          onConfirm={() => void action(() => saveStage("title", false))}
          onPublish={() => void action(() => saveStage("title", true))}
        />
      )}
      {step === "copy" && (
        <CopyRewriteStep
          promptControl={promptEditor("copy")}
          sourceControl={sourceControl}
          reference={data.reference}
          original={sourceCopy}
          originalLabel={
            sourceCopy.body === data.reference.body ? "原始文案" : "当前文案"
          }
          assets={sourceAssets}
          title={w?.title.text || ""}
          systemPrompt={
            data.copy_system_prompts?.[String(f("copy").count || 3)] || ""
          }
          requirements={f("copy").requirements || ""}
          modelControl={modelControl("copy", busy || active("copy_rewrite"))}
          modelName={
            catalogs["copy"]?.find(
              (model) => model.id === selectedModel("copy"),
            )?.name || "选择模型"
          }
          count={f("copy").count || 3}
          working={busy || active("copy_rewrite")}
          generating={active("copy_rewrite")}
          modelReady={!!modelReady("copy")}
          selected={copyText}
          selectedIndex={copySelection}
          topics={copyTopics}
          candidates={copyCandidates}
          feedback={taskFeedback}
          onRequirements={(requirements) => edit("copy", { requirements })}
          onCount={(count) => edit("copy", { count })}
          onGenerate={() => void generateText("copy")}
          onSelect={(index) => {
            const copy = index === null ? undefined : copyCandidates[index];
            edit("copy", {
              text: copy?.body || "",
              topics: copy?.topics || [],
              generation_id: copy ? copyGeneration!.id : "",
              candidate_index: index ?? undefined,
              selection_kind: copy ? "candidate" : "source",
            });
          }}
          onOriginal={() =>
            edit("copy", {
              text: sourceCopy.body,
              topics: sourceCopy.topics,
              source_copy: sourceCopy,
              generation_id: "",
              candidate_index: undefined,
              selection_kind: "source",
            })
          }
          onText={(index, text) => {
            if (index < 0 || !copyGeneration) {
              edit("copy", {
                source_copy: { ...sourceCopy, body: text },
                ...(copySelection < 0
                  ? { generation_id: "", selection_kind: "source" }
                  : {}),
                ...(copySelection < 0
                  ? { text, topics: sourceCopy.topics }
                  : {}),
              });
              return;
            }
            const copies = copyCandidates.map((item, position) =>
              position === index ? { ...item, body: text } : item,
            );
            edit("copy", {
              ...(copySelection === index ? { text } : {}),
              candidate_copies: {
                ...f("copy").candidate_copies,
                [copyGeneration!.id]: copies,
              },
            });
          }}
          onTopics={(index, topics) => {
            if (index < 0 || !copyGeneration) {
              edit("copy", {
                source_copy: { ...sourceCopy, topics },
                ...(copySelection < 0
                  ? { generation_id: "", selection_kind: "source" }
                  : {}),
                ...(copySelection < 0 ? { text: sourceCopy.body, topics } : {}),
              });
              return;
            }
            const copies = copyCandidates.map((item, position) =>
              position === index ? { ...item, topics } : item,
            );
            edit("copy", {
              ...(copySelection === index ? { topics } : {}),
              candidate_copies: {
                ...f("copy").candidate_copies,
                [copyGeneration!.id]: copies,
              },
            });
          }}
          onConfirm={() => void action(() => saveStage("copy", false))}
          onPublish={() => void action(() => saveStage("copy", true))}
        />
      )}
      {(step === "image" || step === "video") && (
        <MediaRewriteStep
          promptControl={promptEditor(step as Scope)}
          sourceControl={sourceControl}
          imageContextControl={
            original ? (
              <OriginalCreationInput
                contentOnly
                value={originalInput}
                assets={allAssets}
                disabled={
                  busy ||
                  ownJobs.some((job) =>
                    ["queued", "running"].includes(job.state),
                  )
                }
                onChange={(patch) =>
                  edit("source", { ...originalInput, ...patch })
                }
                onUploaded={(asset) => {
                  setUploadedAssets((old) => [...old, asset]);
                  void refresh().catch((error) => setError(error.message));
                }}
              />
            ) : undefined
          }
          key={step}
          kind={step}
          projectID={project.id}
          revisionID={project.revision_id || ""}
          copyKey={w?.copy.key || ""}
          accountKey={w?.account_profile?.key || ""}
          title={w?.title.text || ""}
          body={w?.copy.body || ""}
          topics={w?.copy.topics || []}
          sources={sourceAssets}
          assets={allAssets}
          jobs={jobs}
          models={catalogs[step] || []}
          modelID={selectedModel(step)}
          form={{
            ...f(step),
            ...(step === "video" ? { duration: targetDuration } : {}),
          }}
          systemPrompt={data.media_system_prompts?.[step] || ""}
          scriptText={step === "video" ? f("video-script").text || "" : ""}
          scriptControl={
            step === "video" ? (
              <VideoScriptEditor
                promptControl={promptEditor("video-script")}
                projectID={project.id}
                form={f("video-script")}
                referenceInput={referenceValue}
                systemPrompt={data.media_system_prompts?.video || ""}
                models={catalogs["video-script"] || []}
                modelID={selectedModel("video-script")}
                jobs={jobs}
                duration={targetDuration}
                inputKey={JSON.stringify([
                  w?.title,
                  w?.copy,
                  w?.account_profile?.key,
                  data.media_system_prompts?.video,
                  targetDuration,
                  selectedModel("video-script"),
                ])}
                disabled={busy || active("video_generate")}
                onEdit={(patch) => edit("video-script", patch)}
                run={action}
              />
            ) : undefined
          }
          busy={busy}
          selected={chosen}
          onEdit={(patch) => {
            edit(step, patch);
            if (step === "image" && original && patch.reference_asset_ids) {
              edit("source", {
                ...originalInput,
                asset_ids: [
                  ...originalInput.asset_ids.filter(
                    (id) =>
                      allAssets.find((asset) => asset.id === id)?.kind !==
                      "image",
                  ),
                  ...patch.reference_asset_ids,
                ],
              });
            }
          }}
          onUploaded={(asset) => {
            setUploadedAssets((old) => [...old, asset]);
            void refresh().catch((e) => setError(e.message));
          }}
          onSelection={(ids) =>
            edit(step, {
              selected_asset_ids: ids,
              cover_id:
                step === "image"
                  ? ids[0] || ""
                  : project.cover_id ||
                    sourceAssets.find((asset) => asset.kind === "image")?.id ||
                    "",
            })
          }
          run={action}
          onConfirm={() => void action(() => saveStage(step, false))}
          onPublish={() => void action(() => saveStage(step, true))}
        />
      )}
      {visible && !!publicationConfirmation.length && (
        <PublicationConfirmation
          prepared
          publications={publicationConfirmation}
          assets={allAssets}
          onClose={() => {
            setPublicationConfirmation([]);
          }}
          onConfirmed={async () => {
            await refresh();
            setPublicationConfirmation([]);
            message.success("已设为等待发布");
          }}
        />
      )}
    </section>
  );
}
