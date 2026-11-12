package app

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

type stageReply struct {
	Workflow     creationWorkflow     `json:"workflow"`
	Version      domain.Version       `json:"version"`
	Publications []domain.Publication `json:"publications"`
}

func TestStageConfirmationOverwritesCurrentDraftButPreservesPublication(t *testing.T) {
	a, p, _ := stageSourceFixture(t)
	endpoint := "/rewrites/" + p.ID + "/workflow/stage"
	first := decode[stageReply](t, request(t, a, "POST", endpoint, map[string]any{"step": "title", "text": "第一份标题"}, 201))
	second := decode[stageReply](t, request(t, a, "POST", endpoint, map[string]any{"step": "title", "text": "覆盖后的标题", "title_key": first.Workflow.Title.Key}, 201))
	if first.Version.ID != second.Version.ID || first.Version.Number != second.Version.Number {
		t.Fatal("confirmation created another draft")
	}
	saved, _ := store.Get[domain.Version](a.Store.DB, "versions", first.Version.ID)
	if saved.Title != "覆盖后的标题" {
		t.Fatal("current draft was not overwritten")
	}
	preview := decode[stageReply](t, request(t, a, "POST", endpoint, map[string]any{"step": "title", "text": second.Version.Title, "title_key": second.Workflow.Title.Key, "publish": true}, 200))
	request(t, a, "POST", "/publications/"+preview.Publications[0].ID+"/confirm", preparedTestInput(preview.Publications[0]), 200)
	third := decode[stageReply](t, request(t, a, "POST", endpoint, map[string]any{"step": "title", "text": "发布后的继续编辑", "title_key": second.Workflow.Title.Key}, 201))
	if third.Version.ID == saved.ID {
		t.Fatal("publication snapshot reused as editable draft")
	}
	frozen, _ := store.Get[domain.Version](a.Store.DB, "versions", saved.ID)
	if frozen.Title != second.Version.Title {
		t.Fatal("publication snapshot changed")
	}
	fourth := decode[stageReply](t, request(t, a, "POST", endpoint, map[string]any{"step": "title", "text": "再覆盖当前稿", "title_key": third.Workflow.Title.Key}, 201))
	if fourth.Version.ID != third.Version.ID {
		t.Fatal("new editable draft did not overwrite")
	}
}

func TestTitleCountsUseFullOriginalContextAndFrozenInputs(t *testing.T) {
	for _, count := range []int{1, 3, 5} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			a, p := stagedFixture(t)
			setTestWorkflowPrompt(t, a, "title", "标题管理员冻结策略")
			confirmTestAccount(t, a, p.ID)
			created := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/titles/generate", map[string]any{"model_id": "initial", "count": count, "requirements": "自然、具体", "reference": "客户端伪造原文"}, 202))
			setTestWorkflowPrompt(t, a, "title", "标题后来修改的策略")
			job, _ := store.Get[domain.Job](a.Store.DB, "jobs", created["job_id"])
			request(t, a, "POST", "/rewrites/"+p.ID+"/workflow/account", map[string]any{"revision": 1, "skip": true}, 200)
			previous := http.DefaultTransport
			t.Cleanup(func() { http.DefaultTransport = previous })
			calls := 0
			http.DefaultTransport = rewriteTransport(func(req *http.Request) (*http.Response, error) {
				calls++
				body, _ := io.ReadAll(req.Body)
				for _, value := range []string{"标题管理员冻结策略", "唯一参考标题", "不能出现在标题请求中的原文标记", "原始话题", "自然、具体", "独立咖啡师", fmt.Sprintf("恰好包含%d项", count)} {
					if !strings.Contains(string(body), value) {
						t.Fatalf("title model input missing %q", value)
					}
				}
				if strings.Contains(string(body), "客户端伪造原文") || strings.Contains(string(body), "标题后来修改的策略") {
					t.Fatal("client replaced the pinned source context")
				}
				titles := []string{}
				for i := 0; i < count; i++ {
					titles = append(titles, fmt.Sprintf("真实生活的标题%d", i+1))
				}
				result, _ := json.Marshal(map[string]any{"titles": titles})
				return planReply(string(result)), nil
			})
			if _, err := a.runTitleRewrite(job); err != nil {
				t.Fatal(err)
			}
			record, _ := store.Get[textGeneration](a.Store.DB, "title_generations", job.ID)
			if calls != 1 || len(record.Titles) != count || record.Count != count {
				t.Fatal("count or call snapshot mismatch", calls, record.Count, len(record.Titles))
			}
		})
	}
	a, p := stagedFixture(t)
	for _, count := range []int{-1, 2, 4, 6} {
		request(t, a, "POST", "/rewrites/"+p.ID+"/titles/generate", map[string]any{"model_id": "initial", "count": count}, 400)
	}
	jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
	for _, job := range jobs {
		if job.Kind == "title_rewrite" {
			t.Fatal("invalid count enqueued a paid task")
		}
	}
}

