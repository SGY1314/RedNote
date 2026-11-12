// HTTPS authentication boundary for the single-user cloud deployment.
package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type credentials struct {
	Username     string `json:"username"`
	PasswordHash string `json:"password_hash"`
}
type attempt struct {
	Count int
	Until time.Time
}
type limiter struct {
	sync.Mutex
	Entries map[string]attempt
}

func (l *limiter) allow(ip string) bool {
	l.Lock()
	defer l.Unlock()
	now := time.Now()
	if len(l.Entries) > 10000 {
		for k, v := range l.Entries {
			if now.After(v.Until) {
				delete(l.Entries, k)
			}
		}
		if len(l.Entries) > 10000 {
			return false
		}
	}
	a := l.Entries[ip]
	if now.After(a.Until) {
		a = attempt{Until: now.Add(time.Minute)}
	}
	a.Count++
	l.Entries[ip] = a
	return a.Count <= 12
}
func gatewayHandler(creds *credentials, origin string, proxy http.Handler) http.Handler {
	limits := &limiter{Entries: make(map[string]attempt)}
	var cacheMu sync.RWMutex
	var cached [32]byte
	var hasCache bool
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		if creds != nil {
			user, password, ok := r.BasicAuth()
			if !ok {
				w.Header().Set("WWW-Authenticate", `Basic realm="Workbench", charset="UTF-8"`)
				http.Error(w, "Authentication required", 401)
				return
			}
			digest := sha256.Sum256([]byte(r.Header.Get("Authorization")))
			cacheMu.RLock()
			known := hasCache && subtle.ConstantTimeCompare(digest[:], cached[:]) == 1
			cacheMu.RUnlock()
			if !known {
				ip, _, _ := net.SplitHostPort(r.RemoteAddr)
				if !limits.allow(ip) {
					w.Header().Set("Retry-After", "60")
					http.Error(w, "Too many requests; retry in one minute", 429)
					return
				}
				if subtle.ConstantTimeCompare([]byte(user), []byte(creds.Username)) != 1 || bcrypt.CompareHashAndPassword([]byte(creds.PasswordHash), []byte(password)) != nil {
					w.Header().Set("WWW-Authenticate", `Basic realm="Workbench", charset="UTF-8"`)
					http.Error(w, "Invalid credentials", 401)
					return
				}
				cacheMu.Lock()
				cached = digest
				hasCache = true
				cacheMu.Unlock()
				limits.Lock()
				delete(limits.Entries, ip)
				limits.Unlock()
			}
		}
		if o := r.Header.Get("Origin"); o != "" && o != origin {
			http.Error(w, "Origin denied", 403)
			return
		}
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			http.Error(w, "Cross-site request denied", 403)
			return
		}
		r.Header.Del("Authorization")
		r.Header.Del("Forwarded")
		r.Header.Del("X-Forwarded-For")
		r.Header.Del("X-Forwarded-Host")
		r.Header.Del("X-Forwarded-Proto")
		proxy.ServeHTTP(w, r)
	})
}
func main() {
	listen := flag.String("listen", ":8443", "HTTPS listen address")
	upstream := flag.String("upstream", "http://127.0.0.1:8080", "loopback workbench")
	origin := flag.String("origin", "", "exact public HTTPS origin")
	cert := flag.String("cert", "deploy/private/tls.crt", "TLS certificate")
	key := flag.String("key", "deploy/private/tls.key", "TLS key")
	auth := flag.String("auth", "deploy/private/auth.json", "bcrypt credentials")
	noAuth := flag.Bool("no-auth", false, "disable HTTP Basic authentication")
	hash := flag.Bool("hash-password", false, "hash password read from stdin")
	flag.Parse()
	if *hash {
		b, e := io.ReadAll(io.LimitReader(os.Stdin, 1024))
		if e != nil {
			log.Fatal("Unable to read password")
		}
		h, e := bcrypt.GenerateFromPassword([]byte(strings.TrimSpace(string(b))), 12)
		if e != nil {
			log.Fatal("Invalid password")
		}
		fmt.Print(string(h))
		return
	}
	u, e := url.Parse(*upstream)
	if e != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" {
		log.Fatal("Upstream must be loopback HTTP")
	}
	public, e := url.Parse(*origin)
	if e != nil || public.Scheme != "https" || public.Host == "" || public.Path != "" || public.User != nil || public.RawQuery != "" || public.Fragment != "" {
		log.Fatal("Explicit HTTPS origin is required")
	}
	var creds *credentials
	if !*noAuth {
		var loaded credentials
		b, e := os.ReadFile(*auth)
		if e != nil || json.Unmarshal(b, &loaded) != nil || loaded.Username == "" {
			log.Fatal("Invalid authentication configuration")
		}
		if _, e = bcrypt.Cost([]byte(loaded.PasswordHash)); e != nil {
			log.Fatal("Invalid password hash")
		}
		creds = &loaded
	}
	proxy := httputil.NewSingleHostReverseProxy(u)
	director := proxy.Director
	proxy.Director = func(r *http.Request) { director(r); r.Host = u.Host }
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, e error) {
		http.Error(w, "Workbench is starting; please retry", 502)
	}
	handler := gatewayHandler(creds, *origin, proxy)
	hostChecked := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != public.Host {
			http.Error(w, "Host denied", 403)
			return
		}
		handler.ServeHTTP(w, r)
	})
	server := &http.Server{Addr: *listen, Handler: hostChecked, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20, TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12}}
	if *noAuth {
		log.Printf("HTTPS gateway listening on %s (authentication disabled)", *listen)
	} else {
		log.Printf("Authenticated HTTPS gateway listening on %s", *listen)
	}
	log.Fatal(server.ListenAndServeTLS(*cert, *key))
}
