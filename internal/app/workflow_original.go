package app

import (
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"strings"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

type workflowOriginalInput struct {
	Title    string   `json:"title"`
	Body     string   `json:"body"`
	Topics   []string `json:"topics"`
	AssetIDs []string `json:"asset_ids"`
}

func (a *App) workflowReference(p *domain.Project) (domain.Revision, error) {
	if p.RevisionID != "" {
		return store.Get[domain.Revision](a.Store.DB, "revisions", p.RevisionID)
	}
	if p.NoteID != "" {
		return domain.Revision{}, errors.New("参考笔记快照不可用")
	}
	rev := domain.Revision{ID: ID(), Kind: p.Kind, Topics: []string{}, AssetIDs: append([]string{}, p.AssetIDs...), CreatedAt: Now()}
	if rev.Kind == "" {
		rev.Kind = "image"
	}
	p.RevisionID = rev.ID
	err := a.Store.Transaction(func(tx *sql.Tx) error {
		if err := store.Put(tx, "revisions", rev.ID, rev); err != nil {
			return err
		}
		return store.Put(tx, "projects", p.ID, *p)
	})
	return rev, err
}

func (a *App) originalInputRevision(p domain.Project, raw json.RawMessage) (domain.Revision, error) {
	var input workflowOriginalInput
	if p.NoteID != "" || json.Unmarshal(raw, &input) != nil {
		return domain.Revision{}, errors.New("创作素材输入无效")
	}
	if len([]rune(input.Title)) > 200 || len([]rune(input.Body)) > 12000 || len(input.Topics) > 30 || len(input.AssetIDs) > 100 {
		return domain.Revision{}, errors.New("标题最多200字，正文最多12000字，话题最多30个，素材最多100份")
	}
	for _, topic := range input.Topics {
		if len([]rune(topic)) > 80 {
			return domain.Revision{}, errors.New("单个话题最多80字")
		}
	}
	kind := "image"
	seen := map[string]bool{}
	for _, id := range input.AssetIDs {
		asset, err := store.Get[domain.Asset](a.Store.DB, "assets", id)
		if err != nil || asset.DeletedAt != "" || asset.Status != "ready" || !slices.Contains([]string{"image", "video"}, asset.Kind) || asset.LibraryState == "result" || asset.LibraryState == "collected" || seen[id] {
			return domain.Revision{}, errors.New("请选择素材库中可用的图片或视频")
		}
		seen[id] = true
		if asset.Kind == "video" {
			kind = "video"
		}
	}
	return domain.Revision{ID: ID(), Title: input.Title, Body: input.Body, Topics: append([]string{}, input.Topics...), AssetIDs: append([]string{}, input.AssetIDs...), Kind: kind, CreatedAt: Now()}, nil
}

func sameOriginalInput(a, b domain.Revision) bool {
	return a.Title == b.Title && a.Body == b.Body && slices.Equal(a.Topics, b.Topics) && slices.Equal(a.AssetIDs, b.AssetIDs)
}

func originalCreationInstructions() string {
	return "\n这是用户原创笔记项目。根据用户提供的创作标题、正文、话题、账号基本信息和补充要求创作，不要求关联采集笔记；未提供的信息不得编造。"
}

func originalInputText(rev domain.Revision) string {
	return "创作标题：" + rev.Title + "\n创作文案：\n" + rev.Body + "\n创作话题：" + strings.Join(rev.Topics, " ")
}
