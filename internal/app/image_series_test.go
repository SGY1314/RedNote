package app

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func seriesFixture(t *testing.T, a *App, mode string) (domain.Project, rewriteModel) {
	t.Helper()
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "连续画面"}, 201))
	m := decode[rewriteModel](t, request(t, a, "POST", "/image-models", map[string]string{"name": "连续图片模型", "model": "fixture", "base_url": "https://example.com/v1", "secret": "series-key", "reference_mode": mode}, 200))
	return p, m
}

func seriesPNG(t *testing.T, red uint8) []byte {
	t.Helper()
	im := image.NewRGBA(image.Rect(0, 0, 24, 24))
	im.Set(0, 0, color.RGBA{R: red, A: 255})
	var b bytes.Buffer
	if err := png.Encode(&b, im); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestImageSeriesContinuityPartialFailureResumeAndWholeVersion(t *testing.T) {
	a := testApp(t)
	p, m := seriesFixture(t, a, "generations_image")
	ref := sampleImage(t, a)
	refBytes, _ := os.ReadFile(filepath.Join(a.Config.DataDir, "media", ref.Path))
	result := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/generate-image", map[string]any{"model_id": m.ID, "count": 3, "prompt": "同一位红衣主角，暖色插画", "copy_text": "从出门到抵达目的地", "scenes": []string{"走出家门", "沿路行走", "到达公园"}, "reference_asset_ids": []string{ref.ID}}, 202))
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", result["job_id"])
	series, _ := jobImageSeries(j)
	original := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = original })
	pictures := [][]byte{seriesPNG(t, 20), seriesPNG(t, 50), seriesPNG(t, 90)}
	calls := 0
	prompts := []string{}
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		var body struct {
			Prompt string   `json:"prompt"`
			Model  string   `json:"model"`
			N      int      `json:"n"`
			Images []string `json:"image"`
		}
		if e := json.NewDecoder(r.Body).Decode(&body); e != nil {
			t.Fatal(e)
		}
		if body.N != 1 || body.Model != "fixture" || r.Header.Get("Authorization") != "Bearer series-key" {
			t.Fatal("request not frozen or batch charged blindly")
		}
		prompts = append(prompts, body.Prompt)
		frame := 0
		if calls == 2 || calls == 3 {
			frame = 1
		}
		if calls == 4 {
			frame = 2
		}
		for _, text := range []string{"同一位红衣主角", "从出门到抵达目的地", "走出家门", "沿路行走", "到达公园", "不要拼图"} {
			if !strings.Contains(body.Prompt, text) {
				t.Fatal("missing shared story", text)
			}
		}
		expected := [][]byte{refBytes}
		if frame > 0 {
			expected = append(expected, pictures[0])
		}
		if frame > 1 {
			expected = append(expected, pictures[1])
		}
		if len(body.Images) != len(expected) {
			t.Fatal("wrong continuity image count", len(body.Images))
		}
		for i, want := range expected {
			got, e := base64.StdEncoding.DecodeString(strings.TrimPrefix(body.Images[i], "data:image/png;base64,"))
			if e != nil || !bytes.Equal(got, want) {
				t.Fatal("wrong reference, anchor, or preceding frame", i)
			}
		}
		if calls == 2 {
			return &http.Response{StatusCode: 429, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{}`))}, nil
		}
		out, _ := json.Marshal(map[string]any{"data": []any{map[string]string{"b64_json": base64.StdEncoding.EncodeToString(pictures[frame])}}})
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(out))}, nil
	})
	if _, err := a.execute(j); err == nil || !strings.Contains(err.Error(), "第 2/3 张失败，已保留 1 张") {
		t.Fatal("partial failure not surfaced", err)
	}
	if calls != 2 {
		t.Fatal("continued after failed frame")
	}
	partial, _ := store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
	progress, _ := jobImageSeries(partial)
	if !reflect.DeepEqual(progress.Completed, series.AssetIDs[:1]) {
		t.Fatal("partial result not persisted", progress)
	}
	request(t, a, "POST", "/assets/batch-trash", map[string]any{"ids": series.AssetIDs[:1], "deleted": true}, 200)
	request(t, a, "POST", "/assets/batch-purge", map[string]any{"ids": series.AssetIDs[:1], "confirm": true}, 409)
	request(t, a, "POST", "/assets/batch-trash", map[string]any{"ids": series.AssetIDs[:1], "deleted": false}, 200)
	partial.State = "failed"
	store.Put(a.Store.DB, "jobs", partial.ID, partial)
	request(t, a, "PUT", "/image-models/"+m.ID, map[string]string{"name": "改配置", "model": "changed", "base_url": "https://changed.example/v1", "secret": "changed"}, 200)
	request(t, a, "POST", "/jobs/"+j.ID+"/retry", nil, 202)
	if _, err := a.execute(j); err != nil {
		t.Fatal(err)
	} // intentionally pass stale job: persisted progress must win
	if calls != 4 || prompts[1] != prompts[2] {
		t.Fatal("completed image was regenerated or retry prompt changed", calls)
	}
	done, _ := store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
	completed, _ := jobImageSeries(done)
	if !reflect.DeepEqual(completed.Completed, series.AssetIDs) {
		t.Fatal("result ordering lost", completed)
	}
	if _, err := a.execute(j); err != nil || calls != 4 {
		t.Fatal("completed sequence charged again", err, calls)
	}
	for i, id := range series.AssetIDs {
		asset, e := store.Get[domain.Asset](a.Store.DB, "assets", id)
		if e != nil || asset.Status != "ready" {
			t.Fatal("missing local result", id, e)
		}
		data, _ := os.ReadFile(filepath.Join(a.Config.DataDir, "media", asset.Path))
		if !bytes.Equal(data, pictures[i]) {
			t.Fatal("wrong saved frame order")
		}
	}
	v := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]any{"title": "完整故事", "body": "同一组连续画面", "media": domain.VersionMedia{Kind: "image", AssetIDs: series.AssetIDs}}, 201))
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions/"+v.ID+"/confirm", nil, 200)
	pub := decode[domain.Publication](t, request(t, a, "POST", "/publications", map[string]string{"version_id": v.ID}, 201))
	if !reflect.DeepEqual(pub.AssetIDs, series.AssetIDs) {
		t.Fatal("whole version reordered frames")
	}
}

func TestImageSeriesValidationAndTextOnlyFallback(t *testing.T) {
	a := testApp(t)
	p, m := seriesFixture(t, a, "none")
	endpoint := "/rewrites/" + p.ID + "/generate-image"
	for _, count := range []any{0, -1, 7, 1.5} {
		request(t, a, "POST", endpoint, map[string]any{"model_id": m.ID, "count": count, "prompt": "test"}, 400)
	}
	request(t, a, "POST", endpoint, map[string]any{"model_id": m.ID, "count": 3, "prompt": "test", "scenes": []string{"one"}}, 400)
	request(t, a, "POST", endpoint, map[string]any{"model_id": m.ID, "count": 2, "prompt": "test", "scenes": []string{strings.Repeat("字", 1001), "two"}}, 400)
	ref := sampleImage(t, a)
	request(t, a, "POST", endpoint, map[string]any{"model_id": m.ID, "count": 2, "reference_asset_ids": []string{ref.ID}}, 400)
	result := decode[map[string]string](t, request(t, a, "POST", endpoint, map[string]any{"model_id": m.ID, "count": 2, "scenes": []string{"海边日出", "落日余晖"}}, 202))
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", result["job_id"])
	original := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = original })
	calls := 0
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if _, ok := body["image"]; ok {
			t.Fatal("sent unsupported image extension")
		}
		if !strings.Contains(asString(body["prompt"]), "海边日出") || !strings.Contains(asString(body["prompt"]), "落日余晖") {
			t.Fatal("story omitted")
		}
		out, _ := json.Marshal(map[string]any{"data": []any{map[string]string{"b64_json": base64.StdEncoding.EncodeToString(seriesPNG(t, uint8(calls)))}}})
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(out))}, nil
	})
	if _, err := a.execute(j); err != nil || calls != 2 {
		t.Fatal(err, calls)
	}
	series, _ := jobImageSeries(j)
	store.Delete(a.Store.DB, "assets", series.AssetIDs[0])
	if _, err := a.execute(j); err == nil || calls != 2 {
		t.Fatal("deleted completed frame recharged", err, calls)
	}
	p2, m2 := seriesFixture(t, a, "generations_image")
	two, three := sampleImage(t, a), sampleImage(t, a)
	request(t, a, "POST", "/rewrites/"+p2.ID+"/generate-image", map[string]any{"model_id": m2.ID, "count": 2, "reference_asset_ids": []string{ref.ID, two.ID, three.ID}}, 400)
}
