package relay

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"payuu-media-server/config"
	"payuu-media-server/control"

	"github.com/pion/webrtc/v4"
)

var portCounter int32 = 40000

func getNextPortPair() int {
	p := atomic.AddInt32(&portCounter, 4)
	if p > 48000 {
		atomic.StoreInt32(&portCounter, 40000)
	}
	return int(p)
}

func HandleWHIPEndpoint(cfg *config.Config, registry *control.SessionRegistry) http.HandlerFunc {
	mediaEngine, err := CreateMediaEngine()
	if err != nil {
		log.Fatalf("[FATAL] Could not initialize WebRTC Media Engine: %v", err)
	}

	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			ApplyCORS(w, r, cfg)
			w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, DELETE")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Payuu-Destinations")
			w.Header().Set("Access-Control-Expose-Headers", "Location")
			w.WriteHeader(http.StatusOK)
			return
		}

		if r.Method != http.MethodPOST {
			http.Error(w, "Method Not Allowed. WHIP requires POST.", http.StatusMethodNotAllowed)
			return
		}

		if !control.AuthenticateRequest(r, cfg.AuthToken) {
			http.Error(w, "Unauthorized: Invalid bearer token.", http.StatusUnauthorized)
			return
		}

		contentType := r.Header.Get("Content-Type")
		if !strings.HasPrefix(contentType, "application/sdp") {
			http.Error(w, "Invalid Content-Type. Must be application/sdp", http.StatusUnsupportedMediaType)
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil || len(body) == 0 {
			http.Error(w, "Empty SDP offer payload.", http.StatusBadRequest)
			return
		}

		session := registry.CreateSession()
		destinationsHeader := r.Header.Get("X-Payuu-Destinations")

		egress, err := NewEgressManager(session.ID, getNextPortPair())
		if err != nil {
			log.Printf("[ERROR] [%s] Failed to bind local egress pipeline: %v", session.ID, err)
		} else {
			session.Egress = egress
			if destinationsHeader != "" {
				egress.StartDestinations(destinationsHeader)
			}
		}

		pc, err := BuildPeerConnection(cfg, mediaEngine)
		if err != nil {
			log.Printf("[ERROR] [%s] Failed to build PeerConnection: %v", session.ID, err)
			registry.Remove(session.ID)
			http.Error(w, "Internal Server Error during WebRTC initialization", http.StatusInternalServerError)
			return
		}
		session.PeerConnection = pc

		pc.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
			codec := track.Codec()
			log.Printf("[MEDIA] [%s] Ingesting %s | Codec: %s", session.ID, track.Kind().String(), codec.MimeType)

			if track.Kind() == webrtc.RTPCodecTypeVideo {
				session.VideoTrack = control.TrackState{
					Active:    true,
					Codec:     codec.MimeType,
					PayloadID: uint8(codec.PayloadType),
				}
			} else if track.Kind() == webrtc.RTPCodecTypeAudio {
				session.AudioTrack = control.TrackState{
					Active:    true,
					Codec:     codec.MimeType,
					PayloadID: uint8(codec.PayloadType),
				}
			}

			for {
				pkt, _, readErr := track.ReadRTP()
				if readErr != nil {
					return
				}
				atomic.AddUint64(&session.BytesReceived, uint64(pkt.MarshalSize()))
				atomic.AddUint64(&session.PacketsCount, 1)

				if session.Egress != nil {
					if track.Kind() == webrtc.RTPCodecTypeVideo {
						// FFmpeg SDP uses stable local payload types.
						pkt.PayloadType = 96
						session.Egress.PushVideoRTP(pkt)
					} else if track.Kind() == webrtc.RTPCodecTypeAudio {
						pkt.PayloadType = 111
						session.Egress.PushAudioRTP(pkt)
					}
				}
			}
		})

		pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
			log.Printf("[STATE] [%s] PeerConnection State: %s", session.ID, state.String())
			if state == webrtc.PeerConnectionStateConnected {
				now := time.Now()
				session.StartedAt = &now
				session.Status = "CONNECTED"
				StartSessionMonitor(session)
			} else if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateClosed {
				session.Status = "ENDED"
				if session.Egress != nil {
					session.Egress.StopAll()
				}
				close(session.CancelLoop)
				pc.Close()
			}
		})

		offer := webrtc.SessionDescription{
			Type: webrtc.SDPTypeOffer,
			SDP:  string(body),
		}
		if err := pc.SetRemoteDescription(offer); err != nil {
			pc.Close()
			registry.Remove(session.ID)
			http.Error(w, "Failed to apply SDP Offer", http.StatusBadRequest)
			return
		}

		answer, err := pc.CreateAnswer(nil)
		if err != nil {
			pc.Close()
			registry.Remove(session.ID)
			http.Error(w, "Failed to create SDP Answer", http.StatusInternalServerError)
			return
		}

		gatherComplete := webrtc.GatheringCompletePromise(pc)
		if err := pc.SetLocalDescription(answer); err != nil {
			pc.Close()
			registry.Remove(session.ID)
			http.Error(w, "Failed to apply local SDP Answer", http.StatusInternalServerError)
			return
		}

		select {
		case <-gatherComplete:
		case <-time.After(2 * time.Second):
		}

		resourceURI := fmt.Sprintf("/api/whip/resource/%s", session.ID)
		w.Header().Set("Content-Type", "application/sdp")
		w.Header().Set("Location", resourceURI)
		ApplyCORS(w, r, cfg)
		w.Header().Set("Access-Control-Expose-Headers", "Location")
		w.WriteHeader(http.StatusCreated)
		w.Write([]byte(pc.LocalDescription().SDP))
	}
}

func HandleWHIPResource(cfg *config.Config, registry *control.SessionRegistry) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ApplyCORS(w, r, cfg)
		w.Header().Set("Access-Control-Allow-Methods", "DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		if !control.AuthenticateRequest(r, cfg.AuthToken) {
			http.Error(w, "Unauthorized: Invalid bearer token.", http.StatusUnauthorized)
			return
		}

		if r.Method != http.MethodDelete {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}

		parts := strings.Split(r.URL.Path, "/")
		sessionID := parts[len(parts)-1]

		session, exists := registry.Get(sessionID)
		if !exists {
			http.Error(w, "Session not found", http.StatusNotFound)
			return
		}

		log.Printf("[WHIP] [%s] Termination requested", sessionID)
		session.Status = "ENDED"
		now := time.Now()
		session.EndedAt = &now

		if session.Egress != nil {
			session.Egress.StopAll()
		}

		if session.PeerConnection != nil {
			session.PeerConnection.Close()
		}

		select {
		case <-session.CancelLoop:
		default:
			close(session.CancelLoop)
		}

		registry.Remove(sessionID)
		w.WriteHeader(http.StatusOK)
	}
}
