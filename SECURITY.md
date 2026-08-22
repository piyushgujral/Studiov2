# Security Notes

## Secrets

Stream keys and relay bearer tokens are credentials. They must not be committed, logged, or placed in URLs.

## WebRTC

Use HTTPS in production. Configure STUN/TURN explicitly. TURN credentials should be short-lived in production.

## Session ownership

WHIP resource deletion is authenticated. Remote-device pairing uses a short-lived pairing code; production should additionally bind sessions to an authenticated creator account.

## Destination credentials

The current personal Studio stores destination configuration locally and sends enabled destination configuration to the relay over the authenticated WHIP request. Production credential vaulting should move secrets server-side and issue short-lived stream-session authorization.
