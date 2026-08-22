# Payuu Platform Support

## Web/PWA

| Platform | Camera | Mic | Screen | iPad Control | Status |
|---|---|---|---|---|---|
| Windows Chrome/Edge | Yes | Yes | Yes | N/A | Primary web target |
| macOS Safari/Chrome | Yes | Yes | Browser-dependent | N/A | Supported with browser capability checks |
| Android Chrome | Yes | Yes | Browser-dependent | Yes | Web target; native capture recommended for long-running capture |
| iPad Safari | Yes | Yes | Browser-dependent | Yes | Control console target |
| iPhone Safari | Yes | Yes | Browser/iOS-version dependent | Capture mode | Use native Payuu Capture for reliable full-device/game capture |

## Native capture roadmap

The iPhone/iPad capture companion should use Apple's native screen/audio capture stack for reliable full-device capture and background operation. Apple documents ScreenCaptureKit as the native screen/audio capture framework and provides an iOS screen-capture sample.

The current repository contains the native iOS architecture scaffold but not a signed, device-tested binary.


## Production capability rules

- Camera and microphone require HTTPS (except localhost development).
- Browser screen capture is capability-dependent and requires a user gesture.
- iPhone full-device/game screen + audio capture should use the native Payuu Capture app; do not promise universal Safari screen capture.
- The iPad Studio can be the production/control console and can receive a remote capture stream over WebRTC.
- Desktop browsers provide the broadest web capture support.
