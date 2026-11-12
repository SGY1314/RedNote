package app

import (
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"strings"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

type workflowReferenceInput struct {
	PolicyVersion int      `json:"policy_version,omitempty"`
	TitleSource   string   `json:"title_source,omitempty"`
	BodySource    string   `json:"body_source,omitempty"`
	Title         string   `json:"title"`
	Body          string   `json:"body"`
	Topics        []string `json:"topics"`
	UseTitle      bool     `json:"use_title"`
	UseBody       bool     `json:"use_body"`
	UseImages     bool     `json:"use_images"`
	AssetIDs      []string `json:"asset_ids"`
}

func referenceInputFor(w creationWorkflow, scope string) *workflowReferenceInput {
	var d struct {
		Reference *workflowReferenceInput `json:"reference_input"`
	}
	_ = json.Unmarshal(w.Drafts[scope].Data, &d)
	return d.Reference
}

// Upgrade former shared defaults once. Distinct manual text is left intact.
func migrateTextReferences(w *creationWorkflow, rev domain.Revision) error {
	for _, scope := range []string{"title", "copy"} {
		r := referenceInputFor(*w, scope)
		if r == nil || r.PolicyVersion >= 1 {
			continue
		}
		if scope == "title" && w.Title.Key != "" && r.Title == w.Title.Text {
			r.Title = rev.Title
		}
		if scope == "copy" && w.Copy.Key != "" && r.Body == w.Copy.Body {
			r.Body = rev.Body
			if strings.Join(r.Topics, "\x00") == strings.Join(w.Copy.Topics, "\x00") {
				r.Topics = append([]string{}, rev.Topics...)
			}
		}
		r.PolicyVersion = 1
		d := w.Drafts[scope]
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(d.Data, &fields); err != nil {
			return err
		}
		raw, err := json.Marshal(r)
		if err != nil {
			return err
		}
		fields["reference_input"] = raw
		d.Data, err = json.Marshal(fields)
		if err != nil {
			return err
		}
		d.Revision++
		d.SavedAt = Now()
		w.Drafts[scope] = d
	}
	return nil
}
func (r *workflowReferenceInput) text() string {
	if r == nil {
		return ""
	}
	parts := []string{}
	if r.UseTitle {
		parts = append(parts, "参考标题："+r.Title)
	}
	if r.UseBody {
		parts = append(parts, "参考文案："+r.Body, "参考话题："+strings.Join(r.Topics, " "))
	}
	return strings.Join(parts, "\n")
}
func (a *App) referenceInputImages(p domain.Project, r *workflowReferenceInput) ([]imageReference, error) {
	if r == nil {
		return nil, nil
	}
	if len([]rune(r.Title)) > 200 || len([]rune(r.Body)) > 12000 || len(r.Topics) > 30 || len(r.AssetIDs) > 10 {
		return nil, errors.New("参考内容过长或图片超过10张")
	}
	if !r.UseImages {
		return []imageReference{}, nil
	}
	if err := a.validateWorkflowReferences(p, r.AssetIDs); err != nil {
		return nil, err
	}
	refs := []imageReference{}
	seen := map[string]bool{}
	for _, id := range r.AssetIDs {
		v, e := store.Get[domain.Asset](a.Store.DB, "assets", id)
		if e != nil || v.DeletedAt != "" || seen[id] {
			return nil, errors.New("参考图片不可用或重复")
		}
		seen[id] = true
		ref, _, e := a.readImageReference(id, "")
		if e != nil {
			return nil, e
		}
		refs = append(refs, ref)
	}
	return refs, nil
}
func (a *App) referenceChatContent(text string, payload map[string]any) (any, error) {
	refs, err := jobImageReferences(domain.Job{Payload: payload})
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		return text, nil
	}
	content := []any{map[string]any{"type": "text", "text": text}}
	for _, ref := range refs {
		_, uri, e := a.readImageReference(ref.ID, ref.SHA256)
		if e != nil {
			return nil, e
		}
		content = append(content, map[string]any{"type": "image_url", "image_url": map[string]string{"url": uri}})
	}
	return content, nil
}
func (a *App) defaultProfileGet(c *gin.Context) {
	v, _ := store.Get[workflowAccountFields](a.Store.DB, "settings", "default-account-profile")
	c.JSON(200, v)
}
func (a *App) defaultProfilePut(c *gin.Context) {
	var v workflowAccountFields
	if !bind(c, &v) {
		return
	}
	v, err := normalizeWorkflowAccount(v)
	if err != nil {
		bad(c, err)
		return
	}
	if err = store.Put(a.Store.DB, "settings", "default-account-profile", v); err != nil {
		bad(c, err)
		return
	}
	c.JSON(200, v)
}

// Each text stage keeps its own original field and consumes the other confirmed field.
// Preserve each stage's switches, images and other draft fields.
func (a *App) syncConfirmedReferences(w *creationWorkflow, rev domain.Revision, step string, content domain.Content) error {
	if step != "title" && step != "copy" {
		return nil
	}
	for _, scope := range []string{"title", "copy", "image", "video-script"} {
		if scope == step {
			continue
		}
		draft := w.Drafts[scope]
		fields := map[string]json.RawMessage{}
		if len(draft.Data) > 0 {
			if err := json.Unmarshal(draft.Data, &fields); err != nil {
				return err
			}
		}
		if fields == nil {
			fields = map[string]json.RawMessage{}
		}
		selection := referenceInputFor(*w, scope)
		if selection == nil {
			ids := []string{}
			for _, id := range rev.AssetIDs {
				if asset, err := store.Get[domain.Asset](a.Store.DB, "assets", id); err == nil && asset.Kind == "image" && asset.Status == "ready" && asset.DeletedAt == "" {
					ids = append(ids, id)
				}
			}
			if len(ids) > 3 {
				ids = ids[:3]
			}
			title, body, topics := rev.Title, rev.Body, rev.Topics
			titleSource, bodySource := "original", "original"
			if scope != "title" && w.Title.Key != "" {
				title = w.Title.Text
				titleSource = "rewritten"
			}
			if scope != "copy" && w.Copy.Key != "" {
				body, topics = w.Copy.Body, w.Copy.Topics
				bodySource = "rewritten"
			}
			selection = &workflowReferenceInput{PolicyVersion: 1, TitleSource: titleSource, BodySource: bodySource, Title: title, Body: body, Topics: topics, UseTitle: title != "", UseBody: body != "", UseImages: true, AssetIDs: ids}
		}
		if step == "title" {
			selection.Title = content.Title
			selection.TitleSource = "rewritten"
		} else {
			selection.Body = content.Body
			selection.BodySource = "rewritten"
			selection.Topics = append([]string{}, content.Topics...)
		}
		raw, err := json.Marshal(selection)
		if err != nil {
			return err
		}
		if string(fields["reference_input"]) == string(raw) {
			continue
		}
		fields["reference_input"] = raw
		draft.Data, err = json.Marshal(fields)
		if err != nil {
			return err
		}
		draft.Revision++
		draft.SavedAt = Now()
		w.Drafts[scope] = draft
	}
	return nil
}
