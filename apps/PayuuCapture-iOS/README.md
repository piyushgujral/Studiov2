# Payuu Capture — iOS

This directory is the native capture target for the iPhone/iPad companion.

## Required production capture path

Use Apple's current ScreenCaptureKit APIs (`SCContentSharingPicker` / `SCStream`) for supported iOS/iPadOS screen and audio capture, with microphone capture and a native WebRTC transport to the Payuu Media Relay. Do not represent the current SwiftUI shell as a completed capture app.

Apple documents ScreenCaptureKit as the current screen/audio streaming framework and notes that it replaces the older ReplayKit screen-streaming approach. The native target must be device-tested before release.

## Release gate

The iOS companion is **not release-ready** until an Xcode project is added, signed, built, and tested on a physical iPhone/iPad for: screen capture, game/app audio where permitted, microphone, background behavior, WebRTC transport, reconnect, and battery/thermal behavior.
