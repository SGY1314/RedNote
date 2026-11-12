package app

import (
	"database/sql"
	"os"
	"strings"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestLiveWorkflowVideoScript(t *testing.T) {
	path := os.Getenv("WORKBENCH_LIVE_SCRIPT_CONFIG")
	if path == "" {
		t.Skip("optional live provider check")
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal("configuration database unavailable")
	}
	defer db.Close()
	models, err := store.Get[[]rewriteModel](db, "settings", "video-script-models")
	if err != nil {
		t.Fatal("script configuration unavailable")
	}
	var configured rewriteModel
	for _, model := range models {
		if strings.Contains(strings.ToLower(model.Model), "deepseek") && model.Secret != "" {
			configured = model
			break
		}
	}
	if configured.ID == "" {
		t.Fatal("configured DeepSeek script model unavailable")
	}
	a, p, _ := stageSourceFixture(t)
	confirmTestAccount(t, a, p.ID)
	if err = store.Put(a.Store.DB, "settings", "video-script-models", []rewriteModel{configured}); err != nil {
		t.Fatal(err)
	}
	base := "/rewrites/" + p.ID
	w := decode[creationWorkflow](t, request(t, a, "POST", base+"/titles/confirm", map[string]any{"text": "早晨的一杯手冲"}, 200))
	request(t, a, "POST", base+"/copies/confirm", map[string]any{"title_key": w.Title.Key, "body": "在清晨磨豆、注水，记录一杯手冲咖啡的香气。", "topics": []string{"手冲咖啡"}}, 200)
	response := decode[map[string]string](t, request(t, a, "POST", base+"/workflow/video-script", map[string]any{"model_id": configured.ID, "duration": 10, "request_id": "live-script-verification"}, 202))
	job, err := store.Get[domain.Job](a.Store.DB, "jobs", response["job_id"])
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.execute(job); err != nil {
		t.Fatalf("live script generation failed: %v", err)
	}
	saved, _ := store.Get[domain.Job](a.Store.DB, "jobs", job.ID)
	if len([]rune(asString(saved.Payload["generated_script"]))) < 40 {
		t.Fatal("live script output incomplete")
	}
	t.Log("Live DeepSeek script generation passed; isolated fixture only.")
}
