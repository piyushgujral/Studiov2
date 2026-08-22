package relay

import (
	"bufio"
	"fmt"
	"io"
	"log"
	"net"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/rtp"
)

type DestinationConfig struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	ServerURL string `json:"serverUrl"`
	StreamKey string `json:"streamKey"`
	Enabled   bool   `json:"enabled"`
}

type RTMPWorker struct {
	DestConfig   DestinationConfig
	VideoPort    int
	AudioPort    int
	videoConn    *net.UDPConn
	audioConn    *net.UDPConn
	Status       string
	ErrorMessage string
	BitrateKbps  uint64
	Reconnects   int
	BytesSent    uint64
	cmd          *exec.Cmd
	stopChan     chan struct{}
	stopOnce     sync.Once
	mu           sync.RWMutex
	startedAt    time.Time
	lastBytes    uint64
}

func NewRTMPWorker(dest DestinationConfig) (*RTMPWorker, error) {
	videoPort, err := reserveUDPPort()
	if err != nil {
		return nil, fmt.Errorf("video RTP port allocation failed: %w", err)
	}
	audioPort, err := reserveUDPPort()
	if err != nil {
		return nil, fmt.Errorf("audio RTP port allocation failed: %w", err)
	}

	videoConn, err := net.DialUDP("udp", nil, &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: videoPort})
	if err != nil {
		return nil, fmt.Errorf("video RTP sender failed: %w", err)
	}
	audioConn, err := net.DialUDP("udp", nil, &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: audioPort})
	if err != nil {
		videoConn.Close()
		return nil, fmt.Errorf("audio RTP sender failed: %w", err)
	}

	return &RTMPWorker{
		DestConfig: dest,
		VideoPort:  videoPort,
		AudioPort:  audioPort,
		videoConn:  videoConn,
		audioConn:  audioConn,
		Status:     "CONNECTING",
		stopChan:   make(chan struct{}),
	}, nil
}

func reserveUDPPort() (int, error) {
	conn, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 0})
	if err != nil {
		return 0, err
	}
	port := conn.LocalAddr().(*net.UDPAddr).Port
	if err := conn.Close(); err != nil {
		return 0, err
	}
	return port, nil
}

func NewFailedRTMPWorker(dest DestinationConfig, err error) *RTMPWorker {
	return &RTMPWorker{
		DestConfig:   dest,
		Status:       "ERROR",
		ErrorMessage: err.Error(),
		stopChan:     make(chan struct{}),
	}
}

func (w *RTMPWorker) Start() {
	if w.Status == "ERROR" && w.videoConn == nil {
		return
	}
	go w.runPipeline()
}

func (w *RTMPWorker) PushVideoRTP(pkt *rtp.Packet) int {
	if w.videoConn == nil || pkt == nil {
		return 0
	}
	buf, err := pkt.Marshal()
	if err != nil {
		return 0
	}
	n, err := w.videoConn.Write(buf)
	if err != nil {
		return 0
	}
	atomic.AddUint64(&w.BytesSent, uint64(n))
	return n
}

func (w *RTMPWorker) PushAudioRTP(pkt *rtp.Packet) int {
	if w.audioConn == nil || pkt == nil {
		return 0
	}
	buf, err := pkt.Marshal()
	if err != nil {
		return 0
	}
	n, err := w.audioConn.Write(buf)
	if err != nil {
		return 0
	}
	atomic.AddUint64(&w.BytesSent, uint64(n))
	return n
}

