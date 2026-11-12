package app

import (
	"errors"
	"strings"
	"unicode/utf8"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func titleLimit(p domain.Project) int {
	if p.Platform == "" || p.Platform == "xhs" {
		return 20
	}
	return 200
}
func validateProjectTitle(p domain.Project, title string) error {
	title = strings.TrimSpace(title)
	if title == "" {
		return errors.New("请填写标题")
	}
	if utf8.RuneCountInString(title) > titleLimit(p) {
		if titleLimit(p) == 20 {
			return errors.New("小红书标题不能超过20个字（含标点、空格和表情），请缩短标题")
		}
		return errors.New("标题不能超过200个字")
	}
	return nil
}
func (a *App) validateVersionTitle(v domain.Version) error {
	p, err := store.Get[domain.Project](a.Store.DB, "projects", v.ProjectID)
	if err != nil {
		return err
	}
	return validateProjectTitle(p, v.Title)
}
