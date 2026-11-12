package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestWorkflowPromptsArePrivateAndFrozenPerJob(t *testing.T) {
	a, p := stagedFixture(t)
	items := []workflowPrompt{
		{ID: "angle-style", Scope: "angle", Name: "生活观察", Prompt: "聚焦真实生活中的反差", Enabled: true, Default: true, Revision: 1},
		{ID: "title-style", Scope: "title", Name: "自然标题", Prompt: "标题语气自然，不用夸张感叹", Enabled: true, Default: true, Revision: 2},
	}
	if err := store.Put(a.Store.DB, "settings", workflowPromptsKey, items); err != nil {
		t.Fatal(err)
	}
	public := string(request(t, a, "GET", "/prompt-presets", nil, 200))
	if !strings.Contains(public, "自然标题") || !strings.Contains(public, "不用夸张感叹") {
		t.Fatal("public catalog should expose enabled template bodies for user editing")
	}
	if strings.Contains(public, "angle-style") {
		t.Fatal("retired angle presets appeared in the active catalog")
	}
	base := "/rewrites/" + p.ID
	created := decode[map[string]any](t, request(t, a, "POST", base+"/titles/generate", map[string]any{"model_id": "initial", "preset_id": "title-style"}, 202))
	jobID := created["job_id"].(string)
	job, err := store.Get[domain.Job](a.Store.DB, "jobs", jobID)
	if err != nil || strings.Contains(jsonString(job), "不用夸张感叹") {
		t.Fatal("prompt body leaked into job payload", err)
	}
	frozen, err := store.Get[string](a.Store.DB, "settings", "workflow-prompt-job-"+jobID)
	if err != nil || frozen != items[1].Prompt {
		t.Fatal("job prompt not snapshotted", err)
	}
	items[1].Prompt = "后来修改的方案"
	items[1].Revision++
	if err := store.Put(a.Store.DB, "settings", workflowPromptsKey, items); err != nil {
		t.Fatal(err)
	}
	frozen, _ = store.Get[string](a.Store.DB, "settings", "workflow-prompt-job-"+jobID)
	if frozen != "标题语气自然，不用夸张感叹" {
		t.Fatal("queued job changed with admin edit")
	}
	request(t, a, "POST", base+"/titles/generate", map[string]any{"model_id": "initial", "preset_id": "angle-style"}, 400)
	request(t, a, "POST", base+"/angles/recommend", map[string]any{"model_id": "initial", "preset_id": "angle-style"}, 202)
}

