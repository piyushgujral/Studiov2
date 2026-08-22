package relay

import (
	"encoding/json"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/pion/rtp"
)

type EgressManager struct {
	SessionID string
	workers   map[string]*RTMPWorker
	mu        sync.RWMutex
	BytesSent uint64
}

func NewEgressManager(sessionID string, _ int) (*EgressManager, error) {
	return &EgressManager{
		SessionID: sessionID,
		workers:   make(map[string]*RTMPWorker),
	}, nil
}

func (e *EgressManager) StartDestinations(destinationsJSON string) {
	var dests []DestinationConfig
	if err := json.Unmarshal([]byte(destinationsJSON), &dests); err != nil {
		return
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	for _, d := range dests {
		if !d.Enabled || d.ServerURL == "" || d.StreamKey == "" {
			continue
		}
		serverURL := strings.ToLower(strings.TrimSpace(d.ServerURL))
		if !strings.HasPrefix(serverURL, "rtmp://") && !strings.HasPrefix(serverURL, "rtmps://") {
			continue
		}
		if _, exists := e.workers[d.ID]; exists {
			continue
		}

		worker, err := NewRTMPWorker(d)
		if err != nil {
			worker = NewFailedRTMPWorker(d, err)
		}
		e.workers[d.ID] = worker
		worker.Start()
	}
}

func (e *EgressManager) PushVideoRTP(pkt *rtp.Packet) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	for _, worker := range e.workers {
		if n := worker.PushVideoRTP(pkt); n > 0 {
			atomic.AddUint64(&e.BytesSent, uint64(n))
		}
	}
}

func (e *EgressManager) PushAudioRTP(pkt *rtp.Packet) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	for _, worker := range e.workers {
		if n := worker.PushAudioRTP(pkt); n > 0 {
			atomic.AddUint64(&e.BytesSent, uint64(n))
		}
	}
}

func (e *EgressManager) GetDestinationsStatus() map[string]map[string]interface{} {
	e.mu.RLock()
	defer e.mu.RUnlock()

	results := make(map[string]map[string]interface{})
	for id, w := range e.workers {
		st, errMsg, rec, sent, bitrate := w.GetMetrics()
		results[id] = map[string]interface{}{
			"id":          id,
			"name":        w.DestConfig.Name,
			"status":      st,
			"error":       errMsg,
			"reconnects":  rec,
			"bytesSent":   sent,
			"bitrateKbps": bitrate,
		}
	}
	return results
}

func (e *EgressManager) StopAll() {
	e.mu.Lock()
	defer e.mu.Unlock()

	for _, w := range e.workers {
		w.Stop()
	}
}
