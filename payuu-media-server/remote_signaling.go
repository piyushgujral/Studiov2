package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"payuu-media-server/config"
	"payuu-media-server/control"
)

type remoteSession struct {
	ID        string
	Code      string
	Offer     string
	Answer    string
	CreatedAt time.Time
	mu        sync.RWMutex
}

type remoteRegistry struct {
	mu   sync.RWMutex
	byID map[string]*remoteSession
}

func newRemoteRegistry() *remoteRegistry { return &remoteRegistry{byID: map[string]*remoteSession{}} }
func (r *remoteRegistry) create() *remoteSession {
	r.cleanupExpired()
	b := make([]byte, 3)
	_, _ = rand.Read(b)
	code := strings.ToUpper(hex.EncodeToString(b))
	s := &remoteSession{ID: uuid.NewString(), Code: code, CreatedAt: time.Now()}
	r.mu.Lock()
	r.byID[s.ID] = s
	r.mu.Unlock()
	return s
}
func (r *remoteRegistry) cleanupExpired() {
	now := time.Now()
	r.mu.Lock()
	for id, s := range r.byID {
		if now.Sub(s.CreatedAt) > 10*time.Minute {
			delete(r.byID, id)
		}
	}
	r.mu.Unlock()
}

func (r *remoteRegistry) get(id string) (*remoteSession, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s, ok := r.byID[id]
	return s, ok
}
func (r *remoteRegistry) delete(id string) { r.mu.Lock(); delete(r.byID, id); r.mu.Unlock() }
func (r *remoteRegistry) byCode(code string) (*remoteSession, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, s := range r.byID {
		if s.Code == strings.ToUpper(strings.TrimSpace(code)) && time.Since(s.CreatedAt) < 10*time.Minute {
			return s, true
		}
	}
	return nil, false
}

func remoteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func remoteCodeOK(s *remoteSession, r *http.Request) bool {
	return strings.EqualFold(r.URL.Query().Get("code"), s.Code)
}

func handleRemoteCreate(reg *remoteRegistry, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !control.AuthenticateRequest(r, cfg.AuthToken) {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		if r.Method != "POST" {
			http.Error(w, "method not allowed", 405)
			return
		}
		s := reg.create()
		remoteJSON(w, 200, map[string]any{"sessionId": s.ID, "code": s.Code, "expiresInSeconds": 600})
	}
}
func handleRemoteLookup(reg *remoteRegistry, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !control.AuthenticateRequest(r, cfg.AuthToken) {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		if r.Method != "GET" {
			http.Error(w, "method not allowed", 405)
			return
		}
		s, ok := reg.byCode(r.URL.Query().Get("code"))
		if !ok {
			http.Error(w, "pairing session not found", 404)
			return
		}
		remoteJSON(w, 200, map[string]any{"sessionId": s.ID, "code": s.Code})
	}
}
func handleRemoteResource(reg *remoteRegistry, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !control.AuthenticateRequest(r, cfg.AuthToken) {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		path := strings.TrimPrefix(r.URL.Path, "/api/remote/session/")
		parts := strings.Split(path, "/")
		if len(parts) < 1 || parts[0] == "" {
			http.NotFound(w, r)
			return
		}
		s, ok := reg.get(parts[0])
		if !ok || time.Since(s.CreatedAt) > 10*time.Minute {
			http.Error(w, "session not found or expired", 404)
			return
		}
		if !remoteCodeOK(s, r) {
			http.Error(w, "invalid pairing code", 403)
			return
		}
		if len(parts) == 1 {
			if r.Method == "DELETE" {
				reg.delete(s.ID)
				remoteJSON(w, 200, map[string]any{"ok": true})
				return
			}
			http.Error(w, "method not allowed", 405)
			return
		}
		switch parts[1] {
		case "offer":
			if r.Method == "POST" {
				var p struct {
					SDP string `json:"sdp"`
				}
				if json.NewDecoder(r.Body).Decode(&p) != nil || !strings.Contains(p.SDP, "v=0") {
					http.Error(w, "invalid SDP", 400)
					return
				}
				s.mu.Lock()
				s.Offer = p.SDP
				s.mu.Unlock()
				remoteJSON(w, 200, map[string]any{"ok": true})
				return
			}
			if r.Method == "GET" {
				s.mu.RLock()
				v := s.Offer
				s.mu.RUnlock()
				if v == "" {
					w.WriteHeader(204)
					return
				}
				remoteJSON(w, 200, map[string]string{"sdp": v})
				return
			}
		case "answer":
			if r.Method == "POST" {
				var p struct {
					SDP string `json:"sdp"`
				}
				if json.NewDecoder(r.Body).Decode(&p) != nil || !strings.Contains(p.SDP, "v=0") {
					http.Error(w, "invalid SDP", 400)
					return
				}
				s.mu.Lock()
				s.Answer = p.SDP
				s.mu.Unlock()
				remoteJSON(w, 200, map[string]any{"ok": true})
				return
			}
			if r.Method == "GET" {
				s.mu.RLock()
				v := s.Answer
				s.mu.RUnlock()
				if v == "" {
					w.WriteHeader(204)
					return
				}
				remoteJSON(w, 200, map[string]string{"sdp": v})
				return
			}
		}
		http.Error(w, "not found", 404)
	}
}
