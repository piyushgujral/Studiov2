package control

import (
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/pion/webrtc/v4"
)

type EgressPipeline interface {
	GetDestinationsStatus() map[string]map[string]interface{}
	StopAll()
}

type TrackState struct {
	Active    bool   `json:"active"`
	Codec     string `json:"codec"`
	PayloadID uint8  `json:"payloadId"`
}

type StreamSession struct {
	ID             string                 `json:"sessionId"`
	Status         string                 `json:"status"`
	CreatedAt      time.Time              `json:"createdAt"`
	StartedAt      *time.Time             `json:"startedAt,omitempty"`
	EndedAt        *time.Time             `json:"endedAt,omitempty"`
	VideoTrack     TrackState             `json:"videoTrack"`
	AudioTrack     TrackState             `json:"audioTrack"`
	BytesReceived  uint64                 `json:"bytesReceived"`
	PacketsCount   uint64                 `json:"packetsReceived"`
	CurrentBitrate uint64                 `json:"bitrateKbps"`
	PeerConnection *webrtc.PeerConnection `json:"-"`
	Egress         EgressPipeline         `json:"-"`
	CancelLoop     chan struct{}          `json:"-"`
	TelemetryChan  chan SessionStats      `json:"-"`
	mu             sync.RWMutex
}

type SessionStats struct {
	SessionID     string                            `json:"sessionId"`
	Status        string                            `json:"status"`
	DurationSec   float64                           `json:"durationSeconds"`
	BitrateKbps   uint64                            `json:"bitrateKbps"`
	PacketsCount  uint64                            `json:"packetsReceived"`
	BytesReceived uint64                            `json:"bytesReceived"`
	VideoActive   bool                              `json:"videoActive"`
	VideoCodec    string                            `json:"videoCodec"`
	AudioActive   bool                              `json:"audioActive"`
	AudioCodec    string                            `json:"audioCodec"`
	Destinations  map[string]map[string]interface{} `json:"destinations,omitempty"`
}

type SessionRegistry struct {
	sessions map[string]*StreamSession
	mu       sync.RWMutex
}

func NewSessionRegistry() *SessionRegistry {
	return &SessionRegistry{
		sessions: make(map[string]*StreamSession),
	}
}

func (r *SessionRegistry) CreateSession() *StreamSession {
	r.mu.Lock()
	defer r.mu.Unlock()

	session := &StreamSession{
		ID:            uuid.New().String(),
		Status:        "STARTING",
		CreatedAt:     time.Now(),
		CancelLoop:    make(chan struct{}),
		TelemetryChan: make(chan SessionStats, 100),
	}

	r.sessions[session.ID] = session
	return session
}

func (r *SessionRegistry) Get(id string) (*StreamSession, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	session, exists := r.sessions[id]
	return session, exists
}

func (r *SessionRegistry) Remove(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.sessions, id)
}

func (r *SessionRegistry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.sessions)
}
