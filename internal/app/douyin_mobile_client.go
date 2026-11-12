package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// This configuration and both credential files are server-only, never web assets.
type douyinMobileConfig struct {
	ServerURL         string `json:"server_url"`
	ControlKeyFile    string `json:"control_key_file"`
	AppID             string `json:"app_id"`
	AppSecretFile     string `json:"app_secret_file"`
	StorageHost       string `json:"storage_host"`
	LaunchEnvironment string `json:"launch_environment"`
}
type douyinMobileClient struct {
	config      douyinMobileConfig
	key, secret string
	http        *http.Client
}
type douyinMobileSession struct {
	ID        string `json:"id"`
	State     string `json:"state"`
	ExpiresAt string `json:"expiresAt"`
}
type douyinMobileUpload struct {
	AssetID   string `json:"assetId"`
	URL       string `json:"url"`
	ExpiresAt string `json:"expiresAt"`
}
type douyinMobileReply struct {
	Session      douyinMobileSession  `json:"session"`
	Ticket       string               `json:"ticket"`
	Uploads      []douyinMobileUpload `json:"uploads"`
	Cancelled    bool                 `json:"cancelled"`
	ClientResult *struct {
		Event string `json:"event"`
	} `json:"clientResult"`
}

var dyIdentifier = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
var dyCredential = regexp.MustCompile(`^[A-Za-z0-9_-]{24,512}$`)

