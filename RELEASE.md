# Payuu Studio — Personal Streaming Platform Release Baseline

This is the final engineering baseline prepared for independent deployment.

## Product topology

- Independent Payuu Studio web/PWA frontend.
- Separate Payuu Media Relay service.
- iPad can operate as the Studio/control console.
- iPhone/Android remote capture is supported through the browser only where the OS/browser exposes the required capture APIs.
- Native Payuu Capture app directories are included as platform implementation targets; they are not represented as signed, device-tested releases.
- WHIP/WebRTC ingest feeds the Payuu relay.
- FFmpeg provides RTMP/RTMPS egress to configured destinations.

## Release gate

Before public streaming, the owner must perform physical device and destination tests on the deployed HTTPS environment. This is mandatory because browser capture permissions, iOS capabilities, NAT traversal, TURN, encoder behavior and platform ingest cannot be validated completely in this build environment.
