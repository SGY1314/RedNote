package app

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestWorkflowAngleUsesFullSinglePostAndFrozenModel(t *testing.T) {
	a, p := stagedFixture(t)
	base := "/rewrites/" + p.ID
	models, _ := a.modelsFor("angle")
	models[0].Vision = true
	store.Put(a.Store.DB, "settings", "angle-models", models)
	image := sampleImage(t, a)
	image.Source = "collection"
	image.RevisionID = p.RevisionID
	store.Put(a.Store.DB, "assets", image.ID, image)
	store.Put(a.Store.DB, "extractions", "ocr-angle", domain.Extraction{ID: "ocr-angle", AssetID: image.ID, Kind: "ocr", Text: "图片中的独特研磨步骤"})
	store.Put(a.Store.DB, "extractions", "asr-angle", domain.Extraction{ID: "asr-angle", AssetID: image.ID, Kind: "asr", Text: "已有转写中的水温说明"})
	store.Put(a.Store.DB, "extractions", "foreign-angle", domain.Extraction{ID: "foreign-angle", AssetID: "foreign", Kind: "ocr", Text: "其他帖子不能出现"})
	result := decode[map[string]any](t, request(t, a, "POST", base+"/angles/recommend", map[string]any{"model_id": "initial", "reference": "恶意覆盖参考正文"}, 202))
	request(t, a, "POST", base+"/angles/recommend", map[string]any{"model_id": "initial"}, 409)
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", result["job_id"].(string))
	if strings.Contains(jsonString(j), "staged-key") {
		t.Fatal("secret in public payload")
	}
	rev, _ := store.Get[domain.Revision](a.Store.DB, "revisions", p.RevisionID)
	rev.Body = "排队后修改正文不应进入请求"
	store.Put(a.Store.DB, "revisions", rev.ID, rev)
	models[0].Model = "new-config"
	store.Put(a.Store.DB, "settings", "angle-models", models)
	old := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = old })
	calls := 0
	http.DefaultTransport = rewriteTransport(func(req *http.Request) (*http.Response, error) {
		calls++
		var input map[string]any
		json.NewDecoder(req.Body).Decode(&input)
		text := jsonString(input)
		for _, want := range []string{"唯一参考标题", "不能出现在标题请求中的原文标记", "原始话题", "图片中的独特研磨步骤", "已有转写中的水温说明", "data:image/"} {
			if !strings.Contains(text, want) {
				t.Fatalf("missing full reference %s", want)
			}
		}
		for _, forbidden := range []string{"其他帖子不能出现", "恶意覆盖参考正文", "排队后修改正文", "new-config"} {
			if strings.Contains(text, forbidden) {
				t.Fatalf("unexpected %s", forbidden)
			}
		}
		return planReply("```json\n{\"angles\":[{\"name\":\"研磨方法\",\"description\":\"从图片中的研磨步骤解释操作细节\"},{\"name\":\"水温控制\",\"description\":\"根据已有转写说明如何选择水温\"},{\"name\":\"操作顺序\",\"description\":\"梳理原帖的完整制作顺序\"}]}\n```"), nil
	})
	if _, e := a.runWorkflowAngles(j); e != nil {
		t.Fatal(e)
	}
	if _, e := a.runWorkflowAngles(j); e != nil {
		t.Fatal(e)
	}
	if calls != 1 {
		t.Fatal("retry regenerated")
	}
	record, _ := store.Get[workflowAngleGeneration](a.Store.DB, "angle_generations", j.ID)
	if len(record.Angles) != 3 || record.RevisionID != p.RevisionID {
		t.Fatal("missing provenance")
	}
	response := request(t, a, "GET", base+"/workflow", nil, 200)
	if !strings.Contains(string(response), "研磨方法") {
		t.Fatal("history missing")
	}
}
func TestWorkflowAngleTextOnlyCoverageAndIndependentCatalog(t *testing.T) {
	a, p := stagedFixture(t)
	base := "/rewrites/" + p.ID
	image := sampleImage(t, a)
	image.Source = "collection"
	image.RevisionID = p.RevisionID
	store.Put(a.Store.DB, "assets", image.ID, image)
	result := decode[map[string]any](t, request(t, a, "POST", base+"/angles/recommend", map[string]any{"model_id": "initial"}, 202))
	if !strings.Contains(jsonString(result), "未读取图片和视频画面") {
		t.Fatal("missing coverage notice")
	}
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", result["job_id"].(string))
	var record workflowAngleGeneration
	b, _ := json.Marshal(j.Payload["input"])
	json.Unmarshal(b, &record)
	if len(record.References) != 0 {
		t.Fatal("text model got images")
	}
	store.Put(a.Store.DB, "settings", "angle-models", []rewriteModel{})
	a.initializeStageModels()
	list, _ := a.modelsFor("angle")
	if len(list) != 0 {
		t.Fatal("empty angle catalog inherited")
	}
}