func readDouyinMobileConfig(root string) (*douyinMobileClient, error) {
	var cfg douyinMobileConfig
	if readMiniappJSON(filepath.Join(root, "config.douyin.local.json"), &cfg, true, 8192) != nil {
		return nil, errors.New("抖音扫码发布尚未配置，请配置 config.douyin.local.json")
	}
	u, err := url.Parse(cfg.ServerURL)
	if cfg.LaunchEnvironment == "" {
		cfg.LaunchEnvironment = "production"
	}
	if cfg.LaunchEnvironment != "production" && cfg.LaunchEnvironment != "development" {
		return nil, errors.New("抖音启动环境仅支持 development 或 production")
	}
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, errors.New("抖音云服务地址必须为 HTTPS 源站")
	}
	if !regexp.MustCompile(`^tt[a-zA-Z0-9]{16,30}$`).MatchString(cfg.AppID) || !regexp.MustCompile(`^[a-z0-9.-]+\.volces\.com$`).MatchString(cfg.StorageHost) {
		return nil, errors.New("抖音小程序或存储域名配置无效")
	}
	readKey := func(name string) (string, error) {
		if name == "" {
			return "", errors.New("抖音服务密钥文件未配置")
		}
		if !filepath.IsAbs(name) {
			name = filepath.Join(root, name)
		}
		f, e := os.Open(name)
		if e != nil {
			return "", errors.New("无法读取抖音服务密钥文件")
		}
		defer f.Close()
		b, e := io.ReadAll(io.LimitReader(f, 1025))
		s := strings.TrimSpace(string(b))
		if e != nil || len(b) > 1024 || len(s) < 16 || strings.ContainsAny(s, " \r\n\t") {
			return "", errors.New("抖音服务密钥格式无效")
		}
		return s, nil
	}
	key, err := readKey(cfg.ControlKeyFile)
	if err != nil {
		return nil, err
	}
	if len(key) < 32 {
		return nil, errors.New("抖音控制密钥长度不足")
	}
	secret, err := readKey(cfg.AppSecretFile)
	if err != nil {
		return nil, err
	}
	cfg.ServerURL = strings.TrimRight(cfg.ServerURL, "/")
	return &douyinMobileClient{config: cfg, key: key, secret: secret, http: &http.Client{Timeout: 2 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func (d *douyinMobileClient) json(ctx context.Context, endpoint string, body any, headers map[string]string, out any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return errors.New("抖音请求格式无效")
	}
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(raw))
	if err != nil {
		return errors.New("无法创建抖音请求")
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := d.http.Do(req)
	if err != nil {
		return errors.New("抖音服务连接失败，请检查服务状态")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("抖音服务拒绝请求（HTTP %d）", res.StatusCode)
	}
	dec := json.NewDecoder(io.LimitReader(res.Body, 3<<20))
	if dec.Decode(out) != nil || dec.Decode(new(any)) != io.EOF {
		return errors.New("抖音服务返回格式无效")
	}
	return nil
}
func (d *douyinMobileClient) control(ctx context.Context, action string, body any) (douyinMobileReply, error) {
	var envelope struct {
		Code *int              `json:"code"`
		Data douyinMobileReply `json:"data"`
	}
	err := d.json(ctx, d.config.ServerURL+"/v1/douyin/control/"+action, body, map[string]string{"Authorization": "Bearer " + d.key}, &envelope)
	if err != nil {
		return envelope.Data, err
	}
	if envelope.Code == nil || *envelope.Code != 0 {
		return envelope.Data, errors.New("抖音云交接操作未成功")
	}
	return envelope.Data, nil
}
func validDouyinSession(s douyinMobileSession) bool {
	if !dyIdentifier.MatchString(s.ID) {
		return false
	}
	if _, e := time.Parse(time.RFC3339Nano, s.ExpiresAt); e != nil {
		return false
	}
	switch s.State {
	case "uploading", "ready", "claimed", "editor_opened", "cancelled":
		return true
	}
	return false
}
func (d *douyinMobileClient) upload(ctx context.Context, u douyinMobileUpload, path string, size int64) error {
	parsed, err := url.Parse(u.URL)
	expiry, e := time.Parse(time.RFC3339Nano, u.ExpiresAt)
	if err != nil || e != nil || !expiry.After(time.Now()) || parsed.Scheme != "https" || parsed.Host != d.config.StorageHost || parsed.User != nil || parsed.Fragment != "" {
		return errors.New("抖音上传地址无效")
	}
	f, err := os.Open(path)
	if err != nil {
		return errors.New("无法读取发布视频")
	}
	defer f.Close()
	req, err := http.NewRequestWithContext(ctx, "PUT", u.URL, io.LimitReader(f, size))
	if err != nil {
		return errors.New("无法创建视频上传请求")
	}
	req.ContentLength = size
	req.Header.Set("Content-Type", "video/mp4")
	res, err := d.http.Do(req)
	if err != nil {
		return errors.New("视频上传未能确认")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return errors.New("视频上传失败，请检查对象存储配置")
	}
	return nil
}

// Official QR endpoint generates the platform's code, never an invented schema.
// It uses the published miniapp; preview/trial QR still comes from the IDE.
func (d *douyinMobileClient) qrcode(ctx context.Context, ticket string) (string, error) {
	if !dyCredential.MatchString(ticket) {
		return "", errors.New("抖音任务票据无效")
	}
	var token struct {
		Data struct {
			Token     string `json:"access_token"`
			ErrorCode int    `json:"error_code"`
		} `json:"data"`
	}
	err := d.json(ctx, "https://open.douyin.com/oauth/stable_client_token/", map[string]string{"client_key": d.config.AppID, "client_secret": d.secret, "grant_type": "client_credential"}, nil, &token)
	if err != nil {
		return "", err
	}
	if token.Data.ErrorCode != 0 || token.Data.Token == "" {
		return "", fmt.Errorf("获取抖音二维码凭证失败（平台码 %d）", token.Data.ErrorCode)
	}
	var qr struct {
		ErrNo int `json:"err_no"`
		Data  struct {
			Image string `json:"img"`
		} `json:"data"`
	}
	err = d.json(ctx, "https://open.douyin.com/api/apps/v1/qrcode/create/", map[string]any{"appid": d.config.AppID, "app_name": "douyin", "path": url.QueryEscape("pages/publish/index?ticket=" + ticket), "width": 460, "set_icon": false}, map[string]string{"access-token": token.Data.Token}, &qr)
	if err != nil {
		return "", err
	}
	if qr.ErrNo != 0 {
		return "", fmt.Errorf("生成抖音官方二维码失败（平台码 %d），请核对小程序已上线版本和二维码权限", qr.ErrNo)
	}
	data, err := base64.StdEncoding.DecodeString(qr.Data.Image)
	if err != nil || len(data) < 8 || len(data) > 2<<20 {
		return "", errors.New("抖音返回的二维码图片无效")
	}
	mime := http.DetectContentType(data)
	if mime != "image/png" && mime != "image/jpeg" {
		return "", errors.New("抖音返回的二维码格式不支持")
	}
	return "data:" + mime + ";base64," + qr.Data.Image, nil
}
