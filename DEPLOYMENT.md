# Payuu Studio Deployment

## Recommended production topology

```text
studio.example.com      -> static Payuu Studio/PWA
stream.example.com      -> Payuu Media Relay
TURN server              -> WebRTC NAT traversal
                           |
                           +-> FFmpeg -> YouTube/KICK/Twitch/Custom RTMP
```

## Requirements

- HTTPS for the Studio and relay.
- A VPS/server with UDP ports 50000-50050 exposed to the relay container.
- FFmpeg installed in the relay container.
- A real STUN/TURN configuration; TURN is strongly recommended for mobile/cross-network capture.
- `PAYUU_AUTH_TOKEN` set to a long random value for the personal deployment.
- `PAYUU_ALLOWED_ORIGINS` set only to the Studio origin.

## Test order

1. Open Studio over HTTPS.
2. Enable iPad camera/microphone.
3. Pair iPhone Capture if supported.
4. Verify the clean preview.
5. Start WHIP ingest and confirm `PAYUU INGEST CONNECTED`.
6. Verify server telemetry shows packets/bytes increasing.
7. Enable one private/unlisted destination test.
8. Confirm destination becomes `LIVE` only after actual FFmpeg media progress.
9. Add additional destinations one at a time.

Do not perform a public live launch until these tests pass on the actual iPhone/iPad and production server.


## Independent website / relay domains

The Studio is intentionally independent of any other existing website or brand. The static site can use any personal domain, while the relay can live on a separate `stream.<domain>` host. The Studio reads `/payuu-config.json` at runtime, so the relay origin does not need to be compiled into the JavaScript bundle.

For iPhone full-device/game capture, use the native Payuu Capture application when the browser does not expose the required screen/audio capture capabilities. Browser `getDisplayMedia()` is not a universal iOS capability.