func stageSourceFixture(t *testing.T) (*App, domain.Project, domain.Revision) {
	t.Helper()
	a, p := stagedFixture(t)
	rev, _ := store.Get[domain.Revision](a.Store.DB, "revisions", p.RevisionID)
	rev.Body, rev.Topics, rev.Kind = "需要原样保留的正文。", []string{"真实生活", "原始标签"}, "image"
	previous, _ := store.List[domain.Asset](a.Store.DB, "assets")
	for _, asset := range previous {
		if asset.RevisionID == rev.ID {
			asset.RevisionID = "other-fixture-revision"
			store.Put(a.Store.DB, "assets", asset.ID, asset)
		}
	}
	first, second := sampleImage(t, a), sampleImage(t, a)
	for index, asset := range []domain.Asset{first, second} {
		asset.Source, asset.RevisionID, asset.Position = "collection", rev.ID, index
		if err := store.Put(a.Store.DB, "assets", asset.ID, asset); err != nil {
			t.Fatal(err)
		}
	}
	rev.AssetIDs = []string{second.ID, first.ID}
	if err := store.Put(a.Store.DB, "revisions", rev.ID, rev); err != nil {
		t.Fatal(err)
	}
	return a, p, rev
}

func TestStageConfirmationAndPublishPreserveUntouchedContent(t *testing.T) {
	a, p, source := stageSourceFixture(t)
	endpoint := "/rewrites/" + p.ID + "/workflow/stage"
	input := map[string]any{"step": "title", "text": "只改标题的新版本", "topics": []string{"不应覆盖原标签"}}
	confirmed := decode[stageReply](t, request(t, a, "POST", endpoint, input, 201))
	v := confirmed.Version
	if v.Title != input["text"] || v.Body != source.Body || !slices.Equal(v.Topics, source.Topics) || !slices.Equal(v.Media.AssetIDs, source.AssetIDs) || v.Media.CoverID != source.AssetIDs[0] || len(confirmed.Publications) != 0 || v.Status != "confirmed" {
		t.Fatal("title confirmation changed unrelated original data", v)
	}
	again := decode[stageReply](t, request(t, a, "POST", endpoint, input, 200))
	if again.Version.ID != v.ID {
		t.Fatal("unchanged confirmation created a duplicate version")
	}
	input["publish"] = true
	published := decode[stageReply](t, request(t, a, "POST", endpoint, input, 200))
	if len(published.Publications) != 1 || published.Publications[0].VersionID != v.ID || published.Publications[0].Body != source.Body || !slices.Equal(published.Publications[0].AssetIDs, source.AssetIDs) {
		t.Fatal("title publish did not reuse the confirmed full-note snapshot")
	}
	publishedAgain := decode[stageReply](t, request(t, a, "POST", endpoint, input, 200))
	if publishedAgain.Publications[0].ID != published.Publications[0].ID {
		t.Fatal("repeated publish created a duplicate draft")
	}
	copyInput := map[string]any{"step": "copy", "text": "新的完整正文", "topics": []string{"新话题"}, "title_key": published.Workflow.Title.Key, "publish": true}
	copyResult := decode[stageReply](t, request(t, a, "POST", endpoint, copyInput, 201))
	if copyResult.Version.Title != v.Title || copyResult.Version.Body != "新的完整正文" || !slices.Equal(copyResult.Version.Media.AssetIDs, source.AssetIDs) || len(copyResult.Publications) != 1 {
		t.Fatal("copy stage failed to preserve title or original media")
	}
	newImage := sampleImage(t, a)
	imageInput := map[string]any{"step": "image", "title_key": copyResult.Workflow.Title.Key, "copy_key": copyResult.Workflow.Copy.Key, "media": domain.VersionMedia{Kind: "image", AssetIDs: []string{newImage.ID}}, "publish": true}
	imageResult := decode[stageReply](t, request(t, a, "POST", endpoint, imageInput, 201))
	if imageResult.Version.Title != v.Title || imageResult.Version.Body != copyResult.Version.Body || !slices.Equal(imageResult.Version.Topics, copyResult.Version.Topics) || !slices.Equal(imageResult.Version.Media.AssetIDs, []string{newImage.ID}) {
		t.Fatal("image stage changed confirmed text")
	}
	videoBytes, err := os.ReadFile(filepath.Join("..", "..", "web", "tests", "fixtures", "reference-preview.webm"))
	if err != nil {
		t.Fatal(err)
	}
	video := domain.Asset{ID: ID(), Kind: "video", Status: "ready", Source: "upload", MIME: "video/webm", Path: "stage-preview.webm", Size: int64(len(videoBytes)), Duration: 1.2}
	if err = os.WriteFile(filepath.Join(a.Config.DataDir, "media", video.Path), videoBytes, 0600); err != nil {
		t.Fatal(err)
	}
	store.Put(a.Store.DB, "assets", video.ID, video)
	videoInput := map[string]any{"step": "video", "title_key": copyResult.Workflow.Title.Key, "copy_key": copyResult.Workflow.Copy.Key, "media": domain.VersionMedia{Kind: "video", AssetIDs: []string{video.ID}, CoverID: source.AssetIDs[0]}, "publish": true}
	videoResult := decode[stageReply](t, request(t, a, "POST", endpoint, videoInput, 201))
	if videoResult.Version.Body != copyResult.Version.Body || videoResult.Version.Media.Kind != "video" || videoResult.Publications[0].CoverID != source.AssetIDs[0] {
		t.Fatal("video stage changed confirmed copy or lost its cover")
	}
	afterVideo := decode[stageReply](t, request(t, a, "POST", endpoint, map[string]any{"step": "title", "text": "保留视频的最新标题", "title_key": copyResult.Workflow.Title.Key}, 201))
	if afterVideo.Version.Media.Kind != "video" || afterVideo.Version.Media.AssetIDs[0] != video.ID || afterVideo.Version.Body != copyResult.Version.Body {
		t.Fatal("saving title lost the latest saved video or copy")
	}
	copyInput["title_key"] = "old-title"
	request(t, a, "POST", endpoint, copyInput, 409)
	stored, _ := store.List[domain.Publication](a.Store.DB, "publications")
	if len(stored) != 0 {
		t.Fatal("saving and previewing created publications before final confirmation")
	}

}