func TestWorkflowPromptAdminOnlyAndUserCatalog(t *testing.T) {
	m, err := NewMulti(Config{Listen: "127.0.0.1:8080", DataDir: t.TempDir(), WebDir: t.TempDir(), CollectorURL: "http://127.0.0.1:5556"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	visit := func(role, method, path string, body any) *httptest.ResponseRecorder {
		t.Helper()
		var id string
		if err := m.AuthDB.QueryRow("SELECT id FROM users WHERE role=? LIMIT 1", role).Scan(&id); err != nil {
			t.Fatal(err)
		}
		token, csrf, err := m.createSession(AuthUser{ID: id}, "127.0.0.1", "test")
		if err != nil {
			t.Fatal(err)
		}
		encoded, _ := json.Marshal(body)
		req := httptest.NewRequest(method, "http://127.0.0.1:8080/api/v1"+path, bytes.NewReader(encoded))
		req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-CSRF-Token", csrf)
		out := httptest.NewRecorder()
		m.Router().ServeHTTP(out, req)
		return out
	}
	form := workflowPrompt{Scope: "title", Name: "轻松口吻", Prompt: "多用生活里的具体细节", Enabled: true, Default: true}
	if response := visit("creator", "POST", "/admin/prompt-presets", form); response.Code != 403 {
		t.Fatal("creator changed admin prompts", response.Code)
	}
	if response := visit("admin", "POST", "/admin/prompt-presets", form); response.Code != 200 {
		t.Fatal("admin could not create prompt", response.Code, response.Body.String())
	}
	public := visit("creator", "GET", "/prompt-presets", nil)
	if public.Code != 200 || !strings.Contains(public.Body.String(), "轻松口吻") || !strings.Contains(public.Body.String(), form.Prompt) {
		t.Fatal("creator catalog wrong or leaked prompt", public.Code, public.Body.String())
	}
	if response := visit("creator", "GET", "/admin/prompt-presets", nil); response.Code != 403 {
		t.Fatal("creator read admin prompt", response.Code)
	}
	for _, scope := range []string{"copy", "image", "video-script", "video"} {
		form.Scope, form.Name = scope, scope+"默认提示词"
		response := visit("admin", "POST", "/admin/prompt-presets", form)
		if response.Code != 200 {
			t.Fatal("admin could not configure stage", scope, response.Code, response.Body.String())
		}
	}
	form.Scope = "angle"
	if response := visit("admin", "POST", "/admin/prompt-presets", form); response.Code != 400 {
		t.Fatal("retired angle stage accepted new configuration", response.Code)
	}
	for _, item := range decode[[]workflowPrompt](t, visit("admin", "GET", "/admin/prompt-presets", nil).Body.Bytes()) {
		if !workflowPromptScope(item.Scope) {
			t.Fatal("admin catalog includes retired stage", item.Scope)
		}
	}
	public = visit("creator", "GET", "/prompt-presets", nil)
	if items := decode[[]publicWorkflowPrompt](t, public.Body.Bytes()); len(items) != 5 {
		t.Fatal("five-stage configuration did not propagate to the existing workspace", len(items))
	}
	items := decode[[]workflowPrompt](t, visit("admin", "GET", "/admin/prompt-presets", nil).Body.Bytes())
	for _, item := range items {
		if item.Scope != "video" {
			continue
		}
		item.Enabled = false
		response := visit("admin", "PUT", "/admin/prompt-presets/"+item.ID, item)
		if response.Code != 200 || decode[workflowPrompt](t, response.Body.Bytes()).Default {
			t.Fatal("disabled video prompt retained its default marker", response.Code, response.Body.String())
		}
		defaults, err := m.Model.workflowDefaultPrompts()
		if err != nil || defaults["video"].ID != "" {
			t.Fatal("disabled video prompt did not fall back to system rules", err)
		}
		if response := visit("admin", "DELETE", "/admin/prompt-presets/"+item.ID, nil); response.Code != 200 {
			t.Fatal("could not delete video prompt", response.Code)
		}
	}
	public = visit("creator", "GET", "/prompt-presets", nil)
	if items := decode[[]publicWorkflowPrompt](t, public.Body.Bytes()); len(items) != 4 {
		t.Fatal("disabled/deleted stage remained in creator catalog", len(items))
	}
}

func setTestWorkflowPrompt(t *testing.T, a *App, scope, prompt string) workflowPrompt {
	t.Helper()
	items, err := readWorkflowPrompts(a.Store.DB)
	if err != nil {
		t.Fatal(err)
	}
	preset := workflowPrompt{ID: "fixture-" + scope, Scope: scope, Name: scope + "默认策略", Prompt: prompt, Enabled: true, Default: true, Revision: 1}
	index := -1
	for i := range items {
		if items[i].Scope == scope {
			items[i].Default = false
		}
		if items[i].ID == preset.ID {
			index, preset.Revision = i, items[i].Revision+1
		}
	}
	if index < 0 {
		items = append(items, preset)
	} else {
		items[index] = preset
	}
	if err := store.Put(a.Store.DB, "settings", workflowPromptsKey, items); err != nil {
		t.Fatal(err)
	}
	return preset
}

func TestWorkflowDefaultPromptPreviewMatchesFourStages(t *testing.T) {
	a, p := stagedFixture(t)
	for _, scope := range workflowPromptScopes {
		setTestWorkflowPrompt(t, a, scope, "管理员"+scope+"专属策略")
	}
	detail := decode[struct {
		Title map[string]string `json:"title_system_prompts"`
		Copy  map[string]string `json:"copy_system_prompts"`
		Media map[string]string `json:"media_system_prompts"`
	}](t, request(t, a, "GET", "/rewrites/"+p.ID+"/workflow", nil, 200))
	for scope, prompts := range map[string]map[string]string{"title": detail.Title, "copy": detail.Copy, "image": {"image": detail.Media["image"]}, "video": {"video": detail.Media["video"]}} {
		for _, prompt := range prompts {
			if !strings.Contains(prompt, "管理员"+scope+"专属策略") {
				t.Fatalf("%s preview missing configured system prompt", scope)
			}
			for _, other := range workflowPromptScopes {
				if other != scope && strings.Contains(prompt, "管理员"+other+"专属策略") {
					t.Fatal("prompt crossed stage boundaries", scope, other)
				}
			}
		}
	}
	if len(detail.Title) != 3 || len(detail.Copy) != 5 || len(detail.Media) != 2 || !strings.Contains(detail.Title["5"], "恰好包含5项") {
		t.Fatal("server output constraints were lost")
	}
}

func TestWorkflowMediaInputFingerprintPreservesRetriesAcrossPromptChanges(t *testing.T) {
	for _, kind := range []string{"image", "video"} {
		base := workflowMediaSnapshot{Kind: kind, SystemPrompt: workflowVideoPrompt, Requirements: "用户要求", SourceIDs: []string{"source"}, Count: 1}
		if kind == "image" {
			base.SystemPrompt = workflowImagePrompt
		}
		legacy := mediaFingerprint(base)
		changed := base
		changed.SystemPrompt = workflowSystemPrompt(base.SystemPrompt, "新管理员提示词")
		changed.PresetID, changed.PresetName, changed.PresetRev = "preset", "默认策略", 2
		if workflowMediaInputFingerprint(changed) != legacy {
			t.Fatal("admin prompt changes must reuse the original request", kind)
		}
		changed.Requirements = "不同的用户要求"
		if workflowMediaInputFingerprint(changed) == legacy {
			t.Fatal("different user input reused a request", kind)
		}
	}
}

func TestWorkflowPromptDefaultFallbackAndValidation(t *testing.T) {
	a := testApp(t)
	items := []workflowPrompt{
		{ID: "a", Scope: "title", Name: "旧默认", Prompt: "A", Enabled: false, Default: true},
		{ID: "b", Scope: "title", Name: "新默认", Prompt: "B", Enabled: true},
	}
	normalizeWorkflowPromptDefaults(items)
	if items[0].Default || !items[1].Default {
		t.Fatal("disabled prompt remained default")
	}
	if err := store.Put(a.Store.DB, "settings", workflowPromptsKey, items); err != nil {
		t.Fatal(err)
	}
	selected, err := a.resolveWorkflowPrompt("title", "")
	if err != nil || selected.ID != "b" {
		t.Fatal("default resolution failed", err)
	}
	if _, err := a.resolveWorkflowPrompt("title", "a"); err == nil {
		t.Fatal("disabled preset accepted")
	}
	if _, err := a.resolveWorkflowPrompt("copy", "b"); err == nil {
		t.Fatal("cross-stage preset accepted")
	}
}
