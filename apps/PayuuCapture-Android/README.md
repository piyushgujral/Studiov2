# Payuu Capture — Android Companion

The Android companion is the native capture path for devices where browser screen capture is limited. The production app should use Android MediaProjection for screen capture and AudioPlaybackCapture where the device/app policy permits, plus the microphone. It should establish an authenticated low-latency media session with Payuu Media Relay and expose a pairing code so the iPad Payuu Studio can control the capture session.

This repository currently contains the platform architecture/documentation only. A signed Android APK has not been built or device-tested in this environment and must not be represented as complete until it is.