func TestStagePublishIsAtomicAndOriginalVideoKeepsCover(t *testing.T) {
	a, p, source := stageSourceFixture(t)
	asset, _ := store.Get[domain.Asset](a.Store.DB, "assets", source.AssetIDs[0])
	asset.Status = "pending"
	store.Put(a.Store.DB, "assets", asset.ID, asset)
	endpoint := "/rewrites/" + p.ID + "/workflow/stage"
	input := map[string]any{"step": "title", "text": "等待素材的标题", "publish": true}
	draft := decode[stageReply](t, request(t, a, "POST", endpoint, input, 201))
	if draft.Version.Status != "draft" {
		t.Fatal("unfinished original media was marked ready")
	}
	request(t, a, "POST", "/publications/"+draft.Publications[0].ID+"/confirm", preparedTestInput(draft.Publications[0]), 400)
	asset.Status = "ready"
	store.Put(a.Store.DB, "assets", asset.ID, asset)
	input["publish"] = true
	ready := decode[stageReply](t, request(t, a, "POST", endpoint, input, 200))
	if ready.Version.ID != draft.Version.ID || ready.Version.Status != "confirmed" || len(ready.Publications) != 1 {
		t.Fatal("ready media created another version instead of completing the snapshot")
	}
	asset.Kind = "video"
	store.Put(a.Store.DB, "assets", asset.ID, asset)
	source.Kind = "video"
	media, err := a.workflowOriginalMedia(source)
	if err != nil || !slices.Equal(media.AssetIDs, []string{asset.ID}) || media.CoverID != source.AssetIDs[1] {
		t.Fatal("original video media lost its image cover", media, err)
	}
}
