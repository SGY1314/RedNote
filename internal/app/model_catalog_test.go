package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestModelCapabilityWhitelist(t *testing.T) {
	for _, capability := range modelCapabilities {
		if got, ok := parseModelCapability(capability); !ok || got != capability {
			t.Fatalf("%s rejected", capability)
		}
		// URL 段大小写与空白不应产生第二套分组名。
		if got, ok := parseModelCapability(" " + strings.ToUpper(capability) + " "); !ok || got != capability {
			t.Fatalf("%s not normalized", capability)
		}
	}
	for _, invalid := range []string{"", "unknown", "images", "rewrite/models", "video_models", "文案"} {
		if _, ok := parseModelCapability(invalid); ok {
			t.Fatalf("%q accepted as a capability", invalid)
		}
	}
}

func TestCapabilityFromPathKeepsGroupsDistinct(t *testing.T) {
	cases := map[string]string{
		"/api/v1/rewrite-models":            "rewrite",
		"/api/v1/rewrite-models/:mid":       "rewrite",
		"/api/v1/image-models/:mid/test":    "image",
		"/api/v1/video-models/:mid":         "video",
		"/api/v1/video-script-models":       "video-script",
		"/api/v1/video-script-models/:mid":  "video-script",
		"/api/v1/image-plan-models/:mid":    "image-plan",
		"/api/v1/angle-models":              "angle",
		"/api/v1/title-models":              "title",
		"/api/v1/copy-models":               "copy",
	}
	for path, want := range cases {
		got, ok := capabilityFromPath(path)
		if !ok || got != want {
			t.Fatalf("%s → %q (%v), want %q", path, got, ok, want)
		}
	}
	// 管理端路由与服务设置不是模型分组，不能被当前台路径解析吞掉。
	for _, path := range []string{"/api/v1/settings", "/api/v1/admin/models/image", "/api/v1/rewrite-modelsheet"} {
		if got, ok := capabilityFromPath(path); ok {
			t.Fatalf("%s resolved to %q", path, got)
		}
	}
}

// 保存与删除必须落在同一个 settings 主键上：历史上两处各拼一次 key，
// 出现的症状是「删掉之后还在」。条数各分组不同（rewrite 空目录会带一个
// 继承全局设置的默认模型），因此这里只约束「新增的可删掉、其他分组不受影响」。
func TestSaveAndDeleteShareSettingsKey(t *testing.T) {
	a := testApp(t)
	has := func(models []rewriteModel, id string) bool {
		for _, m := range models {
			if m.ID == id {
				return true
			}
		}
		return false
	}
	for _, capability := range modelCapabilities {
		service := domain.Service{BaseURL: "https://example.com/v1", Model: "fixture-model"}
		if capability == "video" {
			service = domain.Service{BaseURL: "https://dashscope.aliyuncs.com/api/v1", Model: "wanx2.1-t2v-turbo"}
		}
		saved, err := a.saveModelFor(capability, modelSaveRequest{rewriteModel: rewriteModel{Name: "配置-" + capability, Service: service}}, "")
		if err != nil {
			t.Fatalf("%s save: %v", capability, err)
		}
		stored, err := store.Get[[]rewriteModel](a.Store.DB, "settings", modelsSettingsKey(capability))
		if err != nil {
			t.Fatalf("%s stored under %s: %v", capability, modelsSettingsKey(capability), err)
		}
		if !has(stored, saved.ID) {
			t.Fatalf("%s not stored in its own group: %+v", capability, stored)
		}
		if _, err := a.deleteModelFor(capability, saved.ID); err != nil {
			t.Fatalf("%s delete: %v", capability, err)
		}
		remaining, err := store.Get[[]rewriteModel](a.Store.DB, "settings", modelsSettingsKey(capability))
		if err != nil {
			t.Fatalf("%s remaining: %v", capability, err)
		}
		if has(remaining, saved.ID) {
			t.Fatalf("%s delete kept its own entry", capability)
		}
	}
}

func TestUnknownCapabilityRejectedByStoreOperations(t *testing.T) {
	a := testApp(t)
	if _, err := a.saveModelFor("bogus", modelSaveRequest{rewriteModel: rewriteModel{Name: "x", Service: domain.Service{BaseURL: "https://example.com/v1", Model: "m"}}}, ""); err == nil {
		t.Fatal("save accepted an unknown capability")
	} else if me, ok := err.(*modelSaveError); !ok || me.Status != 404 {
		t.Fatalf("save error = %v, want 404 modelSaveError", err)
	}
	if _, err := a.deleteModelFor("bogus", "any"); err == nil {
		t.Fatal("delete accepted an unknown capability")
	} else if me, ok := err.(*modelSaveError); !ok || me.Status != 404 {
		t.Fatalf("delete error = %v, want 404 modelSaveError", err)
	}
}

// 工作台的 /rewrite-models/:id/test 与管理端的 testModelFor 必须给出同一结论。
func TestWorkspaceModelProbeUsesSharedImplementation(t *testing.T) {
	a := testApp(t)
	hits := 0
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if r.URL.Path != "/models" {
			t.Errorf("probe hit %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer fixture-key" {
			t.Errorf("probe authorization = %q", r.Header.Get("Authorization"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{{"id": "fixture-model"}}})
	}))
	defer mock.Close()

	saved := decode[rewriteModel](t, request(t, a, "POST", "/rewrite-models", map[string]any{
		"name": "检测", "model": "fixture-model", "base_url": mock.URL, "secret": "fixture-key",
	}, 200))
	fromWorkspace := decode[map[string]string](t, request(t, a, "POST", "/rewrite-models/"+saved.ID+"/test", map[string]any{}, 200))
	fromAdmin, err := a.testModelFor("rewrite", saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if fromWorkspace["message"] != fromAdmin {
		t.Fatalf("workspace probe %q != admin probe %q", fromWorkspace["message"], fromAdmin)
	}
	if !strings.Contains(fromAdmin, "已找到模型") {
		t.Fatalf("unexpected probe message %q", fromAdmin)
	}
	if hits != 2 {
		t.Fatalf("expected one probe per entry point, got %d", hits)
	}
}

func TestAdminModelRoutesRejectUnknownGroup(t *testing.T) {
	m, token, csrf := newMultiUserFixture(t, "admin")
	for _, probe := range []struct {
		method string
		path   string
		body   any
	}{
		{http.MethodGet, "/admin/models/bogus", nil},
		{http.MethodPost, "/admin/models/bogus", map[string]any{"name": "x", "model": "m", "base_url": "https://example.com/v1"}},
		{http.MethodPut, "/admin/models/bogus/any", map[string]any{"name": "x", "model": "m", "base_url": "https://example.com/v1"}},
		{http.MethodDelete, "/admin/models/bogus/any", nil},
		{http.MethodPost, "/admin/models/bogus/any/test", map[string]any{}},
	} {
		out := multiUserRequest(t, m, probe.method, probe.path, token, csrf, probe.body)
		if out.Code != 404 {
			t.Fatalf("%s %s = %d %s, want 404", probe.method, probe.path, out.Code, out.Body.String())
		}
	}
}
