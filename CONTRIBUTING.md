# Contributing to Payuu Studio

Payuu Studio is a personal streaming project. Keep changes modular and do not introduce fake streaming states.

## Rules

- Never log stream keys, bearer tokens, passwords or TURN credentials.
- Never mark a destination LIVE unless the media pipeline confirms output.
- Keep camera/screen capture in Payuu-owned modules using browser/native APIs.
- Keep web and native capture capability detection explicit.
- Test JavaScript syntax and Go formatting before committing.
- Do not commit `.env` files or credentials.
