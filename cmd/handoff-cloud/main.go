// handoff-cloud runs a development-only resource relay, isolated from the
// workbench, collectors and all Xiaohongshu account/publishing operations.
package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"xhs-workbench/internal/handoffcloud"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "handoff-cloud:", err)
		os.Exit(1)
	}
}

func run() error {
	addr := flag.String("addr", "127.0.0.1:8083", "Desktop control listener (loopback only)")
	publicAddr := flag.String("public-addr", "", "Optional separate development receiver listener; control routes are excluded")
	publicURL := flag.String("public-url", "http://127.0.0.1:8083", "Receiver origin visible to clients; HTTPS is required on public hosts")
	data := flag.String("data", "data/mock-cloud", "Dedicated resource directory, separate from the workbench database")
	keyFile := flag.String("control-key-file", "", "Server-only shared key file (defaults to <data>/control.key)")
	flag.Parse()
	if flag.NArg() != 0 {
		return errors.New("unexpected arguments")
	}
	if !loopbackAddress(*addr) {
		return errors.New("desktop control listener must bind to a loopback address")
	}
	if *publicAddr != "" && !loopbackAddress(*publicAddr) {
		return errors.New("receiver listener must bind to loopback; use an explicit HTTPS proxy for physical devices")
	}
	if *keyFile == "" {
		*keyFile = filepath.Join(*data, "control.key")
	}
	key, err := readOrCreateKey(*keyFile)
	if err != nil {
		return err
	}
	service, err := handoffcloud.New(handoffcloud.Config{DataDir: *data, PublicURL: *publicURL, ControlKey: key})
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		return err
	}
	defer listener.Close()
	servers := []*http.Server{httpServer(service.Handler())}
	listeners := []net.Listener{listener}
	if *publicAddr != "" {
		publicListener, err := net.Listen("tcp", *publicAddr)
		if err != nil {
			return err
		}
		defer publicListener.Close()
		servers = append(servers, httpServer(service.PublicHandler()))
		listeners = append(listeners, publicListener)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	errorsCh := make(chan error, len(servers))
	for i, server := range servers {
		go func() {
			err := server.Serve(listeners[i])
			if !errors.Is(err, http.ErrServerClosed) {
				errorsCh <- err
			}
		}()
	}
	fmt.Println("Development resource handoff is ready at", *publicURL)
	fmt.Println("Official publishing is disabled. Control credentials and receivers are never logged.")
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			for _, server := range servers {
				_ = server.Shutdown(shutdown)
			}
			return nil
		case err := <-errorsCh:
			return err
		case <-ticker.C:
			if err := service.PruneExpired(); err != nil {
				fmt.Fprintln(os.Stderr, "Expired resource cleanup will retry")
			}
		}
	}
}

func loopbackAddress(address string) bool {
	host, _, err := net.SplitHostPort(address)
	return err == nil && (host == "localhost" || (net.ParseIP(host) != nil && net.ParseIP(host).IsLoopback()))
}

func httpServer(handler http.Handler) *http.Server {
	return &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 3 * time.Minute, WriteTimeout: 3 * time.Minute, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
}

func readOrCreateKey(path string) (string, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return "", err
	}
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		data := make([]byte, 32)
		if _, err := rand.Read(data); err != nil {
			return "", err
		}
		file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return "", err
		}
		_, writeErr := file.WriteString(base64.RawURLEncoding.EncodeToString(data))
		closeErr := file.Close()
		if writeErr != nil {
			return "", writeErr
		}
		if closeErr != nil {
			return "", closeErr
		}
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > 4096 {
		return "", errors.New("control key file is missing or invalid")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	key := strings.TrimSpace(string(data))
	if len(key) < 32 {
		return "", errors.New("control key is too short")
	}
	return key, nil
}
