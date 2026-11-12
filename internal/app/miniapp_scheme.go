package app

import (
	"net"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var miniappCloudTicketPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{32}$`)

// Construct links only from this upload's new, short-lived ticket. Trial routing
// mirrors the platform experience QR observed on the developer's device; it does
// not grant experience membership or certify an unpublished build as available.
func miniappSchemeURL(root string, session miniappCloudSession, publicOrigin string, now time.Time) string {
	if session.State != "created" || !miniappCloudTicketPattern.MatchString(session.Ticket) {
		return ""
	}
	expires, err := time.Parse(time.RFC3339, session.ExpiresAt)
	if err != nil || !expires.After(now) || expires.After(now.Add(10*time.Minute)) {
		return ""
	}
	origin, err := url.Parse(publicOrigin)
	if err != nil || origin.Scheme != "https" || origin.Host == "" || origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" || (origin.Path != "" && origin.Path != "/") {
		return ""
	}
	ip := net.ParseIP(origin.Hostname())
	if strings.EqualFold(origin.Hostname(), "localhost") || ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast()) {
		return ""
	}
	var local miniappLocalConfig
	if readMiniappJSON(filepath.Join(root, "config.miniapp.local.json"), &local, true, 4096) != nil || !filepath.IsAbs(local.ProjectPath) || !local.validLaunchEnvironment() {
		return ""
	}
	var project struct {
		AppID string `json:"appid"`
	}
	if readMiniappJSON(filepath.Join(local.ProjectPath, "project.config.json"), &project, false, 256*1024) != nil || !miniappIDPattern.MatchString(project.AppID) {
		return ""
	}
	launchID := project.AppID
	if local.LaunchEnvironment == "trial" {
		launchID += "_trial"
	}
	link := (&url.URL{Scheme: "xhsdiscover", Host: "miniapp", Path: "/" + launchID + "/pages/publish/index",
		RawQuery: url.Values{"scene": []string{session.Ticket}}.Encode()}).String()
	if local.LaunchEnvironment == "trial" {
		return (&url.URL{Scheme: "https", Host: "www.xiaohongshu.com", Path: "/miniapp/status",
			RawQuery: url.Values{"link": []string{link}, "fullscreen": []string{"true"}}.Encode()}).String()
	}
	return link
}