func (w *RTMPWorker) runPipeline() {
	targetURL := strings.TrimRight(w.DestConfig.ServerURL, "/") + "/" + w.DestConfig.StreamKey

	maxRetries := 5
	backoff := 2 * time.Second

	for {
		select {
		case <-w.stopChan:
			w.setStatus("ENDED", "")
			w.closeInputs()
			return
		default:
		}

		sdpTemplate := fmt.Sprintf(
			"v=0\r\n"+
				"o=- 0 0 IN IP4 127.0.0.1\r\n"+
				"s=PayuuIngest\r\n"+
				"c=IN IP4 127.0.0.1\r\n"+
				"t=0 0\r\n"+
				"m=video %d RTP/AVP 96\r\n"+
				"a=recvonly\r\n"+
				"a=rtpmap:96 H264/90000\r\n"+
				"a=fmtp:96 packetization-mode=1\r\n"+
				"m=audio %d RTP/AVP 111\r\n"+
				"a=recvonly\r\n"+
				"a=rtpmap:111 opus/48000/2\r\n",
			w.VideoPort, w.AudioPort,
		)

		args := []string{
			"-hide_banner",
			"-loglevel", "warning",
			"-nostats",
			"-progress", "pipe:2",
			"-protocol_whitelist", "file,pipe,udp,rtp",
			"-fflags", "+genpts",
			"-rw_timeout", "15000000",
			"-f", "sdp",
			"-i", "pipe:0",
			"-map", "0:v:0?",
			"-map", "0:a:0?",
			"-c:v", "copy",
			"-c:a", "aac",
			"-b:a", "160k",
			"-ar", "48000",
			"-f", "flv",
			"-flvflags", "no_duration_filesize",
			targetURL,
		}

		cmd := exec.Command("ffmpeg", args...)
		stdin, err := cmd.StdinPipe()
		if err != nil {
			w.setStatus("ERROR", fmt.Sprintf("Pipeline stdin error: %v", err))
			return
		}

		stderr, err := cmd.StderrPipe()
		if err != nil {
			w.setStatus("ERROR", fmt.Sprintf("Pipeline stderr error: %v", err))
			return
		}

		w.mu.Lock()
		w.cmd = cmd
		w.startedAt = time.Now()
		w.mu.Unlock()
		w.setStatus("CONNECTING", "")

		if err := cmd.Start(); err != nil {
			w.setStatus("ERROR", fmt.Sprintf("FFmpeg launch failed: %v", err))
			return
		}

		if _, err := io.WriteString(stdin, sdpTemplate); err != nil {
			_ = stdin.Close()
			w.setStatus("ERROR", fmt.Sprintf("Failed to provide RTP SDP to FFmpeg: %v", err))
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			return
		}
		_ = stdin.Close()

		logDone := make(chan struct{})
		go w.consumeFFmpegLogs(stderr, logDone)

		err = cmd.Wait()
		<-logDone

		select {
		case <-w.stopChan:
			w.setStatus("ENDED", "")
			w.closeInputs()
			return
		default:
		}

		if err == nil {
			w.setStatus("ENDED", "FFmpeg exited before the destination was confirmed live.")
			return
		}

		w.mu.Lock()
		w.Reconnects++
		retries := w.Reconnects
		w.mu.Unlock()

		if retries >= maxRetries {
			w.setStatus("ERROR", "Maximum reconnection limit reached.")
			return
		}

		w.setStatus("RECONNECTING", fmt.Sprintf("FFmpeg exited: %v", err))
		timer := time.NewTimer(backoff)
		select {
		case <-w.stopChan:
			timer.Stop()
			w.setStatus("ENDED", "")
			w.closeInputs()
			return
		case <-timer.C:
		}
		backoff *= 2
	}
}

func (w *RTMPWorker) consumeFFmpegLogs(stderr io.ReadCloser, done chan<- struct{}) {
	defer close(done)
	scanner := bufio.NewScanner(stderr)
	for scanner.Scan() {
		line := scanner.Text()
		lower := strings.ToLower(line)

		// -progress pipe:2 emits machine-readable progress. Seeing a non-zero
		// encoded frame proves FFmpeg is consuming media and producing output;
		// process start alone is intentionally not considered LIVE.
		if strings.HasPrefix(lower, "frame=") {
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 && strings.TrimSpace(parts[1]) != "0" {
				w.setStatus("LIVE", "")
			}
		}

		// Log only safe FFmpeg diagnostics. Never emit the destination URL or key.
		if strings.Contains(lower, "error") || strings.Contains(lower, "failed") || strings.Contains(lower, "invalid") {
			safe := strings.ReplaceAll(line, w.DestConfig.StreamKey, "[REDACTED]")
			log.Printf("[FFMPEG] [%s] %s", w.DestConfig.Name, safe)
		}
	}
}

func (w *RTMPWorker) Stop() {
	w.stopOnce.Do(func() {
		close(w.stopChan)
	})

	w.mu.Lock()
	cmd := w.cmd
	w.mu.Unlock()

	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
	w.closeInputs()
	w.setStatus("ENDED", "")
}

func (w *RTMPWorker) closeInputs() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.videoConn != nil {
		_ = w.videoConn.Close()
		w.videoConn = nil
	}
	if w.audioConn != nil {
		_ = w.audioConn.Close()
		w.audioConn = nil
	}
}

func (w *RTMPWorker) setStatus(status, errMsg string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.Status = status
	w.ErrorMessage = errMsg
}

func (w *RTMPWorker) GetMetrics() (string, string, int, uint64, uint64) {
	w.mu.RLock()
	status := w.Status
	errMsg := w.ErrorMessage
	reconnects := w.Reconnects
	startedAt := w.startedAt
	w.mu.RUnlock()

	bytes := atomic.LoadUint64(&w.BytesSent)
	var bitrate uint64
	if !startedAt.IsZero() {
		seconds := time.Since(startedAt).Seconds()
		if seconds > 0 {
			bitrate = uint64(float64(bytes*8) / seconds / 1000)
		}
	}
	return status, errMsg, reconnects, bytes, bitrate
}
