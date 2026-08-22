package relay

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync/atomic"
	"time"

	"payuu-media-server/config"
	"payuu-media-server/control"
)

func StartSessionMonitor(session *control.StreamSession) {
	ticker := time.NewTicker(1 * time.Second)
	var prevBytes uint64 = 0

	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-session.CancelLoop:
				return
			case <-ticker.C:
				currentBytes := atomic.LoadUint64(&session.BytesReceived)
				currentPackets := atomic.LoadUint64(&session.PacketsCount)

				deltaBytes := currentBytes - prevBytes
				prevBytes = currentBytes
				bitrateKbps := (deltaBytes * 8) / 1000

				atomic.StoreUint64(&session.CurrentBitrate, bitrateKbps)

				var duration float64 = 0
				if session.StartedAt != nil {
					duration = time.Since(*session.StartedAt).Seconds()
				}

				var destMetrics map[string]map[string]interface{}
				if session.Egress != nil {
					destMetrics = session.Egress.GetDestinationsStatus()
				}

				stats := control.SessionStats{
					SessionID:     session.ID,
					Status:        session.Status,
					DurationSec:   duration,
					BitrateKbps:   bitrateKbps,
					PacketsCount:  currentPackets,
					BytesReceived: currentBytes,
					VideoActive:   session.VideoTrack.Active,
					VideoCodec:    session.VideoTrack.Codec,
					AudioActive:   session.AudioTrack.Active,
					AudioCodec:    session.AudioTrack.Codec,
					Destinations:  destMetrics,
				}

				select {
				case session.TelemetryChan <- stats:
				default:
				}
			}
		}
	}()
}

func HandleSSETelemetry(cfg *config.Config, registry *control.SessionRegistry) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ApplyCORS(w, r, cfg)
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.WriteHeader(http.StatusOK)
			return
		}
		sessionID := r.URL.Query().Get("sessionId")
		if !control.AuthenticateRequest(r, cfg.AuthToken) {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		session, exists := registry.Get(sessionID)
		if !exists {
			http.Error(w, "Session not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
			return
		}

		notify := r.Context().Done()

		for {
			select {
			case <-notify:
				return
			case stats, open := <-session.TelemetryChan:
				if !open {
					return
				}
				data, err := json.Marshal(stats)
				if err == nil {
					fmt.Fprintf(w, "data: %s\n\n", data)
					flusher.Flush()
				}
			}
		}
	}
}
