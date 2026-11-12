package app

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"xhs-workbench/internal/adapter"
)

func TestDouyinPrivateStdioEncryptionAndTimeout(t *testing.T) {
	if _, e := exec.LookPath("node"); e != nil {
		t.Skip("Node not installed")
	}
	a := testApp(t)
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "douyin"), 0700)
	a.Config.WebDir = filepath.Join(root, "web", "dist")
	script := `import readline from 'node:readline';let n=0;for await(const line of readline.createInterface({input:process.stdin})){const m=JSON.parse(line);if(m.op==='hang'){await new Promise(()=>{});continue;}if(m.op==='error'){process.stdout.write(JSON.stringify({error:'secret-cookie-value'})+'\n');continue;}const id=(m.op==='login_status'||m.op==='open_browser')?(m.storage?'restored':'missing'):String(++n);process.stdout.write(JSON.stringify({data:{user_id:id,state:m.op==='login_status'?'creator_connected':'success'},storage:{cookies:[{name:'sessionid',value:'private-test-cookie',domain:'.douyin.com',path:'/',expires:1,httpOnly:true,secure:true,sameSite:'Lax'}],origins:[]}})+'\n');}`
	os.WriteFile(filepath.Join(root, "douyin", "worker.mjs"), []byte(script), 0600)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var result douyinAccount
	if e := a.douyinCall(ctx, "account", nil, &result); e != nil {
		t.Fatal(e)
	}
	if result.UserID != "1" {
		t.Fatal("bad protocol result")
	}
	enc, e := os.ReadFile(filepath.Join(a.Config.DataDir, "douyin.session.dpapi"))
	if e != nil {
		t.Fatal(e)
	}
	if strings.Contains(string(enc), "private-test-cookie") {
		t.Fatal("plaintext session")
	}
	plain, e := adapter.Unseal(string(enc))
	if e != nil || !strings.Contains(plain, "private-test-cookie") {
		t.Fatal("storageState lost")
	}
	if e = a.douyinCall(ctx, "account", nil, &result); e != nil || result.UserID != "2" {
		t.Fatal("child not reused", e)
	}
	a.douyin.stop()
	if e = a.douyinCall(ctx, "login_status", nil, &result); e != nil || result.UserID != "restored" || result.State != "creator_connected" {
		t.Fatal("intermediate scan session was not restored", e, result)
	}
	a.douyin.stop()
	if e = a.douyinCall(ctx, "open_browser", map[string]string{"target": "main"}, &result); e != nil || result.UserID != "restored" {
		t.Fatal("dedicated browser did not receive saved scan session", e, result)
	}
	if e = a.douyinCall(ctx, "error", nil, &result); e == nil || strings.Contains(e.Error(), "secret-cookie-value") {
		t.Fatal("untrusted error leaked")
	}
	short, stop := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer stop()
	if e = a.douyinCall(short, "hang", nil, &result); e == nil {
		t.Fatal("missing timeout")
	}
	if a.douyin.cmd != nil {
		t.Fatal("timed out child reused")
	}
}

func TestDouyinFailureStageAndPrivacy(t *testing.T) {
	s := douyinFailure("page_changed", "creator_home", "network")
	if !strings.Contains(s, "打开创作者中心首页") || !strings.Contains(s, "导航被中断") || strings.Contains(s, "或发布权限") {
		t.Fatal("failure stage lost", s)
	}
	if strings.Contains(douyinFailure("SECRET", "SECRET", "SECRET"), "SECRET") {
		t.Fatal("untrusted browser message leaked")
	}
	if !strings.Contains(douyinFailure("human_required", "publish_entry", ""), "本人操作") {
		t.Fatal("human verification instruction lost")
	}
}

func TestDouyinEditorVerificationErrors(t *testing.T) {
	for code, field := range map[string]string{
		"editor_title_mismatch": "标题", "editor_caption_mismatch": "正文",
		"editor_visibility_mismatch": "可见范围", "editor_media_unverified": "素材预览",
		"editor_media_changed": "素材预览",
	} {
		message := douyinFailure(code, "editor_verify", "")
		if !strings.Contains(message, "核对编辑器内容") || !strings.Contains(message, field) || strings.Contains(message, "内容、素材或账号发生变化") {
			t.Fatalf("wrong editor diagnostic for %s: %s", code, message)
		}
	}
}
