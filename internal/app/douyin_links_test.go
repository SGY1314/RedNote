package app

import (
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestDouyinJingxuanLinkNormalization(t *testing.T) {
	id := "7677020830546595082"
	canonical := "https://www.douyin.com/video/" + id
	modal := "https://www.douyin.com/jingxuan?modal_id=" + id
	for _, raw := range []string{modal, modal + "&from=web", "https://www.douyin.com/?modal_id=" + id, "https://www.douyin.com/jingxuan/?modal_id=" + id} {
		links := parseLinks(raw)
		if len(links) != 1 || links[0] != canonical {
			t.Fatalf("not normalized: %v", links)
		}
		platform, identity := linkIdentity(raw)
		if platform != "douyin" || identity != id {
			t.Fatal("lost precise work identity")
		}
	}
	if links := parseLinks(modal + " " + canonical); len(links) != 1 {
		t.Fatal("same work queued twice", links)
	}
	for _, raw := range []string{"https://www.douyin.com/jingxuan", modal + "&modal_id=" + id, "https://www.douyin.com/jingxuan?modal_id=bad", "https://douyin.com.evil.test/jingxuan?modal_id=" + id, "https://user@www.douyin.com/jingxuan?modal_id=" + id, "https://v.douyin.com/video/" + id} {
		if len(parseLinks(raw)) != 0 {
			t.Fatal("invalid URL accepted", raw)
		}
	}
	a := testApp(t)
	res := decode[struct {
		Items []struct {
			JobID string `json:"job_id"`
		}
	}](t, request(t, a, "POST", "/collections", map[string]string{"text": modal}, 202))
	j, e := store.Get[domain.Job](a.Store.DB, "jobs", res.Items[0].JobID)
	if e != nil || j.Target != canonical || asString(j.Payload["url"]) != canonical {
		t.Fatal("worker received wrong URL", e)
	}
	n := domain.Note{ID: ID(), NoteID: id, Platform: "douyin", URL: canonical}
	store.Put(a.Store.DB, "notes", n.ID, n)
	duplicate := decode[struct {
		Items []struct {
			NoteID    string `json:"note_id"`
			Duplicate bool   `json:"duplicate"`
		}
	}](t, request(t, a, "POST", "/collections", map[string]string{"text": modal}, 202))
	if !duplicate.Items[0].Duplicate || duplicate.Items[0].NoteID != n.ID {
		t.Fatal("existing work not located")
	}
}

func TestDouyinSearchModalLinks(t *testing.T) {
	id := "7590997226031002619"
	canonical := "https://www.douyin.com/video/" + id
	raw := "https://www.douyin.com/jingxuan/search/%E5%89%AA%E8%BE%91?aid=f0f214a9-b9d2-4da4-9100-54e059616b06&modal_id=" + id + "&type=general"
	for _, input := range []string{raw, "https://www.douyin.com/search/剪辑?modal_id=" + id, "https://www.douyin.com/jingxuan/search/剪辑/?modal_id=" + id} {
		links := parseLinks(input)
		if len(links) != 1 || links[0] != canonical {
			t.Fatalf("search work not normalized: %v", links)
		}
		platform, identity := linkIdentity(input)
		if platform != "douyin" || identity != id {
			t.Fatal("search work identity lost")
		}
	}
	for _, input := range []string{raw + "&modal_id=" + id, "https://www.douyin.com/jingxuan/search/剪辑", "https://www.douyin.com/jingxuan/search/?modal_id=" + id, "https://www.douyin.com/jingxuan/search/%2F?modal_id=" + id, "https://www.douyin.com.evil.test/jingxuan/search/剪辑?modal_id=" + id, "https://user@www.douyin.com/jingxuan/search/剪辑?modal_id=" + id} {
		if len(parseLinks(input)) != 0 {
			t.Fatal("invalid search link accepted", input)
		}
	}
	a := testApp(t)
	res := decode[struct {
		Items []struct {
			JobID string `json:"job_id"`
		}
	}](t, request(t, a, "POST", "/collections", map[string]string{"text": raw + " " + canonical}, 202))
	if len(res.Items) != 1 {
		t.Fatal("search and direct link queued separately")
	}
	j, err := store.Get[domain.Job](a.Store.DB, "jobs", res.Items[0].JobID)
	if err != nil || j.Target != canonical || asString(j.Payload["url"]) != canonical {
		t.Fatal("wrong worker URL", err)
	}
	n := domain.Note{ID: ID(), NoteID: id, Platform: "douyin", URL: canonical}
	if err := store.Put(a.Store.DB, "notes", n.ID, n); err != nil {
		t.Fatal(err)
	}
	duplicate := decode[struct {
		Items []struct {
			NoteID    string `json:"note_id"`
			Duplicate bool   `json:"duplicate"`
		}
	}](t, request(t, a, "POST", "/collections", map[string]string{"text": raw}, 202))
	if len(duplicate.Items) != 1 || !duplicate.Items[0].Duplicate || duplicate.Items[0].NoteID != n.ID {
		t.Fatal("search link did not find existing work")
	}
}
