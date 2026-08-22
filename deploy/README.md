# Production deployment checklist

1. Build the frontend with `npm ci && npm run build`.
2. Copy `dist/` to the static HTTPS host.
3. Copy `payuu-config.production.json` to the deployed `/payuu-config.json` and replace all example values.
4. Run the media relay behind HTTPS (Caddy/Nginx/load balancer).
5. Set `PAYUU_ENV=production`.
6. Set a long random `PAYUU_AUTH_TOKEN`.
7. Set `PAYUU_ALLOWED_ORIGINS=https://studio.example.com`.
8. Configure real STUN/TURN servers and credentials.
9. Expose the Pion UDP range configured by the relay.
10. Verify `/health` and `/health/media`.
11. Test camera, microphone, screen capture, iPhone pairing, WHIP, one private/unlisted destination, then multi-destination.

Do not publish stream keys in the Studio source or repository. Destination credentials are sent only over HTTPS to the authenticated relay session and are not persisted by the relay in this project.
