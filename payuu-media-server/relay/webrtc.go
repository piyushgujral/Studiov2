package relay

import (
	"payuu-media-server/config"

	"github.com/pion/webrtc/v4"
)

// CreateMediaEngine configures standard codecs for H.264 video and Opus audio
func CreateMediaEngine() (*webrtc.MediaEngine, error) {
	m := &webrtc.MediaEngine{}

	// 1. Setup Audio Codecs (Opus 48kHz Stereo)
	if err := m.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:    webrtc.MimeTypeOpus,
			ClockRate:   48000,
			Channels:    2,
			SDPFmtpLine: "minptime=10;useinbandfec=1",
		},
		PayloadType: 111,
	}, webrtc.RTPCodecTypeAudio); err != nil {
		return nil, err
	}

	// 2. Setup Video Codecs (H.264 Baseline/Main profiles)
	h264Profiles := []string{
		"level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
		"level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f",
		"level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42001f",
	}

	payloadTypes := []webrtc.PayloadType{96, 97, 125}
	for i, fmtp := range h264Profiles {
		if err := m.RegisterCodec(webrtc.RTPCodecParameters{
			RTPCodecCapability: webrtc.RTPCodecCapability{
				MimeType:    webrtc.MimeTypeH264,
				ClockRate:   90000,
				SDPFmtpLine: fmtp,
			},
			PayloadType: payloadTypes[i],
		}, webrtc.RTPCodecTypeVideo); err != nil {
			return nil, err
		}
	}

	return m, nil
}

// BuildPeerConnection creates a new Pion WebRTC connection with STUN/TURN
func BuildPeerConnection(cfg *config.Config, mediaEngine *webrtc.MediaEngine) (*webrtc.PeerConnection, error) {
	settingEngine := webrtc.SettingEngine{}
	// Keep server-side ICE UDP ports inside the range exposed by Docker/firewall.
	if err := settingEngine.SetEphemeralUDPPortRange(50000, 50050); err != nil {
		return nil, err
	}
	api := webrtc.NewAPI(webrtc.WithMediaEngine(mediaEngine), webrtc.WithSettingEngine(settingEngine))

	iceServers := []webrtc.ICEServer{}
	for _, stun := range cfg.STUNServers {
		iceServers = append(iceServers, webrtc.ICEServer{URLs: []string{stun}})
	}

	if cfg.TURNServer != "" {
		iceServers = append(iceServers, webrtc.ICEServer{
			URLs:           []string{cfg.TURNServer},
			Username:       cfg.TURNUsername,
			Credential:     cfg.TURNPassword,
			CredentialType: webrtc.ICECredentialTypePassword,
		})
	}

	return api.NewPeerConnection(webrtc.Configuration{
		ICEServers: iceServers,
	})
}
