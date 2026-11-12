package app

import (
	"net/http"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestSiteFixManualPublishedEligibility(t *testing.T) {
	p := domain.Publication{Ready: true, ManualStatus: "published", TargetPlatform: "xhs", Kind: "image", Content: domain.Content{Title: "手动已发布", Body: "正文"}}
	if mobilePublicationEligible(p) {
		t.Fatal("manually published content must be blocked")
	}
	p.TargetPlatform = "douyin"
	if douyinPhoneEligible(p) {
		t.Fatal("manually published Douyin content must be blocked")
	}
}
func TestSiteFixStaleAdminTemplateOverwrites(t *testing.T) {
	m, token, csrf := newMultiUserFixture(t, "admin")
	initial := workflowPrompt{Scope: "title", Name: "审计模板", Prompt: "初始内容", Enabled: true, Default: true}
	create := multiUserRequest(t, m, http.MethodPost, "/admin/prompt-presets", token, csrf, initial)
	if create.Code != 200 {
		t.Fatal(create.Code)
	}
	first := decode[workflowPrompt](t, create.Body.Bytes())
	stale := first
	first.Prompt = "窗口A的新内容"
	saved := multiUserRequest(t, m, http.MethodPut, "/admin/prompt-presets/"+first.ID, token, csrf, first)
	if saved.Code != 200 {
		t.Fatal(saved.Code)
	}
	stale.Prompt = "窗口B的旧内容覆盖"
	overwritten := multiUserRequest(t, m, http.MethodPut, "/admin/prompt-presets/"+stale.ID, token, csrf, stale)
	if overwritten.Code != 409 {
		t.Fatal("manually published content must be blocked")
	}
	latest := decode[workflowPrompt](t, saved.Body.Bytes())
	stale.Revision = latest.Revision
	retry := multiUserRequest(t, m, http.MethodPut, "/admin/prompt-presets/"+stale.ID, token, csrf, stale)
	if retry.Code != 200 {
		t.Fatal(retry.Code)
	}
}

func TestSiteFixPreviewRefreshesRevisionWithoutWriting(t *testing.T) {
	a, p, _ := stageSourceFixture(t)
	reply := decode[stageReply](t, request(t, a, "POST", "/rewrites/"+p.ID+"/workflow/stage", workflowStageRequest{Step: "title", Text: "重新核对标题", Publish: true}, 201))
	proposal := reply.Publications[0]
	input := map[string]any{"items": []publicationConfirmation{preparedTestInput(proposal)}}
	request(t, a, "POST", "/publications/preview", input, 200)
	pubs, _ := store.List[domain.Publication](a.Store.DB, "publications")
	if len(pubs) != 0 {
		t.Fatal("preview persisted publication")
	}
	saved := confirmPreparedTest(t, a, proposal)
	saved.Revision++
	store.Put(a.Store.DB, "publications", saved.ID, saved)
	response := decode[struct {
		Items []domain.Publication `json:"items"`
	}](t, request(t, a, "POST", "/publications/preview", input, 200))
	if len(response.Items) != 1 || response.Items[0].Revision != saved.Revision {
		t.Fatal("preview did not refresh revision")
	}
	saved.ManualStatus = "published"
	store.Put(a.Store.DB, "publications", saved.ID, saved)
	request(t, a, "POST", "/publications/preview", input, 409)
}

func TestSiteFixNegatedVideoRequirementCanCreateJob(t *testing.T) {
	for _, requirement := range []string{"不要夜晚场景", "改为夜晚场景"} {
		t.Run(requirement, func(t *testing.T) {
			a, p, _ := stageSourceFixture(t)
			model := decode[rewriteModel](t, request(t, a, "POST", "/video-models", map[string]any{"name": "视频回归模型", "base_url": "https://example.com/api/v3", "model": "doubao-seedance-2-5-260628", "secret": "fixture"}, 200))
			request(t, a, "POST", "/rewrites/"+p.ID+"/workflow/video", map[string]any{"model_id": model.ID, "script": "白天在咖啡馆拍摄，主角冲泡咖啡。", "requirements": requirement, "reference_asset_ids": []string{}, "quality": "720p", "ratio": "9:16", "duration": 10, "count": 1, "audio": false, "request_id": ID()}, 202)
		})
	}
}
