package app

import (
	"encoding/json"
	"github.com/gorilla/websocket"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"xhs-workbench/internal/adapter"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestCompatibleTextAndOCRAdapters(t *testing.T) {
	a := testApp(t)
	calls := 0
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/chat/completions" || r.Header.Get("Authorization") != "Bearer fixture-only-key" {
			t.Error("invalid text adapter contract")
		}
		var input map[string]any
		json.NewDecoder(r.Body).Decode(&input)
		content := "识别到的文字"
		if input["model"] == "fixture-text" {
			content = `{"title":"模拟生成标题","body":"这段结果来自模拟服务。","topics":["测试"]}`
		} else {
			if !strings.Contains(jsonString(input["messages"]), "data:image/png;base64,") {
				t.Error("OCR did not send local image bytes")
			}
		}
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": content}, "finish_reason": "stop"}}})
	}))
	defer mock.Close()
	sealed, e := adapter.Seal("fixture-only-key")
	if e != nil {
		t.Skip(e)
	}
	s := a.settings()
	s.Text = domain.Service{BaseURL: mock.URL, Model: "fixture-text", Secret: sealed}
	s.OCR = domain.Service{BaseURL: mock.URL, Model: "fixture-ocr", Secret: sealed}
	store.Put(a.Store.DB, "settings", "services", s)
	p := domain.Project{ID: ID(), Name: "模拟", Sources: []domain.Source{}}
	store.Put(a.Store.DB, "projects", p.ID, p)
	id, e := a.runRewrite(newJob("rewrite", p.ID, map[string]any{"source": "参考素材", "source_ids": []string{"original"}, "instructions": "写简洁文案"}))
	if e != nil {
		t.Fatal(e)
	}
	v, _ := store.Get[domain.Version](a.Store.DB, "versions", id)
	if v.Title != "模拟生成标题" || v.Status != "draft" {
		t.Fatal("rewrite not persisted correctly")
	}
	asset := sampleImage(t, a)
	id, e = a.runOCR(newJob("ocr", asset.ID, nil))
	if e != nil {
		t.Fatal(e)
	}
	x, _ := store.Get[domain.Extraction](a.Store.DB, "extractions", id)
	if x.Text != "识别到的文字" || x.Original != x.Text {
		t.Fatal("OCR result missing")
	}
	if calls != 2 {
		t.Fatal("unexpected provider retry")
	}
}
func TestASRWebSocketStreamingContract(t *testing.T) {
	if _, e := exec.LookPath("ffmpeg"); e != nil {
		t.Skip("FFmpeg not installed")
	}
	a := testApp(t)
	sealed, e := adapter.Seal("fixture-only-key")
	if e != nil {
		t.Skip(e)
	}
	upgrader := websocket.Upgrader{}
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, e := upgrader.Upgrade(w, r, nil)
		if e != nil {
			return
		}
		defer conn.Close()
		var req map[string]any
		if e = conn.ReadJSON(&req); e != nil {
			t.Error(e)
			return
		}
		payload := req["payload"].(map[string]any)
		if payload["model"] != "paraformer-realtime-v2" {
			t.Error("ASR model mismatch")
		}
		conn.WriteJSON(map[string]any{"header": map[string]string{"event": "task-started"}})
		bytesReceived := 0
		for {
			kind, b, e := conn.ReadMessage()
			if e != nil {
				return
			}
			if kind == websocket.BinaryMessage {
				bytesReceived += len(b)
				continue
			}
			var finish map[string]any
			json.Unmarshal(b, &finish)
			if finish["header"].(map[string]any)["action"] == "finish-task" {
				break
			}
		}
		if bytesReceived == 0 {
			t.Error("audio stream missing")
		}
		conn.WriteJSON(map[string]any{"header": map[string]string{"event": "result-generated"}, "payload": map[string]any{"output": map[string]any{"sentence": map[string]any{"begin_time": 0, "end_time": 200, "sentence_end": true, "text": "模拟转写"}}}})
		conn.WriteJSON(map[string]any{"header": map[string]string{"event": "task-finished"}})
	}))
	defer mock.Close()
	s := a.settings()
	s.ASR = domain.Service{BaseURL: strings.Replace(mock.URL, "http://", "ws://", 1), Model: "paraformer-realtime-v2", Secret: sealed}
	store.Put(a.Store.DB, "settings", "services", s)
	p := filepath.Join(a.Config.DataDir, "media", "asr-fixture.wav")
	if out, e := exec.Command("ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.2", "-ar", "16000", p).CombinedOutput(); e != nil {
		t.Fatalf("audio fixture: %v %s", e, out)
	}
	asset := domain.Asset{ID: ID(), Kind: "video", Path: "asr-fixture.wav", Status: "ready", Duration: 0.2}
	store.Put(a.Store.DB, "assets", asset.ID, asset)
	id, e := a.runASR(newJob("asr", asset.ID, nil))
	if e != nil {
		t.Fatal(e)
	}
	x, _ := store.Get[domain.Extraction](a.Store.DB, "extractions", id)
	if len(x.Segments) != 1 || x.Segments[0].EndMS != 200 || x.Text != "模拟转写" {
		t.Fatal("timed transcript missing")
	}
	os.Remove(p)
}
