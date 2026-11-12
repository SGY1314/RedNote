package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"time"
	"xhs-workbench/internal/app"
)

func main() {
	configPath := flag.String("config", "config/local.json", "configuration file")
	flag.Parse()
	cfg := app.Config{Listen: "127.0.0.1:8080", DataDir: "data", CollectorURL: "http://127.0.0.1:5556", WebDir: "web/dist"}
	if b, e := os.ReadFile(*configPath); e == nil {
		if e = json.Unmarshal(b, &cfg); e != nil {
			log.Fatal("配置文件格式错误")
		}
	}
	if !strings.HasPrefix(cfg.Listen, "127.0.0.1:") {
		log.Fatal("仅允许监听 127.0.0.1")
	}
	a, e := app.NewMulti(cfg)
	if e != nil {
		log.Fatal(e)
	}
	defer a.Close()
	listener, e := net.Listen("tcp", cfg.Listen)
	if e != nil {
		log.Print("监听失败：", e)
		return
	}
	// User workspaces start their own workers on first access.
	server := &http.Server{Addr: cfg.Listen, Handler: a.Router(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt)
	go func() {
		select {
		case <-done:
		case <-a.StopRequested:
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		server.Shutdown(ctx)
	}()
	log.Printf("工作台已启动：http://%s", cfg.Listen)
	if e = server.Serve(listener); e != http.ErrServerClosed {
		log.Fatal(e)
	}
}

