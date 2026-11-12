package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"xhs-workbench/internal/domain"
)

// Only the workspace process reads this key. It is never included in a draft,
// miniapp bundle, browser response or HTTP error.
type miniappCloudConfig struct {
	ServerURL      string `json:"server_url"`
	ControlKeyFile string `json:"control_key_file"`
	PublicURL      string `json:"public_url,omitempty"`
}

type miniappCloudClient struct {
	base, public, key string
	http              *http.Client
}

type miniappCloudSession struct {
	ID         string `json:"id"`
	State      string `json:"state"`
	ExpiresAt  string `json:"expires_at"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
	Ticket     string `json:"ticket,omitempty"`
	LaunchPath string `json:"launch_path,omitempty"`
	BrowserURL string `json:"browser_url,omitempty"`
}

func readMiniappCloudConfig(root string) (*miniappCloudClient, error) {
	file, err := os.Open(filepath.Join(root, "config.cloud.local.json"))
	if err != nil {
		return nil, errors.New("模拟云端尚未配置，请先启动模拟云端服务")
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, 4097))
	decoder.DisallowUnknownFields()
	var config miniappCloudConfig
	if decoder.Decode(&config) != nil || decoder.Decode(new(any)) != io.EOF {
		return nil, errors.New("模拟云端本地配置无效")
	}
	u, err := url.Parse(config.ServerURL)
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || u.Host == "" ||
		(u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost"))) {
		return nil, errors.New("模拟云端地址需要 HTTPS 或本机回环地址")
	}
	if config.PublicURL == "" {
		config.PublicURL = config.ServerURL
	}
	public, publicErr := url.Parse(config.PublicURL)
	if publicErr != nil || public.Host == "" || public.User != nil || public.RawQuery != "" || public.Fragment != "" || (public.Path != "" && public.Path != "/") ||
		(public.Scheme != "https" && !(public.Scheme == "http" && (public.Hostname() == "127.0.0.1" || public.Hostname() == "localhost"))) {
		return nil, errors.New("模拟云端公开地址需要 HTTPS 或本机回环地址")
	}
	if config.ControlKeyFile == "" {
		return nil, errors.New("模拟云端控制密钥文件尚未配置")
	}
	keyPath := config.ControlKeyFile
	if !filepath.IsAbs(keyPath) {
		keyPath = filepath.Join(root, keyPath)
	}
	keyFile, err := os.Open(keyPath)
	if err != nil {
		return nil, errors.New("无法读取模拟云端控制密钥文件")
	}
	defer keyFile.Close()
	keyBytes, err := io.ReadAll(io.LimitReader(keyFile, 513))
	key := strings.TrimSpace(string(keyBytes))
	if err != nil || len(keyBytes) > 512 || len(key) < 32 || strings.ContainsAny(key, "\r\n\t ") {
		return nil, errors.New("模拟云端控制密钥格式无效")
	}
	return &miniappCloudClient{base: strings.TrimRight(config.ServerURL, "/"), public: strings.TrimRight(config.PublicURL, "/"), key: key,
		http: &http.Client{Timeout: 2 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func (client *miniappCloudClient) request(ctx context.Context, method, path string, body io.Reader, contentType string) (miniappCloudSession, error) {
	var session miniappCloudSession
	req, err := http.NewRequestWithContext(ctx, method, client.base+path, body)
	if err != nil {
		return session, errors.New("无法创建模拟云端请求")
	}
	req.Header.Set("Authorization", "Bearer "+client.key)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	response, err := client.http.Do(req)
	if err != nil {
		return session, errors.New("无法连接模拟云端，请确认服务正在运行")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return session, errors.New("模拟云端拒绝请求，请检查会话状态与本地配置")
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 1<<20))
	if decoder.Decode(&session) != nil || decoder.Decode(new(any)) != io.EOF || !validCloudSession(session) {
		return miniappCloudSession{}, errors.New("模拟云端返回了无效的会话")
	}
	return session, nil
}

func validCloudSession(session miniappCloudSession) bool {
	if session.ID == "" || strings.ContainsAny(session.ID, "/\\?#%") {
		return false
	}
	switch session.State {
	case "created", "scanned", "claimed", "editor_opened", "cancelled", "expired":
	default:
		return false
	}
	_, err := time.Parse(time.RFC3339, session.ExpiresAt)
	return err == nil
}

type miniappCloudFile struct {
	id, path string
}

// Stream files instead of buffering video in memory. The cloud verifies each
// digest against the frozen manifest before committing its own private copy.
func (client *miniappCloudClient) upload(ctx context.Context, snapshot domain.MiniappHandoffSnapshot, expiresAt string, files []miniappCloudFile) (miniappCloudSession, error) {
	reader, writer := io.Pipe()
	form := multipart.NewWriter(writer)
	done := make(chan error, 1)
	go func() {
		err := writeMiniappCloudUpload(form, snapshot, expiresAt, files)
		if err == nil {
			err = form.Close()
		}
		writer.CloseWithError(err)
		done <- err
	}()
	session, err := client.request(ctx, "POST", "/control/sessions", reader, form.FormDataContentType())
	reader.CloseWithError(err)
	writeErr := <-done
	if err != nil {
		return session, err
	}
	if writeErr != nil {
		return session, errors.New("上传交接素材失败")
	}
	return session, nil
}

func writeMiniappCloudUpload(form *multipart.Writer, snapshot domain.MiniappHandoffSnapshot, expiresAt string, files []miniappCloudFile) error {
	manifest, err := form.CreateFormField("manifest")
	if err != nil {
		return err
	}
	if err = json.NewEncoder(manifest).Encode(struct {
		Snapshot  domain.MiniappHandoffSnapshot `json:"snapshot"`
		ExpiresAt string                        `json:"expires_at"`
	}{snapshot, expiresAt}); err != nil {
		return err
	}
	for index, file := range files {
		part, err := form.CreateFormFile("asset_"+file.id, file.id)
		if err != nil {
			return err
		}
		source, err := os.Open(file.path)
		if err != nil {
			return err
		}
		count, copyErr := io.Copy(part, io.LimitReader(source, snapshot.Media[index].Size+1))
		source.Close()
		if copyErr != nil || count != snapshot.Media[index].Size {
			return errors.New("交接素材在上传时发生变化")
		}
	}
	return nil
}
