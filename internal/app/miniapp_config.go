package app

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var miniappIDPattern = regexp.MustCompile(`^[a-zA-Z0-9]{24}$`)

type miniappLocalConfig struct {
	ProjectPath       string `json:"project_path"`
	LaunchEnvironment string `json:"launch_environment,omitempty"`
}

func (config miniappLocalConfig) validLaunchEnvironment() bool {
	return config.LaunchEnvironment == "" || config.LaunchEnvironment == "release" || config.LaunchEnvironment == "trial"
}

func (a *App) mobileRoot() string {
	if a.Config.MobilePublishConfigDir != "" {
		return a.Config.MobilePublishConfigDir
	}
	return "."
}

func readMiniappJSON(path string, value any, strict bool, limit int64) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || int64(len(raw)) > limit {
		return io.ErrUnexpectedEOF
	}
	decoder := json.NewDecoder(bytes.NewReader(bytes.TrimPrefix(raw, []byte{0xef, 0xbb, 0xbf})))
	if strict {
		decoder.DisallowUnknownFields()
	}
	if err = decoder.Decode(value); err != nil {
		return err
	}
	if decoder.Decode(new(any)) != io.EOF {
		return io.ErrUnexpectedEOF
	}
	return nil
}

func (a *App) mobileLaunchConfigured() bool {
	var local miniappLocalConfig
	if readMiniappJSON(filepath.Join(a.mobileRoot(), "config.miniapp.local.json"), &local, true, 4096) != nil || !filepath.IsAbs(local.ProjectPath) || !local.validLaunchEnvironment() {
		return false
	}
	var project struct {
		AppID string `json:"appid"`
	}
	return readMiniappJSON(filepath.Join(local.ProjectPath, "project.config.json"), &project, false, 256*1024) == nil && miniappIDPattern.MatchString(project.AppID)
}

func (a *App) mobilePublicRouteReady(publicURL string) bool {
	now := time.Now()
	sample := miniappCloudSession{State: "created", Ticket: strings.Repeat("a", 32), ExpiresAt: now.Add(5 * time.Minute).UTC().Format(time.RFC3339)}
	return miniappSchemeURL(a.mobileRoot(), sample, publicURL, now) != ""
}
