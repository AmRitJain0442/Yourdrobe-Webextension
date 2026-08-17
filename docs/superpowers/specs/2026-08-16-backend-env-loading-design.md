# Backend `.env` Loading Design

**Date:** 2026-08-16

## Goal

Let local developers configure one or more YouCam API keys in `backend/.env` without exporting a PowerShell variable for every backend session.

## Design

- Add `python-dotenv` to the existing backend dependencies.
- Load `backend/.env` from a path derived from the backend package location, so startup works from any current directory.
- Keep normal environment variables authoritative. A shell-provided `YOUCAM_API_KEYS` value must override the file value.
- Create an ignored local `backend/.env` containing an empty `YOUCAM_API_KEYS=` entry for the developer to edit privately.
- Commit `backend/.env.example` with placeholder values and update the README startup instructions.
- Keep all key parsing, ordering, deduplication, failover, and redaction behavior unchanged.

## Security

The real `backend/.env` remains covered by the repository's existing `.gitignore` rules. No real key is added to tests, documentation, extension code, Git history, or command output.

## Verification

- A backend test proves `.env` supplies keys when the process variable is absent.
- A backend test proves a process variable takes precedence over `.env`.
- The complete backend and extension suites, production build, secret-reference check, and Git diff checks must pass before push.

## Out of Scope

No secret manager, settings UI, guided capture, new YouCam category, or deployment configuration is added.
