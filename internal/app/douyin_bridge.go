package app

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"xhs-workbench/internal/adapter"
)

// One private, long-lived stdio child. No TCP listener or user browser profile.
type douyinBridge struct {
	mu  sync.Mutex
	cmd *exec.Cmd
	in  io.WriteCloser
	out *bufio.Reader
}

func (b *douyinBridge) stop() {
	if b.cmd != nil {
		b.in.Close()
		stopDouyinProcess(b.cmd)
		b.cmd.Wait()
		b.cmd = nil
	}
}
func (a *App) douyinCall(ctx context.Context, op string, args any, result any) error {
	if a.Config.BrowserDisabled && op != "collect" {
		return errors.New("云端抖音扫码和上传暂未启用")
	}
	if a.douyinTest != nil {
		return a.douyinTest(ctx, op, args, result)
	}
	b := &a.douyin
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.cmd == nil {
		script, err := filepath.Abs(filepath.Join(filepath.Dir(a.Config.WebDir), "..", "douyin", "worker.mjs"))
		if err != nil {
			return err
		}
		// web/dist is relative to the project by default.
		if _, err = os.Stat(script); err != nil {
			return errors.New("抖音适配器缺失，请运行 setup.cmd")
		}
		// The Windows service runs without a user PATH. Prefer the bundled
		// runtime beside the installation; local development still uses PATH.
		node := filepath.Join(filepath.Dir(a.Config.WebDir), "..", ".tools", "node", "node.exe")
		if _, err := os.Stat(node); err != nil {
			node = "node"
		}
		cmd := exec.CommandContext(a.ctx, node, script)
		configureDouyinProcess(cmd)
		cmd.Stderr = io.Discard
		in, err := cmd.StdinPipe()
		if err != nil {
			return err
		}
		out, err := cmd.StdoutPipe()
		if err != nil {
			return err
		}
		if err = cmd.Start(); err != nil {
			return errors.New("无法启动抖音适配器，请检查 Node.js 22 和本机 Edge")
		}
		b.cmd = cmd
		b.in = in
		b.out = bufio.NewReaderSize(out, 64<<10)
	}
	payload := map[string]any{"op": op, "args": args}
	sessionPath := filepath.Join(a.Config.DataDir, "douyin.session.dpapi")
	if op == "login" || op == "login_status" || op == "account" || op == "open_browser" || op == "collect" || op == "prepare" {
		if enc, err := os.ReadFile(sessionPath); err == nil {
			plain, err := adapter.Unseal(string(enc))
			if err != nil {
				return errors.New("抖音会话解密失败，请重新扫码")
			}
			payload["storage"] = json.RawMessage(plain)
		}
	}
	type reply struct {
		Data    json.RawMessage `json:"data"`
		Storage json.RawMessage `json:"storage"`
		Error   string          `json:"error"`
		Stage   string          `json:"stage"`
		Reason  string          `json:"reason"`
	}
	var r reply
	done := make(chan error, 1)
	go func() {
		if err := json.NewEncoder(b.in).Encode(payload); err != nil {
			done <- err
			return
		}
		// Cap every protocol frame, including previews and storage, at 12 MiB.
		line := make([]byte, 0, 65536)
		for {
			part, prefix, err := b.out.ReadLine()
			if err != nil {
				done <- err
				return
			}
			line = append(line, part...)
			if len(line) > 12<<20 {
				done <- errors.New("frame too large")
				return
			}
			if !prefix {
				break
			}
		}
		done <- json.Unmarshal(line, &r)
	}()
	select {
	case err := <-done:
		if err != nil {
			b.stop()
			return errors.New("抖音浏览器连接中断，请重新准备；已提交的内容须核实结果")
		}
	case <-ctx.Done():
		b.stop()
		<-done
		return errors.New("抖音操作超时，请检查官方浏览器；提交结果不明时不要重复发布")
	}
	if r.Error != "" {
		return errors.New(douyinFailure(r.Error, r.Stage, r.Reason))
	}
	if len(r.Storage) > 0 && string(r.Storage) != "null" {
		sealed, err := adapter.Seal(string(r.Storage))
		if err != nil {
			return errors.New("保存抖音登录状态失败：Windows DPAPI 不可用")
		}
		if err = os.WriteFile(sessionPath, []byte(sealed), 0600); err != nil {
			return errors.New("保存抖音会话失败")
		}
	}
	if op == "logout" {
		if err := os.Remove(sessionPath); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	if result != nil {
		if json.Unmarshal(r.Data, result) != nil {
			return errors.New("抖音响应格式不正确")
		}
	}
	return nil
}
func douyinError(code string) string {
	messages := map[string]string{
		"browser_unavailable":        "无法启动本机 Edge，请确认已安装 Edge，并运行依赖检查脚本。",
		"login_required":             "请先扫码连接抖音账号；如果二维码不可用，请打开专用官方浏览器完成登录。",
		"qr_unavailable":             "抖音官方登录页的二维码未加载完成，请点击刷新二维码；若仍失败，请打开专用官方浏览器检查网络或完成页面验证。",
		"human_required":             "官方页面要求本人操作，请打开专用官方浏览器完成验证或协议确认，再重新检查。",
		"identity_unverified":        "尚未核实创作者中心账号，或账号与本次稿件确认的不一致。请检查创作者中心登录后重试。",
		"page_changed":               "未能识别官方页面或发布权限。请打开专用官方浏览器检查；不会自动提交。",
		"visibility_control_missing": "未找到可识别的公开范围选项，请查看官方编辑页的“公开／私密”或“谁可以看”控件。",
		"visibility_ambiguous":       "官方编辑页出现多个可见范围选项，无法确定正确控件，已停止操作。",
		"visibility_unverified":      "无法确认官方页面实际选中的公开范围，已阻止继续提交；不会默认改为公开。",
		"publish_entry_unavailable":  "创作者中心的发布入口未加载完成或无法点击，请检查“发布高清视频／发布图文”入口后重试。",
		"publish_entry_ambiguous":    "创作者中心出现多个同名发布入口，工作台无法确定正确入口，已停止操作。",
		"upload_control_missing":     "已点击发布入口，但上传页面未出现可用的文件选择框，请检查页面加载情况。",
		"upload_control_ambiguous":   "上传页面出现多个文件选择框，工作台尚不能区分作品与封面上传位置，已停止上传。",
		"collect_failed":             "未读取到公开视频。请检查链接、网络或在专用官方浏览器完成验证后重试。",
		"collect_network_failed":     "抖音作品页面连接失败或加载超时，请检查网络后重试。",
		"collect_work_unavailable":   "抖音页面提示作品已删除、不存在或暂时无法查看，请确认该作品仍可公开访问。",
		"collect_media_unavailable":  "已读取到作品文案，但未取得对应视频的可下载地址，请确认官方页面能播放后重试。",
		"collect_page_unreadable":    "抖音页面未加载出可识别的作品内容。请在官方页面确认能打开该作品；若要求登录或验证，请本人完成后重试。",
		"collect_resources_blocked":  "抖音作品页面未加载完成，且有页面脚本被采集器的域名检查拦截。请更新工作台后重试；这不表示必须填写 Cookie。",
		"unsupported_media":          "首版只采集抖音公开视频，请使用视频作品链接。",
		"invalid_link":               "请使用抖音官方视频或短链接。",
		"prepare_required":           "预览已失效，请重新准备并确认发布。",
		"editor_mismatch":            "官方编辑器内容、素材或账号发生变化，已阻止提交，请重新准备。",
		"editor_title_mismatch":      "官方页面回读的标题与发布稿不一致，可能尚未保存或被截短。请核对标题后重新准备；具体长度已记录到本地诊断。",
		"editor_caption_mismatch":    "官方页面回读的正文或话题与发布稿不一致。请核对正文是否完整；不会以缺字或内容被修改的文案继续发布。",
		"editor_visibility_mismatch": "官方页面实际可见范围与本次选择不一致，请重新准备并核对公开范围。",
		"editor_media_unverified":    "未能核实与发布稿数量及类型一致的素材预览。请检查视频是否处理完成或图片是否全部上传；这不代表账号发生变化。",
		"editor_media_changed":       "官方页面素材预览与确认时不同，已停止提交，请重新准备并核对视频、图片及顺序。",
		"editor_unavailable":         "这份稿件的官方编辑页已关闭、被其他稿件替换或服务已重启。请重新上传到编辑页；不会打开其他稿件代替。",
		"upload_failed":              "素材上传或封面设置未完成，请检查官方页面后重新准备。",
		"unknown":                    "发布结果不明，请到抖音创作平台核实；不会自动重投。",
	}
	if s, ok := messages[code]; ok {
		return s
	}
	return "抖音网页操作未完成，请检查网络并打开专用官方浏览器查看。"
}

func douyinFailure(code, stage, reason string) string {
	stages := map[string]string{
		"browser_start": "启动专用浏览器", "account_check": "核实创作者账号", "files_check": "检查本地素材", "creator_home": "打开创作者中心首页", "publish_entry": "点击发布入口", "upload_control": "查找上传控件", "upload_files": "上传素材文件", "editor_wait": "等待标题编辑框", "fill_title": "填写标题", "fill_caption": "填写正文", "cover": "设置封面", "visibility": "设置可见性", "upload_finish": "等待上传完成", "editor_verify": "核对编辑器内容", "preview": "生成确认预览",
	}
	reasons := map[string]string{
		"multiple_matches": "页面出现多个匹配控件，无法确定操作位置", "browser_closed": "浏览器或页面已关闭、连接中断", "network": "官方页面连接失败或导航被中断", "timeout": "页面或控件等待超时", "file_access": "本地素材不存在或无法读取", "adapter_incompatible": "浏览器适配接口不兼容",
	}
	message := douyinError(code)
	if label := stages[stage]; label != "" {
		if code == "page_changed" {
			message = "此步骤未完成，请检查对应官方页面；尚不能据此判断账号权限。"
		}
		message = "抖音上传准备失败【" + label + "】：" + message
	}
	if detail := reasons[reason]; detail != "" {
		message += " 原因：" + detail + "。"
	}
	return message
}
