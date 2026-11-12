import ResizableWorkspace from "./rewrites/ResizableWorkspace";
import { usePinnedProjects } from "./rewrites/projectPreferences";
import PublicationMedia from "./components/PublicationMedia";
import { publicationSelection } from "./publicationSelection";
import GenerateButton from "./components/GenerateButton";
import {
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  FileImageOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  SendOutlined,
  SwapOutlined,
  UploadOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Empty,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Tabs,
  Tag,
  Upload,
} from "antd";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import AngleSuggestions from "./AngleSuggestions";
import CoverPicker from "./CoverPicker";
import ImageGeneration from "./ImageGeneration";
import MediaLibrary from "./MediaLibrary";
import RewriteModels from "./RewriteModels";
import VersionMedia from "./VersionMedia";
import VideoDirector from "./VideoDirector";
import type { Asset, Content, Job, Platform, Project, Version } from "./api";
import { api, date, fileURL, patch, post } from "./api";
import { inMediaLibrary } from "./assetLibrary";
import { readCreative, useCreativeSettings } from "./creative";
import { DraftSync, preferredDraft } from "./draftSync";
import { useModelCatalog } from "./hooks/useModelCatalog";
import {
  restoreGeneratedText,
  rewriteCompletionAction,
  rewriteDraftFingerprint,
} from "./rewriteCompletion";
import type { RewriteKind } from "./rewriteFormats";
import {
  clearFormatDraft,
  draftKey,
  readFormatDraft,
  versionsForKind,
} from "./rewriteFormats";
import { hookOptions } from "./rewriteHooks";
import CopyEditor from "./rewrites/CopyEditor";
import ProjectRail from "./rewrites/ProjectRail";
import ReferencePanel from "./rewrites/ReferencePanel";
import VersionComparison from "./rewrites/VersionComparison";
import { versionLabel } from "./rewrites/versionLabels";
const blank: Content = { title: "", body: "", topics: [] };
export default function Rewrites({
  projects,
  assets,
  jobs,
  selectedID,
  onSelect,
  onCreate,
  refresh,
  onPublish,
  openMedia,
}: {
  projects: Project[];
  assets: Asset[];
  jobs: Job[];
  selectedID: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  refresh: () => Promise<void>;
  onPublish: () => void;
  openMedia: () => void;
}) {
  const { message, modal } = App.useApp();
  const { pinned, togglePin } = usePinnedProjects();
  const [trash, setTrash] = useState(false);
  const [editorTab, setEditorTab] = useState("copy");
  const [projectStats, setProjectStats] = useState<
    Record<string, { count: number; confirmed: boolean }>
  >({});
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || !projects.length) return;
    initialized.current = true;
    if (!selectedID) {
      const first = projects.find((p) => !p.deleted_at);
      if (first) onSelect(first.id);
    }
  }, [projects, selectedID]);
  const [checked, setChecked] = useState<string[]>([]);
  const [projectActionBusy, setProjectActionBusy] = useState(false);
  const [project, setProject] = useState<Project>();
  const platform: Platform =
    (project?.id === selectedID
      ? project.platform
      : projects.find((p) => p.id === selectedID)?.platform) === "douyin"
      ? "douyin"
      : "xhs";
  const [publishPlatform, setPublishPlatform] = useState<Platform | "both">(
    "xhs",
  );
  const [publicationBusy, setPublicationBusy] = useState(false);
  const creatingPublication = useRef(false);
  const publicationRequest = useRef({ key: "", id: "" });
  const [platformFilter, setPlatformFilter] = useState<Platform | "">("");
  useEffect(() => setPlatformFilter(""), [selectedID]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [versionID, setVersionID] = useState("");
  const [saveDialog, setSaveDialog] = useState(false);
  const [renameOnly, setRenameOnly] = useState(false);
  const [draftStatus, setDraftStatus] = useState<Record<string, string>>({});
  const hydratedProject = useRef("");
  const draftSync = useRef<DraftSync | null>(null);
  if (!draftSync.current)
    draftSync.current = new DraftSync(
      (key, body) =>
        post(
          "/rewrites/" + key.split("/")[0] + "/drafts/" + key.split("/")[1],
          body,
        ),
      (key, text) => setDraftStatus((old) => ({ ...old, [key]: text })),
    );
  const [saveName, setSaveName] = useState("");
  const [content, setContent] = useState<Content>(blank);
  const [sourceIDs, setSourceIDs] = useState<string[]>([]);
  const [referenceVideos, setReferenceVideos] = useState<Asset[]>([]);
  const [referenceAssets, setReferenceAssets] = useState<Asset[]>([]);
  const [referenceIDs, setReferenceIDs] = useState<string[]>([]);
  const [videoReferenceIDs, setVideoReferenceIDs] = useState<string[]>([]);
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("自然分享");
  const [hook, setHook] = useState("auto");
  const [creative, setCreative] = useCreativeSettings(selectedID);
  const [length, setLength] = useState("300–500 字");
  const [requirements, setRequirements] = useState("");
  const [busy, setBusy] = useState(false);
  const versionMutation = useRef(false);
  // A return to the same project is a new editor visit, not the old request's owner.
  const editorVisit = useRef({ projectID: selectedID, epoch: 0 });
  if (editorVisit.current.projectID !== selectedID) {
    editorVisit.current = {
      projectID: selectedID,
      epoch: editorVisit.current.epoch + 1,
    };
  }
  useEffect(
    () => () => {
      editorVisit.current.epoch++;
    },
    [],
  );
  const currentRequirements = useRef(requirements);
  currentRequirements.current = requirements;
  const [picker, setPicker] = useState(false);
  const [pickerIDs, setPickerIDs] = useState<string[]>([]);
  const [mediaQuery, setMediaQuery] = useState("");
  const [mediaCategory, setMediaCategory] = useState("");
  const [kind, setKind] = useState("image");
  const workspaceKind: RewriteKind = kind === "video" ? "video" : "image";
  const selectedReferenceIDs =
    workspaceKind === "video" ? videoReferenceIDs : referenceIDs;
  const setSelectedReferenceIDs =
    workspaceKind === "video" ? setVideoReferenceIDs : setReferenceIDs;
  const [chosen, setChosen] = useState<string[]>([]);
  const publicationMaterialCount = publicationSelection(assets, chosen, kind)
    .ids.length;
  const [cover, setCover] = useState("");
  const editorDraft = useRef({ content, versionID, sourceIDs, creative });
  editorDraft.current = { content, versionID, sourceIDs, creative };
  const completionEditor = useRef({
    projectID: selectedID,
    ...editorDraft.current,
    media: { kind, asset_ids: chosen, cover_id: cover },
  });
  completionEditor.current = {
    projectID: selectedID,
    ...editorDraft.current,
    media: { kind, asset_ids: chosen, cover_id: cover },
  };
  const generationBaselines = useRef(
    new Map<string, { jobID: string; fingerprint: string }>(),
  );
  const [readyGenerated, setReadyGenerated] = useState<Version>();
  const [mediaBusy, setMediaBusy] = useState(false);
  const mediaSaving = useRef(false);
  const [uploading, setUploading] = useState(false);
  const uploadInProgress = useRef(false);
  const selectedProject = useRef(selectedID);
  selectedProject.current = selectedID;
  const [compare, setCompare] = useState(false);
  const {
    models,
    selectedID: modelID,
    select: setModelID,
    error: modelsError,
    reload: loadModels,
  } = useModelCatalog("rewrite");
  const {
    models: imageModels,
    selectedID: imageModelID,
    select: setImageModelID,
    error: imageModelsError,
    reload: loadImageModels,
  } = useModelCatalog("image");
  const {
    models: videoModels,
    selectedID: videoModelID,
    select: setVideoModelID,
    error: videoModelsError,
    reload: loadVideoModels,
  } = useModelCatalog("video");
  const [modelSettings, setModelSettings] = useState(false);
  const [imageModelSettings, setImageModelSettings] = useState(false);
  const [videoModelSettings, setVideoModelSettings] = useState(false);
  const [generating, setGenerating] = useState(false);
  const generationPending = useRef(false);
  const modelDrawer = (
    <>
      <RewriteModels
        capability="video"
        open={videoModelSettings}
        onClose={() => setVideoModelSettings(false)}
        models={videoModels}
        onSaved={loadVideoModels}
      />
      <RewriteModels
        open={modelSettings}
        onClose={() => setModelSettings(false)}
        models={models}
        onSaved={loadModels}
      />
      <RewriteModels
        capability="image"
        open={imageModelSettings}
        onClose={() => setImageModelSettings(false)}
        models={imageModels}
        onSaved={loadImageModels}
      />
    </>
  );
  const [publishModal, setPublishModal] = useState(false);
  const lastGenerated = useRef(new Map<string, string>());
  const [query, setQuery] = useState("");
  const pinOrder = new Map(pinned.map((id, index) => [id, index]));
  const visibleProjects = projects
    .filter(
      (p) =>
        !!p.deleted_at === trash &&
        (!platformFilter || (p.platform || "xhs") === platformFilter) &&
        p.name.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => {
      const left = pinOrder.get(a.id) ?? Infinity,
        right = pinOrder.get(b.id) ?? Infinity;
      return left === right ? 0 : left - right;
    });
  const checkedIDs = checked.filter((id) =>
    visibleProjects.some((p) => p.id === id),
  );
  const changeTrash = async (ids: string[], deleted: boolean) => {
    setProjectActionBusy(true);
    try {
      await post("/rewrites/batch-trash", { ids, deleted });
      if (deleted && ids.includes(selectedProject.current)) {
        selectedProject.current = "";
        setProject(undefined);
        onSelect("");
      }
      await refresh();
      if (!deleted && ids.includes(selectedProject.current)) await load(true);
      setChecked([]);
      message.success(deleted ? "项目已移入回收站" : "项目已恢复");
    } catch (e) {
      message.error((e as Error).message);
      throw e;
    } finally {
      setProjectActionBusy(false);
    }
  };
  const removeProjects = (ids: string[]) => {
    const names = projects.filter((p) => ids.includes(p.id)).map((p) => p.name);
    modal.confirm({
      title: `删除 ${ids.length} 个创作项目？`,
      content: (
        <>
          <p>
            {names.slice(0, 3).join("、")}
            {names.length > 3 ? "等" : ""}
          </p>
          <p>
            项目将移入回收站，可恢复。文案版本、素材及已建立的发布稿都会保留；本机暂存的未保存文稿也会保留。历史项目若同时包含图片和视频，此操作作用于整个项目。
          </p>
        </>
      ),
      okText: "移入回收站",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => changeTrash(ids, true),
    });
  };
  const restoreProjects = (ids: string[]) => {
    void changeTrash(ids, false).catch(() => {});
  };
  const purgeProjects = (ids: string[]) => {
    const names = projects.filter((p) => ids.includes(p.id)).map((p) => p.name);
    modal.confirm({
      title: `彻底删除 ${ids.length} 个创作项目？`,
      content: (
        <>
          <p>
            {names.slice(0, 3).join("、")}
            {names.length > 3 ? "等" : ""}
          </p>
          <p>
            此操作不可恢复，将删除整个项目、图片和视频的全部版本、生成记录及当前浏览器中的暂存文稿。
          </p>
          <p>已建立的发布稿和发布包独立保留，采集原文与本地素材也会保留。</p>
        </>
      ),
      okText: "彻底删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        setProjectActionBusy(true);
        try {
          await post("/rewrites/batch-purge", { ids, confirm: true });
          for (const id of ids) {
            try {
              localStorage.removeItem("gin.draft." + id);
              localStorage.removeItem(draftKey(id, "image"));
              localStorage.removeItem(draftKey(id, "video"));
              localStorage.removeItem("gin.video-director." + id);
            } catch {}
          }
          if (ids.includes(selectedProject.current)) {
            selectedProject.current = "";
            setProject(undefined);
            onSelect("");
          }
          setChecked([]);
          await refresh();
          message.success("项目已彻底删除，无法恢复");
        } catch (e) {
          message.error((e as Error).message);
          throw e;
        } finally {
          setProjectActionBusy(false);
        }
      },
    });
  };
  const changeContent = (next: Content) => {
    setContent(next);
    try {
      localStorage.setItem(
        draftKey(selectedID, workspaceKind),
        JSON.stringify({
          content: next,
          versionID,
          sourceIDs,
          media: { kind, asset_ids: chosen, cover_id: cover },
        }),
      );
    } catch {}
  };
  const applyVersion = (v: Version, fallbackKind = workspaceKind) => {
    setCreative(v.creative || {});
    setVersionID(v.id);
    setContent({ title: v.title, body: v.body, topics: v.topics || [] });
    setSourceIDs(v.source_ids || []);
    setKind(v.media?.kind || fallbackKind);
    setChosen(v.media?.asset_ids || []);
    setCover(v.media?.cover_id || "");
  };
  const load = async (reset = false) => {
    if (!selectedID) return;
    const visit = editorVisit.current.epoch;
    try {
      const d = await api<{
        project: Project;
        versions: Version[];
        reference_assets: Asset[];
        reference_videos: Asset[];
      }>("/rewrites/" + selectedID);
      if (
        selectedProject.current !== selectedID ||
        editorVisit.current.epoch !== visit
      )
        return;
      const targetKind: RewriteKind = reset
        ? d.project.kind === "video"
          ? "video"
          : "image"
        : workspaceKind;
      const selection = d.project.media_selections?.[targetKind] || {
        asset_ids: [],
        cover_id: "",
      };
      const sameFormat = versionsForKind(
        d.versions,
        targetKind,
        d.project.kind,
      );
      setProject(d.project);
      setReferenceAssets(d.reference_assets || []);
      setReferenceVideos(d.reference_videos || []);
      setVersions(d.versions);
      setProjectStats((old) => ({
        ...old,
        [d.project.id]: {
          count: d.versions.filter((v) => !v.generated).length,
          confirmed: d.versions.some((v) => v.status === "confirmed"),
        },
      }));
      if (reset) {
        const cachedCreative = readCreative(selectedID);
        setReferenceIDs([]);
        setVideoReferenceIDs([]);
        setSourceIDs(d.project.sources.map((x) => x.id));
        setKind(targetKind);
        setChosen(selection.asset_ids || []);
        setCover(selection.cover_id || "");
        setRequirements("");
        const initial =
          sameFormat.find(
            (v) => v.id === d.project.selected_versions?.[targetKind],
          ) ||
          sameFormat.find((v) => !v.generated) ||
          sameFormat[0];
        if (initial) applyVersion(initial, targetKind);
        else {
          setVersionID("");
          setContent(blank);
        }
        try {
          let saved = preferredDraft(
            readFormatDraft(selectedID, targetKind, d.project.kind),
            d.project.drafts?.[targetKind],
          );
          if (saved) {
            saved = { ...saved, ...restoreGeneratedText(saved, sameFormat[0]) };
            localStorage.setItem(
              draftKey(selectedID, targetKind),
              JSON.stringify(saved),
            );
            setContent(saved.content);
            setCreative(saved.creative || {});
            setAudience(saved.audience || "");
            setTone(saved.tone || "自然分享");
            setLength(saved.length || "300–500 字");
            setRequirements(saved.requirements || "");
            if (saved.modelID) setModelID(saved.modelID);
            if (saved.hook) setHook(saved.hook);
            setVersionID(saved.versionID);
            setSourceIDs(saved.sourceIDs);
            setKind(targetKind);
            setChosen(saved.media?.asset_ids || selection.asset_ids || []);
            setCover(
              saved.media ? saved.media.cover_id : selection.cover_id || "",
            );
          }
        } catch {}
        if (cachedCreative && !d.project.drafts?.[targetKind])
          setCreative(cachedCreative);
        for (const format of ["image", "video"])
          draftSync.current!.seed(
            selectedID + "/" + format,
            d.project.drafts?.[format]?.revision || 0,
          );
        hydratedProject.current = selectedID;
      }
      return d;
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  useEffect(() => {
    hydratedProject.current = "";
    setEditorTab("copy");
    setSaveDialog(false);
    setPublishModal(false);
    setProject(undefined);
    setVersions([]);
    setContent(blank);
    setPicker(false);
    setPickerIDs([]);
    setReferenceAssets([]);
    setReferenceIDs([]);
    setReferenceVideos([]);
    setVideoReferenceIDs([]);
    setReadyGenerated(undefined);
    if (selectedID) {
      load(true);
    } else {
      setProject(undefined);
    }
  }, [selectedID]);
  const completed = jobs
    .filter(
      (j) =>
        j.kind === "rewrite" &&
        j.target === selectedID &&
        j.state === "succeeded",
    )
    .map((j) => j.result)
    .join(",");
  useEffect(() => {
    if (!completed || !selectedID || project?.id !== selectedID) return;
    const key = draftKey(selectedID, workspaceKind);
    let cancelled = false;
    load().then((d) => {
      if (
        cancelled ||
        !d ||
        completionEditor.current.projectID !== selectedID ||
        completionEditor.current.media.kind !== workspaceKind
      )
        return;
      const v = completed
        .split(",")
        .map((id) => d.versions.find((v) => v.id === id))
        .find(
          (v) =>
            v && (v.media?.kind || d.project.kind || "image") === workspaceKind,
        );
      if (!v || lastGenerated.current.get(key) === v.id) return;
      const pending = generationBaselines.current.get(key);
      if (
        pending &&
        !jobs.some((j) => j.id === pending.jobID && j.result === v.id)
      )
        return;
      const snapshot = completionEditor.current;
      const local = readFormatDraft(selectedID, workspaceKind, d.project.kind);
      const action = rewriteCompletionAction(
        snapshot,
        !!local,
        pending?.fingerprint,
      );
      if (action === "apply") {
        applyVersion(v);
        clearFormatDraft(selectedID, workspaceKind, d.project.kind);
        setReadyGenerated(undefined);
      } else if (action === "restore-text") {
        const restored = restoreGeneratedText(snapshot, v);
        setContent(restored.content);
        setVersionID(restored.versionID);
        setSourceIDs(restored.sourceIDs);
        localStorage.setItem(key, JSON.stringify(restored));
        setReadyGenerated(undefined);
      } else if (snapshot.versionID !== v.id) {
        setReadyGenerated(v);
      }
      lastGenerated.current.set(key, v.id);
      if (pending) generationBaselines.current.delete(key);
    });
    return () => {
      cancelled = true;
    };
  }, [completed, selectedID, workspaceKind, project?.id]);
  const draftSnapshot = JSON.stringify({
    ...editorDraft.current,
    media: { kind, asset_ids: chosen, cover_id: cover },
    audience,
    tone,
    length,
    requirements,
    modelID,
    hook,
  });
  useEffect(() => {
    if (
      !selectedID ||
      project?.id !== selectedID ||
      hydratedProject.current !== selectedID
    )
      return;
    const payload = {
      ...JSON.parse(draftSnapshot),
      edited_at: new Date().toISOString(),
    };
    try {
      localStorage.setItem(draftKey(selectedID, kind), JSON.stringify(payload));
    } catch {}
    draftSync.current!.enqueue(selectedID + "/" + kind, payload);
  }, [draftSnapshot, selectedID, project?.id]);
  useEffect(() => {
    const flush = () => draftSync.current?.flushAll();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
  const current = versions.find((v) => v.id === versionID);
  const formalVersions = versions.filter((v) => !v.generated);
  const generatedVersions = versions.filter((v) => v.generated);
  const selectedVersion = versions.find(
    (v) => v.id === project?.selected_versions?.[workspaceKind],
  );
  const dirty =
    !!current?.generated ||
    JSON.stringify(creative) !== JSON.stringify(current?.creative || {}) ||
    !current ||
    !current.media ||
    (!!current.media &&
      (kind !== current.media.kind ||
        cover !== current.media.cover_id ||
        JSON.stringify(chosen) !== JSON.stringify(current.media.asset_ids))) ||
    JSON.stringify(content) !==
      JSON.stringify({
        title: current.title,
        body: current.body,
        topics: current.topics || [],
      });
  const active = jobs.some(
    (j) =>
      j.kind === "rewrite" &&
      j.target === selectedID &&
      ["running", "queued"].includes(j.state),
  );
  const lastJob = jobs.find(
    (j) => j.kind === "rewrite" && j.target === selectedID,
  );
  const save = async (name = "") => {
    if (
      mediaSaving.current ||
      uploadInProgress.current ||
      versionMutation.current ||
      selectedProject.current !== selectedID
    )
      return;
    versionMutation.current = true;
    const visit = editorVisit.current.epoch;
    const submitted = rewriteDraftFingerprint(completionEditor.current);
    setBusy(true);
    try {
      const v = await post<Version>("/rewrites/" + selectedID + "/versions", {
        ...content,
        name: name.trim(),
        creative,
        parent_id: versionID || undefined,
        source_ids: sourceIDs,
        instructions: requirements,
        media: { kind, asset_ids: chosen, cover_id: cover },
      });
      if (
        editorVisit.current.epoch !== visit ||
        selectedProject.current !== selectedID
      )
        return v;
      await load();
      if (
        editorVisit.current.epoch !== visit ||
        selectedProject.current !== selectedID
      )
        return v;
      if (
        submitted === rewriteDraftFingerprint(completionEditor.current) &&
        currentRequirements.current === requirements
      ) {
        applyVersion(v);
        clearFormatDraft(selectedID, workspaceKind, project?.kind || "image");
        message.success(
          v.reused
            ? `内容未变化，沿用 V${v.number}`
            : `已保存完整版本 V${v.number}（文案与素材）`,
        );
      } else {
        message.success(
          `已保存 V${v.number}；保存期间的新修改已保留，请再次保存`,
        );
      }
      return v;
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      versionMutation.current = false;
      setBusy(false);
    }
  };
  const generate = async () => {
    if (mediaSaving.current || uploadInProgress.current) return;
    if (generationPending.current) return;
    generationPending.current = true;
    setGenerating(true);
    const key = draftKey(selectedID, workspaceKind);
    const baseline = {
      jobID: "",
      fingerprint: rewriteDraftFingerprint(completionEditor.current),
    };
    generationBaselines.current.set(key, baseline);
    try {
      const result = await post("/rewrites/" + selectedID + "/generate", {
        model_id: modelID,
        source_ids: sourceIDs,
        audience,
        tone,
        hook,
        creative,
        length,
        requirements,
        media: { kind, asset_ids: chosen, cover_id: cover },
      });
      baseline.jobID = result.job_id;
      setReadyGenerated(undefined);
      message.success(
        "已提交生成任务，完成后进入试写历史；选用后再保存完整版本",
      );
      await refresh();
    } catch (e) {
      generationBaselines.current.delete(key);
      message.error((e as Error).message);
    } finally {
      generationPending.current = false;
      setGenerating(false);
    }
  };
  const chooseVersion = (v: Version, confirm = false) => {
    const choose = async () => {
      if (
        mediaSaving.current ||
        uploadInProgress.current ||
        versionMutation.current ||
        selectedProject.current !== selectedID
      )
        return;
      versionMutation.current = true;
      const visit = editorVisit.current.epoch;
      const submitted = rewriteDraftFingerprint(completionEditor.current);
      const unchanged = () =>
        editorVisit.current.epoch === visit &&
        selectedProject.current === selectedID &&
        submitted === rewriteDraftFingerprint(completionEditor.current) &&
        currentRequirements.current === requirements;
      setBusy(true);
      try {
        let savedProject: Project | undefined;
        if (v.media) {
          savedProject = await patch<Project>(
            "/rewrites/" + selectedID,
            v.media,
          );
        }
        if (!unchanged()) return;
        if (confirm)
          await post(`/rewrites/${selectedID}/versions/${v.id}/confirm`);
        if (!unchanged()) {
          if (selectedProject.current === selectedID)
            message.info("操作期间产生了新修改，已保留当前编辑内容");
          return;
        }
        if (savedProject) setProject(savedProject);
        clearFormatDraft(selectedID, workspaceKind, project?.kind || "image");
        if (v.media?.kind && v.media.kind !== workspaceKind) {
          clearFormatDraft(selectedID, v.media.kind, project?.kind || "image");
        }
        applyVersion(v);
        setReadyGenerated(undefined);
        setCompare(false);
        await load();
        if (confirm) message.success(`已确认 V${v.number}`);
      } catch (e) {
        message.error((e as Error).message);
      } finally {
        versionMutation.current = false;
        setBusy(false);
      }
    };
    if (dirty && (content.title || content.body))
      modal.confirm({
        title: "切换版本会放弃当前未保存的修改",
        content:
          "切换后将使用所选版本保存的文案和素材。如需保留当前修改，请先取消并保存为新版本。",
        okText: "放弃修改并切换",
        onOk: choose,
      });
    else void choose();
  };
  const persistMedia = async (selection: {
    kind: string;
    asset_ids?: string[];
    cover_id?: string;
  }) => {
    if (mediaSaving.current) return false;
    if (selection.asset_ids)
      selection.asset_ids = [...new Set(selection.asset_ids)];
    if (
      selection.kind === kind &&
      JSON.stringify(selection.asset_ids ?? chosen) ===
        JSON.stringify(chosen) &&
      (selection.cover_id ?? cover) === cover
    )
      return true;
    mediaSaving.current = true;
    setMediaBusy(true);
    const targetID = selectedID;
    try {
      const saved = await patch<Project>("/rewrites/" + targetID, selection);
      if (selectedProject.current === targetID) {
        setProject(saved);
        setChosen(saved.asset_ids || []);
        setKind(saved.kind || "image");
        setCover(saved.cover_id || "");
        try {
          localStorage.setItem(
            draftKey(targetID, selection.kind),
            JSON.stringify({
              ...editorDraft.current,
              media: {
                kind: saved.kind || "image",
                asset_ids: saved.asset_ids || [],
                cover_id: saved.cover_id || "",
              },
            }),
          );
        } catch {}
      }
      await refresh();
    } catch (e) {
      message.error((e as Error).message);
      return false;
    } finally {
      mediaSaving.current = false;
      setMediaBusy(false);
    }
    return true;
  };
  const switchFormat = async (next: RewriteKind) => {
    if (
      next === kind ||
      mediaSaving.current ||
      uploadInProgress.current ||
      busy
    )
      return false;
    const targetID = selectedID;
    const storedDraft = preferredDraft(
      readFormatDraft(targetID, next, project?.kind),
      project?.drafts?.[next],
    );
    const incoming = storedDraft
      ? {
          ...storedDraft,
          ...restoreGeneratedText(
            storedDraft,
            versionsForKind(versions, next, project?.kind)[0],
          ),
        }
      : null;
    try {
      localStorage.setItem(
        draftKey(targetID, kind),
        JSON.stringify({
          ...JSON.parse(draftSnapshot),
          edited_at: new Date().toISOString(),
          media: { kind, asset_ids: chosen, cover_id: cover },
        }),
      );
    } catch {}
    mediaSaving.current = true;
    setMediaBusy(true);
    try {
      const saved = await patch<Project>("/rewrites/" + targetID, {
        kind: next,
        ...(incoming?.media
          ? {
              asset_ids: incoming.media.asset_ids,
              cover_id: incoming.media.cover_id || "",
            }
          : {}),
      });
      if (selectedProject.current !== targetID) return false;
      const draft = incoming || editorDraft.current;
      setProject(saved);
      setKind(next);
      setChosen(saved.asset_ids || []);
      setCover(saved.cover_id || "");
      setContent(draft.content);
      setVersionID(draft.versionID || "");
      setSourceIDs(draft.sourceIDs || []);
      if (incoming) {
        setCreative(incoming.creative || {});
        setAudience(incoming.audience || "");
        setTone(incoming.tone || "自然分享");
        setLength(incoming.length || "300–500 字");
        setRequirements(incoming.requirements || "");
        if (incoming.modelID) setModelID(incoming.modelID);
        if (incoming.hook) setHook(incoming.hook);
      }
      setPicker(false);
      setPickerIDs([]);
      try {
        localStorage.setItem(
          draftKey(targetID, next),
          JSON.stringify({
            ...draft,
            media: {
              kind: next,
              asset_ids: saved.asset_ids || [],
              cover_id: saved.cover_id || "",
            },
          }),
        );
      } catch {}
      await refresh();
      return true;
    } catch (e) {
      message.error((e as Error).message);
      return false;
    } finally {
      mediaSaving.current = false;
      setMediaBusy(false);
    }
  };
  const saveMedia = (ids: string[], k = kind, cov = cover) =>
    persistMedia({ asset_ids: ids, kind: k, cover_id: cov });
  const mediaDisabled =
    busy || mediaBusy || uploading || project?.id !== selectedID;
  const uploadBatch = async (files: File[]) => {
    if (uploadInProgress.current || mediaSaving.current) return;
    uploadInProgress.current = true;
    setUploading(true);
    const targetID = selectedID;
    const targetKind = kind;
    const added: string[] = [];
    const failures: string[] = [];
    try {
      for (const file of targetKind === "image" ? files : files.slice(0, 1)) {
        if (selectedProject.current !== targetID) break;
        try {
          if (file.size > 512 * 1024 * 1024) throw Error("文件超过 512 MB");
          const data = new FormData();
          data.append("file", file);
          const asset = await api<Asset>("/assets", {
            method: "POST",
            body: data,
          });
          if (asset.kind !== targetKind)
            throw Error("素材类型不匹配，文件已存入本地素材库");
          added.push(asset.id);
        } catch (e) {
          failures.push(`${file.name}：${(e as Error).message}`);
        }
      }
      if (selectedProject.current === targetID && added.length) {
        setPickerIDs((ids) =>
          targetKind === "image"
            ? [...new Set([...ids, ...added])]
            : added.slice(0, 1),
        );
        message.success(
          `已上传并勾选 ${added.length} ${targetKind === "image" ? "张图片" : "个视频"}，点击「完成选择」加入当前草稿`,
        );
      }
      if (failures.length)
        modal.error({
          title: `${failures.length} 个文件上传失败`,
          content: (
            <div>
              {failures.map((failure, i) => (
                <p key={i}>{failure}</p>
              ))}
            </div>
          ),
        });
      await refresh();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      uploadInProgress.current = false;
      setUploading(false);
    }
  };
  const workbench = (body: ReactNode) => (
    <ResizableWorkspace
      rail={
        <ProjectRail
          query={query}
          onQuery={setQuery}
          platformFilter={platformFilter}
          onPlatformFilter={setPlatformFilter}
          trash={trash}
          onToggleTrash={() => {
            setTrash(!trash);
            onSelect("");
          }}
          visibleProjects={visibleProjects}
          selectedID={selectedID}
          projectStats={projectStats}
          projectActionBusy={projectActionBusy}
          mediaDisabled={mediaDisabled}
          onSelect={onSelect}
          onCreate={onCreate}
          onRemove={(id) => removeProjects([id])}
          pinned={pinned}
          onTogglePin={togglePin}
        />
      }
    >
      <div className={"rewrite-main tab-" + editorTab}>
        {modelDrawer}
        {body}
      </div>
    </ResizableWorkspace>
  );
  if (!selectedID)
    return workbench(
      <>
        {modelsError && (
          <Alert
            type="warning"
            message={modelsError}
            action={<Button onClick={() => loadModels()}>重试</Button>}
          />
        )}
        {imageModelsError && (
          <Alert
            type="warning"
            message={imageModelsError}
            action={
              <Button onClick={() => loadImageModels()}>重试图片配置</Button>
            }
          />
        )}
        <div
          className="panel-toolbar standalone-toolbar"
          style={{ flexWrap: "wrap", gap: 12 }}
        >
          <Space>
            <Segmented
              value={trash ? "trash" : "active"}
              onChange={(value) => {
                setTrash(value === "trash");
                setChecked([]);
              }}
              options={[
                {
                  value: "active",
                  label: `创作项目（${projects.filter((p) => !p.deleted_at).length}）`,
                },
                {
                  value: "trash",
                  label: `回收站（${projects.filter((p) => p.deleted_at).length}）`,
                },
              ]}
            />
          </Space>
          <Space wrap>
            <Input.Search
              placeholder="搜索创作项目"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: 240 }}
            />
            <Button onClick={() => setModelSettings(true)}>文案模型配置</Button>
            <Button onClick={() => setImageModelSettings(true)}>
              图片模型配置
            </Button>
            <Button onClick={() => setVideoModelSettings(true)}>
              视频模型配置
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
              空白新建
            </Button>
          </Space>
        </div>
        <div className="panel-toolbar standalone-toolbar">
          <Space>
            <Checkbox
              checked={
                visibleProjects.length > 0 &&
                checkedIDs.length === visibleProjects.length
              }
              indeterminate={
                checkedIDs.length > 0 &&
                checkedIDs.length < visibleProjects.length
              }
              onChange={(e) =>
                setChecked(
                  e.target.checked ? visibleProjects.map((p) => p.id) : [],
                )
              }
            >
              选择当前结果
            </Checkbox>
            <span className="muted">已选 {checkedIDs.length} 个</span>
          </Space>
          {trash ? (
            <Space>
              <Button
                disabled={
                  !checkedIDs.length ||
                  checkedIDs.length > 500 ||
                  projectActionBusy
                }
                onClick={() => restoreProjects(checkedIDs)}
              >
                批量恢复
              </Button>
              <Button
                className="rewrite-delete-button"
                icon={<DeleteOutlined />}
                disabled={
                  !checkedIDs.length ||
                  checkedIDs.length > 500 ||
                  projectActionBusy
                }
                onClick={() => purgeProjects(checkedIDs)}
              >
                批量彻底删除
              </Button>
            </Space>
          ) : (
            <Button
              className="rewrite-delete-button"
              icon={<DeleteOutlined />}
              disabled={
                !checkedIDs.length ||
                checkedIDs.length > 500 ||
                projectActionBusy
              }
              onClick={() => removeProjects(checkedIDs)}
            >
              批量删除
            </Button>
          )}
        </div>
        {visibleProjects.length ? (
          <div className="project-grid">
            {visibleProjects.map((p) => (
              <article className="project-card" key={p.id}>
                <div className="row-between">
                  <Space>
                    <Checkbox
                      aria-label={`选择项目 ${p.name}`}
                      checked={checkedIDs.includes(p.id)}
                      onChange={(e) =>
                        setChecked(
                          e.target.checked
                            ? [...checkedIDs, p.id]
                            : checkedIDs.filter((id) => id !== p.id),
                        )
                      }
                    />
                    <span className="project-icon">
                      <EditOutlined />
                    </span>
                  </Space>
                  <Tag bordered={false}>
                    {p.note_id ? "来源仿写" : "自主创作"}
                  </Tag>
                </div>
                <h3>
                  <button
                    className="project-title-button"
                    onClick={() => onSelect(p.id)}
                  >
                    {p.name}
                  </button>
                </h3>
                <p>
                  {p.sources[0]?.text.slice(0, 90) ||
                    "从一个想法开始，搭配自己的图片或视频。"}
                </p>
                <div className="row-between">
                  <small>
                    {date(trash ? p.deleted_at || p.created_at : p.created_at)}
                  </small>
                  <Space size={0}>
                    {trash ? (
                      <>
                        <Button
                          type="link"
                          disabled={projectActionBusy}
                          onClick={() => restoreProjects([p.id])}
                        >
                          恢复
                        </Button>
                        <Button
                          type="text"
                          className="rewrite-delete-button"
                          disabled={projectActionBusy}
                          aria-label={`彻底删除项目 ${p.name}`}
                          onClick={() => purgeProjects([p.id])}
                        >
                          彻底删除
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button type="link" onClick={() => onSelect(p.id)}>
                          打开编辑器
                        </Button>
                        <Button
                          type="text"
                          className="rewrite-delete-button"
                          icon={<DeleteOutlined />}
                          aria-label={`删除项目 ${p.name}`}
                          disabled={projectActionBusy}
                          onClick={() => removeProjects([p.id])}
                        >
                          删除
                        </Button>
                      </>
                    )}
                  </Space>
                </div>
              </article>
            ))}
          </div>
        ) : trash || query ? (
          <Empty
            description={
              trash ? "回收站中没有符合条件的项目" : "没有找到符合条件的项目"
            }
          />
        ) : (
          <div className="empty-page">
            <div className="empty-art">
              <EditOutlined />
            </div>
            <h2>为你的下一篇内容，留一个位置</h2>
            <p>从采集库选择参考笔记，或直接创建一篇自己的内容。</p>
            <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
              开始创作
            </Button>
          </div>
        )}
      </>,
    );
  if (
    projects.find((p) => p.id === selectedID)?.deleted_at ||
    (project?.id === selectedID && project.deleted_at)
  ) {
    return workbench(
      <div className="empty-page">
        <h2>这个项目已移入回收站</h2>
        <p>文案版本、素材和发布稿均已保留，恢复后可继续编辑。</p>
        <Space>
          <Button onClick={() => onSelect("")}>返回项目列表</Button>
          <Button
            type="primary"
            loading={projectActionBusy}
            onClick={() => restoreProjects([selectedID])}
          >
            恢复项目
          </Button>
        </Space>
      </div>,
    );
  }
  return workbench(
    <>
      <div className="editor-toolbar">
        <div>
          <strong>{project?.name || "加载项目…"}</strong>
          <div className="muted">
            当前选用：
            {selectedVersion
              ? `V${selectedVersion.number}${selectedVersion.name ? " · " + selectedVersion.name : ""} · ${selectedVersion.media?.kind === "video" ? "视频" : "图文"} · ${selectedVersion.media?.asset_ids.length || 0} 个素材`
              : "尚未确认并选用完整版本"}
          </div>
          <small>
            {draftStatus[selectedID + "/" + kind] || "草稿自动保存到本机数据库"}
          </small>
          {draftStatus[selectedID + "/" + kind]?.startsWith("草稿未同步") && (
            <Button
              size="small"
              onClick={() => draftSync.current?.retry(selectedID + "/" + kind)}
            >
              重试保存草稿
            </Button>
          )}
        </div>
        <Space wrap>
          <Select
            aria-label="版本历史"
            placeholder="版本历史"
            disabled={mediaDisabled}
            value={current?.generated ? undefined : versionID || undefined}
            style={{ width: 210 }}
            options={formalVersions.map((v) => ({
              value: v.id,
              label: versionLabel(v),
            }))}
            onChange={(id) => {
              const v = versions.find((v) => v.id === id);
              if (v) chooseVersion(v);
            }}
          />
          <Select
            aria-label="文案试写历史"
            placeholder={`试写历史（${generatedVersions.length}）`}
            disabled={mediaDisabled || !generatedVersions.length}
            style={{ width: 220 }}
            value={current?.generated ? versionID : undefined}
            options={generatedVersions.map((v) => ({
              value: v.id,
              label: versionLabel(v) + " · " + date(v.created_at),
            }))}
            onChange={(id) => {
              const v = versions.find((v) => v.id === id);
              if (v) chooseVersion(v);
            }}
          />
          <Button
            disabled={mediaDisabled || !current || current.generated}
            onClick={() => {
              setRenameOnly(true);
              setSaveName(current?.name || "");
              setSaveDialog(true);
            }}
          >
            重命名版本
          </Button>
          <Button
            className="rewrite-delete-button"
            title="删除仿写项目"
            aria-label="删除仿写项目"
            icon={<DeleteOutlined />}
            disabled={mediaDisabled || active || projectActionBusy}
            onClick={() => removeProjects([selectedID])}
          />
          <Button
            aria-label="刷新仿写项目"
            icon={<ReloadOutlined />}
            disabled={mediaDisabled}
            onClick={() => void load()}
          />
        </Space>
      </div>
      <div className="rewrite-section-header">
        <h2 className="rewrite-section-title">我的仿写内容</h2>
        <Button
          icon={<SwapOutlined />}
          disabled={versions.length < 2}
          onClick={() => {
            setCompare(true);
          }}
        >
          完整版本对比
        </Button>
      </div>
      <Tabs
        className="creation-tabs"
        activeKey={editorTab}
        onChange={async (value) => {
          if (value === "image" || value === "video") {
            if (value !== workspaceKind && !(await switchFormat(value))) return;
          }
          if (selectedProject.current === selectedID) setEditorTab(value);
        }}
        items={[
          { key: "copy", label: "文案编辑" },
          { key: "image", label: "图片仿写", disabled: mediaDisabled },
          { key: "video", label: "视频仿写", disabled: mediaDisabled },
          { key: "assets", label: "素材库" },
          { key: "publish", label: `发布素材 (${publicationMaterialCount})` },
        ]}
      />
      <div
        className="editor-grid"
        hidden={editorTab === "assets" || editorTab === "publish"}
      >
        <ReferencePanel
          project={project}
          workspaceKind={workspaceKind}
          referenceAssets={referenceAssets}
          referenceVideos={referenceVideos}
          selectedReferenceIDs={selectedReferenceIDs}
          setSelectedReferenceIDs={setSelectedReferenceIDs}
          videoReferenceIDs={videoReferenceIDs}
          setVideoReferenceIDs={setVideoReferenceIDs}
          sourceIDs={sourceIDs}
          setSourceIDs={setSourceIDs}
          refreshing={busy || generating}
          onRefreshSources={async () => {
            const id = selectedID;
            setBusy(true);
            try {
              const updated = await post<Project>(
                `/rewrites/${id}/refresh-sources`,
              );
              if (selectedProject.current !== id) return;
              setProject(updated);
              setSourceIDs(updated.sources.map((s) => s.id));
              await refresh();
              message.success(
                "参考文字已更新并勾选，请按需取消；当前文稿与历史版本保留",
              );
            } catch (e) {
              message.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
        <section className="writing-panel" hidden={editorTab !== "copy"}>
          <div className="section-heading">
            <span className="section-index">02</span>
            <strong>文案编辑</strong>
            <Tag
              bordered={false}
              color={
                current?.status === "confirmed" && !dirty ? "green" : "default"
              }
            >
              {current?.status === "confirmed" && !dirty
                ? "已确认版本"
                : dirty
                  ? "编辑中"
                  : "已保存草稿"}
            </Tag>
          </div>
          <details className="generation-panel" open>
            <summary>
              <strong>AI 创作设置</strong>
              <span>主题或文案 → 可选话题建议 → 生成文案</span>
            </summary>
            <div className="settings-form" style={{ marginBottom: 20 }}>
              <label>
                创作主题 · 这次想写什么
                <Input.TextArea
                  aria-label="创作主题"
                  rows={2}
                  maxLength={1000}
                  showCount
                  value={creative.topic || ""}
                  onChange={(e) =>
                    setCreative({ ...creative, topic: e.target.value })
                  }
                  placeholder="例如：小桌面怎么放下每天要用的东西"
                />
              </label>
              <small className="muted">
                可以先写主题，也可以根据下方已有文案获取话题建议；两者都有时结合分析。参考帖子按需勾选。
              </small>
              <label>
                发帖角度（可选）
                <Input.TextArea
                  aria-label="发帖角度"
                  rows={2}
                  maxLength={1000}
                  showCount
                  value={creative.angle || ""}
                  onChange={(e) =>
                    setCreative({ ...creative, angle: e.target.value })
                  }
                  placeholder="例如：买了收纳盒，桌面为什么反而更乱了？可手动填写或选用 AI 建议"
                />
              </label>
              <small className="muted">
                图片和视频默认沿用此角度，也可以在各自规划中单独填写。
              </small>
              <AngleSuggestions
                key={selectedID}
                projectID={selectedID}
                modelID={modelID}
                configured={!!models.find((m) => m.id === modelID)?.configured}
                sourceIDs={sourceIDs}
                text={[
                  content.title,
                  content.body,
                  (content.topics || []).join(" "),
                ]
                  .filter((v) => v.trim())
                  .join("\n\n")}
                hasReferenceContent={
                  !!project?.sources.some(
                    (s) => sourceIDs.includes(s.id) && s.text.trim(),
                  )
                }
                audience={audience}
                requirements={requirements}
                creative={creative}
                jobs={jobs}
                refresh={refresh}
                onChoose={(angle) => setCreative({ ...creative, angle })}
              />
            </div>

            <div className="generation-options">
              <div
                className="row-between"
                style={{ gap: 12, flexWrap: "wrap" }}
              >
                <label style={{ flex: 1 }}>
                  本次文案模型
                  <Select
                    aria-label="本次文案模型"
                    style={{ width: "100%", minWidth: 220 }}
                    value={modelID || undefined}
                    onChange={setModelID}
                    options={models.map((m) => ({
                      value: m.id,
                      label: `${m.name} · ${m.model}${m.configured ? "" : "（待配置）"}`,
                    }))}
                  />
                </label>
                {workspaceKind === "video" && (
                  <label style={{ flex: 1 }}>
                    本次视频模型
                    <Select
                      aria-label="本次视频模型"
                      style={{ width: "100%", minWidth: 220 }}
                      placeholder="请先在仿写库列表配置视频模型"
                      value={videoModelID || undefined}
                      onChange={setVideoModelID}
                      options={videoModels.map((m) => ({
                        value: m.id,
                        label: `${m.name} · ${m.model}${m.configured ? "" : "（待配置）"}`,
                      }))}
                    />
                  </label>
                )}
              </div>
              <small className="muted">
                {workspaceKind === "image"
                  ? "文案和图片分别选择模型；在「图片仿写」中规划画面并生成图片。"
                  : "文案和视频分别选择模型；在「视频仿写」中制作连续视频，也可在「发布素材」选择自己的视频。"}
              </small>
              {workspaceKind === "image" && imageModelsError && (
                <Alert
                  type="warning"
                  message={imageModelsError}
                  action={
                    <Button onClick={() => loadImageModels()}>
                      重试图片配置
                    </Button>
                  }
                />
              )}
              {modelsError && (
                <Alert
                  type="warning"
                  message={modelsError}
                  action={<Button onClick={() => loadModels()}>重试</Button>}
                />
              )}
              {workspaceKind === "video" && videoModelsError && (
                <Alert
                  type="warning"
                  message={videoModelsError}
                  action={
                    <Button onClick={() => loadVideoModels()}>
                      重试视频配置
                    </Button>
                  }
                />
              )}
              {workspaceKind === "video" &&
                !videoModels.find((m) => m.id === videoModelID)?.configured &&
                !videoModelsError && (
                  <Alert
                    type="info"
                    message="视频模型待配置，请在仿写库列表添加。仍可编辑文案、上传视频和保存完整版本。"
                  />
                )}
              {!models.find((m) => m.id === modelID)?.configured && (
                <Alert
                  type="info"
                  message="文案模型待配置，请在仿写库列表的「文案模型配置」中添加密钥，也可以继续手动编辑。"
                />
              )}
              <div className="option-grid">
                <label>
                  文案钩子
                  <Select
                    aria-label="文案钩子"
                    value={hook}
                    onChange={setHook}
                    options={hookOptions}
                  />
                  <small className="muted">
                    {
                      hookOptions.find((option) => option.value === hook)
                        ?.description
                    }
                  </small>
                </label>
                <label>
                  目标读者
                  <Input
                    placeholder="例如：喜欢家居整理的上班族"
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                  />
                </label>
                <label>
                  语气
                  <Select
                    value={tone}
                    onChange={setTone}
                    options={[
                      "自然分享",
                      "简洁实用",
                      "温柔细腻",
                      "专业客观",
                      "轻松有趣",
                    ].map((v) => ({ value: v, label: v }))}
                  />
                </label>
                <label>
                  篇幅
                  <Input
                    aria-label="篇幅"
                    value={length}
                    onChange={(e) => setLength(e.target.value)}
                    placeholder="例如：200字、800～1000字、简短一些"
                  />
                </label>
              </div>
              <Input.TextArea
                rows={2}
                placeholder="补充要求：想表达的重点、自己的体验或需要保留的信息…"
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
              />
              <div className="row-between">
                <span className="muted">
                  每次生成保留试写记录；选好文案与素材后保存完整版本
                </span>
                <GenerateButton
                  type="primary"
                  loading={active || generating}
                  disabled={
                    mediaDisabled ||
                    active ||
                    generating ||
                    !models.find((m) => m.id === modelID)?.configured
                  }
                  onClick={generate}
                >
                  {versions.length
                    ? "生成试写文案"
                    : workspaceKind === "video"
                      ? "生成视频文案"
                      : "生成图文文案"}
                </GenerateButton>
              </div>
              {lastJob &&
                ["blocked", "failed", "needs_review"].includes(
                  lastJob.state,
                ) && <Alert type="warning" message={lastJob.error} showIcon />}
              {readyGenerated?.project_id === selectedID &&
                (readyGenerated.media?.kind || project?.kind) ===
                  workspaceKind && (
                  <Alert
                    type="info"
                    message={`新的试写文案已生成，已保留你在等待时修改的内容。`}
                    action={
                      <Button onClick={() => chooseVersion(readyGenerated)}>
                        查看生成版本
                      </Button>
                    }
                  />
                )}
            </div>
          </details>
          <CopyEditor
            content={content}
            onChange={changeContent}
            disabled={project?.id !== selectedID}
          >
            <div className="editor-savebar">
              <small className="muted">
                {dirty
                  ? "文案或素材有修改，请一起保存为完整版本。"
                  : "当前文案、素材及顺序已保存为同一版本。"}
              </small>
              <Space>
                <Button
                  icon={<SaveOutlined />}
                  loading={busy}
                  disabled={
                    mediaDisabled ||
                    !content.title.trim() ||
                    !content.body.trim()
                  }
                  onClick={() => {
                    setRenameOnly(false);
                    setSaveName("");
                    setSaveDialog(true);
                  }}
                >
                  保存完整版本
                </Button>
                <Button
                  icon={<CheckOutlined />}
                  disabled={
                    mediaDisabled ||
                    !current ||
                    dirty ||
                    (current.status === "confirmed" &&
                      project?.selected_versions?.[workspaceKind] ===
                        current.id)
                  }
                  onClick={async () => {
                    try {
                      await post(
                        "/rewrites/" +
                          selectedID +
                          "/versions/" +
                          versionID +
                          "/confirm",
                      );
                      await load();
                      message.success("版本已确认");
                    } catch (e) {
                      message.error((e as Error).message);
                    }
                  }}
                >
                  确认并选用完整版本
                </Button>
              </Space>
            </div>
          </CopyEditor>
        </section>
      </div>
      <div
        className="creation-surface"
        hidden={editorTab !== "image" && editorTab !== "video"}
      >
        {workspaceKind === "image" && (
          <ImageGeneration
            creative={creative}
            onCreativeChange={setCreative}
            embedded
            key={selectedID}
            projectID={selectedID}
            planningModels={models}
            defaultPlanningModelID={modelID}
            models={imageModels}
            modelID={imageModelID}
            onModelChange={setImageModelID}
            error={imageModelsError}
            onReload={loadImageModels}
            jobs={jobs}
            assets={assets}
            selected={chosen}
            disabled={mediaDisabled}
            canAdd={kind === "image"}
            onRemove={async (id) => {
              await saveMedia(
                chosen.filter((x) => x !== id),
                kind,
                cover === id ? "" : cover,
              );
            }}
            onAdd={async (id) => {
              await saveMedia([...new Set([...chosen, id])]);
            }}
            onAddMany={async (ids) => {
              await saveMedia([
                ...chosen,
                ...ids.filter((id) => !chosen.includes(id)),
              ]);
            }}
            refresh={refresh}
            references={referenceIDs
              .map(
                (id) =>
                  assets.find((a) => a.id === id) ||
                  referenceAssets.find((a) => a.id === id),
              )
              .filter((a): a is Asset => !!a)}
            onReferenceChange={setReferenceIDs}
            onRemoveReference={(id) =>
              setReferenceIDs((ids) => ids.filter((v) => v !== id))
            }
            text={[
              content.title,
              content.body,
              (content.topics || []).join(" "),
            ]
              .filter(Boolean)
              .join("\n")}
          />
        )}
        {workspaceKind === "video" && (
          <VideoDirector
            creative={creative}
            onCreativeChange={setCreative}
            embedded
            key={selectedID}
            projectID={selectedID}
            text={[
              content.title,
              content.body,
              (content.topics || []).join(" "),
            ]
              .filter(Boolean)
              .join("\n")}
            assets={assets}
            models={models}
            videoModels={videoModels}
            defaultPlanningModelID={modelID}
            videoModelID={videoModelID}
            onVideoModelChange={setVideoModelID}
            referenceIDs={videoReferenceIDs}
            onReferenceChange={setVideoReferenceIDs}
            jobs={jobs}
            refresh={refresh}
            disabled={mediaDisabled}
            selected={chosen}
            onSettings={() => setVideoModelSettings(true)}
            onRemove={async (id) => {
              if (!(await saveMedia(chosen.filter((x) => x !== id))))
                throw Error("取消发布素材失败，请重试");
            }}
            onAdd={async (id, coverID) => {
              await refresh();
              if (!(await saveMedia([id], "video", coverID || cover)))
                throw Error("成片素材未选入，请检查提示后重试");
            }}
          />
        )}
      </div>
      {editorTab === "assets" && (
        <MediaLibrary
          embedded
          open
          onClose={() => setEditorTab("copy")}
          assets={assets}
          refresh={refresh}
          onAdd={async (asset) => {
            if (mediaDisabled) return;
            if (asset.kind !== kind) {
              message.info(
                `请先切换到${asset.kind === "video" ? "视频" : "图文"}创作`,
              );
              return;
            }
            if (
              await saveMedia(
                kind === "video"
                  ? [asset.id]
                  : [...new Set([...chosen, asset.id])],
              )
            )
              message.success("已加入发布素材");
          }}
        />
      )}
      <section className="material-section" hidden={editorTab !== "publish"}>
        <div className="section-heading">
          <span className="section-index">03</span>
          <strong>当前版本素材</strong>
          <Button type="link" onClick={openMedia}>
            管理本地素材
          </Button>

          <Segmented
            aria-label="创作素材类型"
            value={kind}
            disabled={mediaDisabled}
            onChange={(v) => void switchFormat(v as RewriteKind)}
            options={[
              { value: "image", label: "图文", icon: <FileImageOutlined /> },
              { value: "video", label: "视频", icon: <VideoCameraOutlined /> },
            ]}
          />
        </div>
        <div className="material-body">
          <PublicationMedia
            key={`${selectedID}/${kind}/${versionID}`}
            assets={assets}
            selected={chosen}
            kind={kind}
            disabled={mediaDisabled}
            onChange={saveMedia}
            onOpen={() => {
              setPickerIDs([...chosen]);
              setPicker(true);
            }}
          />
          <div className="material-bottom">
            {platform === "xhs" && kind === "video" && (
              <small className="muted">
                当前小红书扫码发布使用平台默认封面；自选封面会保存在版本中。若平台上传不支持自选封面，请在官方编辑页设置。
              </small>
            )}
            <CoverPicker
              key={`${selectedID}-${kind}`}
              assets={assets}
              value={cover}
              disabled={mediaDisabled}
              refresh={refresh}
              onConfirm={async (id) => {
                if (selectedProject.current !== selectedID) return false;
                return await saveMedia(chosen, kind, id);
              }}
            />
            <Space>
              <small className="muted">
                已选 {publicationMaterialCount} 份素材
              </small>
              <Button
                icon={<SaveOutlined />}
                loading={busy}
                disabled={
                  mediaDisabled || !content.title.trim() || !content.body.trim()
                }
                onClick={() => {
                  setRenameOnly(false);
                  setSaveName("");
                  setSaveDialog(true);
                }}
              >
                保存完整版本
              </Button>
              <Button
                disabled={
                  mediaDisabled ||
                  !current ||
                  dirty ||
                  (current.status === "confirmed" &&
                    project?.selected_versions?.[workspaceKind] === current.id)
                }
                onClick={() => current && chooseVersion(current, true)}
              >
                确认并选用完整版本
              </Button>
              <Button
                type="primary"
                icon={<SendOutlined />}
                disabled={
                  mediaDisabled ||
                  !current ||
                  dirty ||
                  current.status !== "confirmed" ||
                  project?.selected_versions?.[workspaceKind] !== current.id
                }
                onClick={() => {
                  setPublishPlatform(platform);
                  setPublishModal(true);
                }}
              >
                准备发布稿
              </Button>
            </Space>
          </div>
        </div>
      </section>
      <Modal
        title={
          kind === "image" ? "选择图片素材（可单选或多选）" : "选择视频素材"
        }
        open={picker}
        closable={!uploading && !mediaBusy}
        maskClosable={!uploading && !mediaBusy}
        onCancel={() => {
          if (!uploading && !mediaBusy) setPicker(false);
        }}
        footer={
          <Space wrap>
            <span>
              已选 {pickerIDs.length} {kind === "image" ? "张图片" : "个视频"}
            </span>
            <Button
              disabled={mediaDisabled || !pickerIDs.length}
              onClick={() => setPickerIDs([])}
            >
              清空选择
            </Button>
            <Button disabled={mediaDisabled} onClick={() => setPicker(false)}>
              取消
            </Button>
            <Button
              type="primary"
              disabled={mediaDisabled}
              loading={mediaBusy}
              onClick={async () => {
                if (await saveMedia(pickerIDs)) setPicker(false);
              }}
            >
              完成选择
            </Button>
          </Space>
        }
        width={850}
      >
        <Upload.Dragger
          disabled={mediaDisabled}
          multiple={kind === "image"}
          accept={
            kind === "image"
              ? "image/jpeg,image/png,image/webp,image/gif"
              : "video/mp4,video/quicktime,video/webm"
          }
          showUploadList={false}
          beforeUpload={(file, files) => {
            if (file === files[0]) void uploadBatch(files);
            return false;
          }}
        >
          <p className="ant-upload-drag-icon">
            <UploadOutlined />
          </p>
          <strong>
            {kind === "image"
              ? "点击选择一张或多张图片，也可批量拖入"
              : "点击上传，或拖入自己的视频"}
          </strong>
          <p className="muted">
            单个文件不超过 512 MB。上传后保存在本机，取消选择也会保留在素材库。
          </p>
        </Upload.Dragger>
        <Space wrap style={{ marginTop: 16 }}>
          <Input.Search
            placeholder="搜索素材名称"
            value={mediaQuery}
            onChange={(e) => setMediaQuery(e.target.value)}
            allowClear
          />
          <Select
            value={mediaCategory}
            onChange={setMediaCategory}
            style={{ width: 170 }}
            options={[
              { value: "", label: "全部分类" },
              ...[
                ...new Set(
                  assets
                    .filter((a) => !a.deleted_at)
                    .map((a) => a.category)
                    .filter((x): x is string => !!x),
                ),
              ].map((value) => ({ value, label: value })),
            ]}
          />
        </Space>
        <div className="picker-grid">
          {assets
            .filter(
              (a) =>
                (inMediaLibrary(a) || chosen.includes(a.id)) &&
                !a.deleted_at &&
                a.status === "ready" &&
                a.kind === kind &&
                (!mediaCategory || a.category === mediaCategory) &&
                (!mediaQuery ||
                  a.name.toLowerCase().includes(mediaQuery.toLowerCase())),
            )
            .map((a) => (
              <button
                disabled={mediaDisabled}
                className={
                  "picker-asset " + (pickerIDs.includes(a.id) ? "picked" : "")
                }
                aria-pressed={pickerIDs.includes(a.id)}
                aria-label={`选择素材 ${a.name}`}
                key={a.id}
                onClick={() =>
                  setPickerIDs((ids) =>
                    ids.includes(a.id)
                      ? ids.filter((id) => id !== a.id)
                      : kind === "video"
                        ? [a.id]
                        : [...ids, a.id],
                  )
                }
              >
                {a.kind === "image" ? (
                  <img src={fileURL(a.id)} />
                ) : (
                  <div className="video-tile">
                    <VideoCameraOutlined />
                    <span>{Math.round(a.duration)} 秒</span>
                  </div>
                )}
                <span>{a.name}</span>
                {a.category && <Tag>{a.category}</Tag>}
                <small>
                  {a.source === "generated"
                    ? "AI 生成"
                    : a.source === "upload"
                      ? "我的上传"
                      : "采集参考素材"}{" "}
                  · {(a.size / 1024 / 1024).toFixed(1)} MB
                </small>
                {pickerIDs.includes(a.id) && (
                  <span className="picked-mark">
                    {pickerIDs.indexOf(a.id) + 1}
                  </span>
                )}
              </button>
            ))}
        </div>
      </Modal>
      <Modal
        title={renameOnly ? "重命名版本" : "保存完整版本"}
        open={saveDialog}
        confirmLoading={busy}
        onCancel={() => {
          if (!busy) setSaveDialog(false);
        }}
        okText="保存版本"
        onOk={async () => {
          if (renameOnly) {
            setBusy(true);
            try {
              await post(`/rewrites/${selectedID}/versions/${versionID}/name`, {
                name: saveName,
              });
              await load();
              setSaveDialog(false);
              message.success("版本名称已更新，版本号不变");
            } catch (e) {
              message.error((e as Error).message);
            } finally {
              setBusy(false);
            }
            return;
          }
          const result = await save(saveName);
          if (result) setSaveDialog(false);
        }}
      >
        <p>
          {renameOnly
            ? "只修改名称，版本号、发布内容和已建立的发布稿保持不变。"
            : "一起保存当前标题、正文、话题、素材顺序和封面。内容相同则沿用已有版本。"}
        </p>
        <Input
          aria-label="完整版本名称"
          value={saveName}
          maxLength={80}
          showCount
          onChange={(e) => setSaveName(e.target.value)}
          placeholder="版本名称（可选），例如：温柔版、第二版·已配图"
        />
      </Modal>
      <VersionComparison
        open={compare}
        onClose={() => setCompare(false)}
        versions={versions}
        currentID={versionID}
        assets={assets}
        mediaDisabled={mediaDisabled}
        onChoose={chooseVersion}
      />
      <Modal
        title="从完整版本建立发布稿"
        open={publishModal}
        onCancel={() => {
          if (!creatingPublication.current) setPublishModal(false);
        }}
        confirmLoading={publicationBusy}
        cancelButtonProps={{ disabled: publicationBusy }}
        closable={!publicationBusy}
        maskClosable={!publicationBusy}
        okText="建立发布稿"
        onOk={async () => {
          if (creatingPublication.current) return;
          creatingPublication.current = true;
          setPublicationBusy(true);
          const visit = { ...editorVisit.current };
          try {
            const key = versionID + ":" + publishPlatform;
            if (publicationRequest.current.key !== key) {
              publicationRequest.current = { key, id: crypto.randomUUID() };
            }
            await post("/publications", {
              target_platform: publishPlatform,
              version_id: versionID,
              request_id: publicationRequest.current.id,
            });
            await refresh();
            if (
              visit.epoch !== editorVisit.current.epoch ||
              visit.projectID !== editorVisit.current.projectID
            )
              return;
            setPublishModal(false);
            message.success(
              publishPlatform === "both"
                ? "双平台发布稿已建立，请分别核对账号并确认发布"
                : "发布稿已建立",
            );
            onPublish();
          } catch (e) {
            message.error((e as Error).message);
          } finally {
            creatingPublication.current = false;
            setPublicationBusy(false);
          }
        }}
      >
        <p>
          <strong>{current?.title}</strong>
        </p>
        <p className="source-body">{current?.body}</p>
        <p>{current?.topics?.map((t) => "#" + t).join(" ")}</p>
        <p>
          发布到{" "}
          <Select
            aria-label="发布目标平台"
            value={publishPlatform}
            onChange={setPublishPlatform}
            disabled={publicationBusy}
            style={{ width: 210 }}
            options={[
              { value: "xhs", label: "只发小红书" },
              { value: "douyin", label: "只发抖音" },
              { value: "both", label: "两个平台都发" },
            ]}
          />
          使用 V{current?.number} 已确认并选用完整版本，包含{" "}
          {current?.media?.asset_ids.length || 0} 份
          {current?.media?.kind === "image" ? "图片" : "视频"}素材。
        </p>
        {current && <VersionMedia version={current} assets={assets} />}
        {publishPlatform === "both" && (
          <Alert
            type="info"
            showIcon
            message="同一文案和素材，分别发布到小红书和抖音"
            description="将一次建立两条关联的发布记录。到发布管理分别核对账号并确认；已发布的平台不会因为另一边失败而重发。素材只引用本地文件，不重复下载或复制。"
            style={{ marginBottom: 12 }}
          />
        )}
        <Alert
          type={chosen.length ? "info" : "warning"}
          message={
            chosen.length
              ? "建立后固定本次文案、素材与顺序。"
              : "尚未选择素材，将保存为「待准备」发布稿。"
          }
        />
      </Modal>
    </>,
  );
}
