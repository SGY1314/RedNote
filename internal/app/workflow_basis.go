package app

import (
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

type workflowBasis struct {
	Title workflowTitle `json:"title"`
	Copy  workflowCopy  `json:"copy"`
}

// Source defaults are a read view, never confirmations. Each module may start
// independently; an explicitly saved title or copy replaces its source default.
func workflowBasisFor(p domain.Project, w creationWorkflow, rev domain.Revision) workflowBasis {
	basis := workflowBasis{Title: w.Title, Copy: w.Copy}
	if basis.Title.Key == "" {
		id := rev.ID
		if id == "" {
			id = p.ID
		}
		basis.Title = workflowTitle{Key: "source-title-" + id, Text: rev.Title}
	}
	if basis.Copy.Key == "" {
		basis.Copy.Body = rev.Body
		basis.Copy.Topics = append([]string{}, rev.Topics...)
	}
	if basis.Copy.Key == "" || basis.Copy.TitleKey != basis.Title.Key {
		digest := sha256.Sum256([]byte(p.RevisionID + "\n" + basis.Title.Key + "\n" + w.Copy.Key))
		basis.Copy.Key = fmt.Sprintf("source-copy-%x", digest[:16])
	}
	basis.Copy.TitleKey = basis.Title.Key
	return basis
}

func (a *App) readWorkflowBasis(p domain.Project, w creationWorkflow) (workflowBasis, error) {
	rev := domain.Revision{}
	var err error
	if p.RevisionID != "" {
		rev, err = store.Get[domain.Revision](a.Store.DB, "revisions", p.RevisionID)
		if err != nil {
			return workflowBasis{}, err
		}
	}
	return workflowBasisFor(p, w, rev), nil
}

// Legacy projects without a workflow keep their original input protocol.
func (a *App) storedWorkflowBasis(id string) (workflowBasis, error) {
	w, err := store.Get[creationWorkflow](a.Store.DB, "creation_workflows", id)
	if errors.Is(err, sql.ErrNoRows) {
		return workflowBasis{}, nil
	}
	if err != nil {
		return workflowBasis{}, err
	}
	p, err := store.Get[domain.Project](a.Store.DB, "projects", id)
	if err != nil {
		return workflowBasis{}, err
	}
	return a.readWorkflowBasis(p, w)
}
