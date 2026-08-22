package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"runtime"
	"time"

	"payuu-media-server/config"
	"payuu-media-server/control"
	"payuu-media-server/relay"
)

func main() {
	cfg := config.LoadConfig()
	if cfg.Environment == "production" && cfg.AuthToken == "" {
		log.Fatal("[FATAL] PAYUU_AUTH_TOKEN must be set when PAYUU_ENV=production")
	}
	registry := control.NewSessionRegistry()
	startTime := time.Now()
	remoteRegistry := newRemoteRegistry()

	mux := http.NewServeMux()

	// 1. WHIP RFC 9335 Endpoints
	mux.HandleFunc("/api/whip/endpoint", relay.HandleWHIPEndpoint(cfg, registry))
	mux.HandleFunc("/api/whip/resource/", relay.HandleWHIPResource(cfg, registry))

	// 2. Real-Time Telemetry Stream (Server-Sent Events)
	mux.HandleFunc("/api/telemetry", relay.HandleSSETelemetry(cfg, registry))

	// 3. Remote iPhone capture <-> iPad control signaling
	mux.HandleFunc("/api/remote/session", func(w http.ResponseWriter, r *http.Request) {
		relay.ApplyCORS(w, r, cfg)
		if r.Method == http.MethodOptions {
			return
		}
		if r.Method == "POST" {
			handleRemoteCreate(remoteRegistry, cfg)(w, r)
			return
		}
		if r.Method == "GET" {
			handleRemoteLookup(remoteRegistry, cfg)(w, r)
			return
		}
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	})
	mux.HandleFunc("/api/remote/session/", func(w http.ResponseWriter, r *http.Request) {
		relay.ApplyCORS(w, r, cfg)
		if r.Method == http.MethodOptions {
			return
		}
		handleRemoteResource(remoteRegistry, cfg)(w, r)
	})

	// 4. Health & System Metrics Endpoints
	// Health checks are intentionally unauthenticated (used by load balancers /
	// orchestrators) but still only echo back an explicitly allowed origin,
	// never "*".
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		relay.ApplyCORS(w, r, cfg)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "ok",
			"service": "payuu-media-relay",
		})
	})

	mux.HandleFunc("/health/media", func(w http.ResponseWriter, r *http.Request) {
		relay.ApplyCORS(w, r, cfg)
		w.Header().Set("Content-Type", "application/json")

		var m runtime.MemStats
		runtime.ReadMemStats(&m)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"activeSessions": registry.Count(),
			"uptimeSec":      time.Since(startTime).Seconds(),
			"memoryAllocMB":  m.Alloc / 1024 / 1024,
			"goroutines":     runtime.NumGoroutine(),
		})
	})

	addr := fmt.Sprintf("0.0.0.0:%s", cfg.HTTPPort)
	log.Printf("==================================================")
	log.Printf("PAYUU MEDIA RELAY — REAL WEBRTC INGEST ENGINE")
	log.Printf("Server listening on http://%s", addr)
	log.Printf("WHIP Ingest URL:    http://%s/api/whip/endpoint", addr)
	if cfg.AuthToken == "" {
		log.Printf("Auth:               DISABLED (no PAYUU_AUTH_TOKEN set)")
	} else {
		log.Printf("Auth:               ENABLED (bearer token required, not logged)")
	}
	log.Printf("==================================================")

	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("[FATAL] HTTP server failed: %v", err)
	}
}
