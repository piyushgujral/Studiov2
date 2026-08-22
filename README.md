# Payuu Studio

Payuu Studio is a web streaming studio prototype with first-party browser capture, a clean compositor, WebRTC/WHIP ingest, and a Go/Pion media relay prepared for RTMP/RTMPS fan-out.

## Current pipeline

Camera / Screen / Microphone / Display Audio
→ Payuu Compositor
→ WebRTC / WHIP
→ Payuu Media Relay (Pion)
→ RTP fan-out
→ FFmpeg per destination
→ RTMP / RTMPS

## Capture

- Camera uses `navigator.mediaDevices.getUserMedia()`.
- Screen uses `navigator.mediaDevices.getDisplayMedia()`.
- Browser-native Stop Sharing is detected through `MediaStreamTrack.onended`.
- Microphone and available display/system audio are mixed into one WHIP audio track.

## WHIP

`POST /api/whip/endpoint` accepts a real SDP offer and returns a real SDP answer. The returned `Location` identifies the stream resource. `DELETE /api/whip/resource/{sessionId}` terminates the session.

## RTMP/RTMPS fan-out

Each enabled destination gets its own RTP input ports and its own FFmpeg process. The browser-negotiated RTP payload types are normalized to the local FFmpeg SDP payload types (H.264 96 and Opus 111).

A destination is shown as `LIVE` only after FFmpeg reports actual media progress; starting an FFmpeg process alone does not mark the destination live.

Supported destination model:

- YouTube
- KICK
- Twitch
- Custom RTMP/RTMPS

The final confirmation that a platform is accepting a stream must still be tested against that platform's real ingest endpoint and credentials.

## Security

- No default production bearer secret.
- `PAYUU_ENV=production` requires `PAYUU_AUTH_TOKEN`.
- CORS is allow-list based.
- Stream keys are not written to server logs.
- WHIP resource deletion requires bearer authentication.
- Telemetry is scoped to the generated session ID and uses the configured CORS policy.

## Environment

See `payuu-media-server/.env.example`.

Important values:

```text
PAYUU_ENV=development
PAYUU_HTTP_PORT=8080
PAYUU_AUTH_TOKEN=
PAYUU_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
PAYUU_STUN_SERVERS=stun:stun.l.google.com:19302
PAYUU_TURN_SERVER=
PAYUU_TURN_USERNAME=
PAYUU_TURN_PASSWORD=
```

## Development

The frontend requires a secure browser context for camera/screen capture. `localhost` is permitted by browsers; production should use HTTPS.

The media relay requires Go and FFmpeg. Docker support is provided for the server.

## Production notes

Production should use HTTPS for Studio and WHIP, a proper authentication/session service, encrypted server-side destination credentials, TURN where required, and firewall/UDP configuration matching the Pion ICE port range.

The project does not claim YouTube/KICK/Twitch production readiness until real destination tests are performed.

## iPad Control + iPhone Capture Mode

Payuu Studio now includes a remote-device workflow for a two-device mobile setup:

- **iPad:** open the normal Studio and choose **iPhone Link**. Create a pairing session.
- **iPhone:** open the generated capture URL (or add `?mode=capture&session=...&code=...` to the Studio URL) and tap **Start iPhone Capture**.
- The iPhone requests screen capture and microphone access using browser media APIs where supported.
- The captured WebRTC stream is sent to the iPad using a short-lived pairing session and browser WebRTC.
- The iPad receives the remote stream as the **iPhone Remote Screen** source. Its audio tracks are available to the Studio audio pipeline.
- The iPad camera can remain local and be composed as the camera/PIP layer.

### Important mobile capability note

Mobile browser support for screen capture and background/long-running WebRTC sessions varies by iOS/iPadOS/Android version and browser. The Studio detects whether `getDisplayMedia()` is available. If the iPhone browser does not expose screen capture, Payuu cannot capture the iPhone screen through that browser alone; a native Payuu Capture app/extension is the next required layer.

The remote signaling API uses short-lived six-character pairing codes and HTTP polling for SDP exchange. Production internet use should be deployed behind HTTPS and a properly configured STUN/TURN service.


## Cross-device / mobile architecture

Payuu Studio is a web/PWA control and compositor application. The iPad can act as the production console while an iPhone can act as a capture device through the remote-device pairing flow. Browser screen capture is capability-dependent on mobile; Payuu does not claim universal iOS full-device/game capture from Safari. For reliable native iOS capture, the repository includes an `apps/PayuuCapture-iOS` source scaffold.

## Production streaming architecture

Camera/screen/audio → Payuu clean compositor → WHIP/WebRTC → Payuu Media Relay (Pion) → RTP → FFmpeg RTMP/RTMPS fan-out → YouTube/KICK/Twitch/custom destinations. Destination state is only reported LIVE after the egress pipeline observes media progress.

## Verification status

The source is prepared for deployment, but a production claim requires real-device and real-destination tests. In particular, iPhone native capture requires Xcode/Apple signing and a physical-device test, and the Go/Vite builds must be executed in a dependency-complete environment.


## Runtime configuration

The deployed Studio reads `/payuu-config.json` at startup so the static frontend can point to an independent Payuu Media Relay without rebuilding the application. Do not put a real production bearer token into a public repository; for a personal deployment, prefer an authenticated session/token mechanism or a privately deployed config.
