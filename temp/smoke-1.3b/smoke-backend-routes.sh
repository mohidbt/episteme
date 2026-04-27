#!/usr/bin/env bash
# Smoke the 6 backend HTTP routes wired in T0 + the new debug endpoint.
# No LLM dependency. Requires apps/km, apps/reader, agents service all running.
#
# HMAC scheme matches services/agents/lib/km_http.py + apps/{km,reader}/src/lib/internal-auth.ts:
#   msg = ts + METHOD + path_with_query + body  (no delimiters)
#   sig = hex(hmac_sha256(secret, msg))
#
# Usage:
#   INHALE_INTERNAL_SECRET=dev-secret bash smoke-backend-routes.sh

set -euo pipefail

SECRET="${INHALE_INTERNAL_SECRET:-dev-secret}"
KM="${KM_BASE_URL:-http://localhost:3001}"
READER="${READER_BASE_URL:-http://localhost:3000}"
AGENTS="${AGENTS_BASE_URL:-http://localhost:8000}"
USER_ID="${SMOKE_USER_ID:-smoke-user}"

sign() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local ts
  ts="$(date +%s)"
  local sig
  sig="$(printf '%s%s%s%s' "$ts" "$method" "$path" "$body" \
    | openssl dgst -sha256 -hmac "$SECRET" -hex \
    | awk '{print $NF}')"
  echo "X-Inhale-User-Id: $USER_ID|X-Inhale-Ts: $ts|X-Inhale-Sig: $sig"
}

hit() {
  local method="$1" base="$2" path="$3" body="${4:-}"
  local headers
  headers="$(sign "$method" "$path" "$body")"
  IFS='|' read -r h1 h2 h3 <<< "$headers"
  if [[ -n "$body" ]]; then
    curl -s -o /tmp/smoke.body -w "%{http_code}" -X "$method" \
      -H "$h1" -H "$h2" -H "$h3" -H "Content-Type: application/json" \
      -d "$body" "$base$path"
  else
    curl -s -o /tmp/smoke.body -w "%{http_code}" -X "$method" \
      -H "$h1" -H "$h2" -H "$h3" "$base$path"
  fi
  echo
  head -c 200 /tmp/smoke.body
  echo
  echo "---"
}

echo "## km: GET /api/notes/search?q=test&k=5"
hit GET "$KM" "/api/notes/search?q=test&k=5"

echo "## km: POST /api/notes (HMAC, no libraryId — should default-fallback)"
hit POST "$KM" "/api/notes" '{"title":"smoke","contentMd":"hello"}'

echo "## reader: GET /api/library?q=foo"
hit GET "$READER" "/api/library?q=foo"

echo "## reader: GET /api/pdfs/00000000-0000-0000-0000-000000000000/passages?q=x&k=3"
hit GET "$READER" "/api/pdfs/00000000-0000-0000-0000-000000000000/passages?q=x&k=3"

echo "## reader: GET /api/pdfs/00000000-0000-0000-0000-000000000000/pages/1/text"
hit GET "$READER" "/api/pdfs/00000000-0000-0000-0000-000000000000/pages/1/text"

echo "## reader: POST /api/pdfs/00000000-0000-0000-0000-000000000000/highlights"
hit POST "$READER" "/api/pdfs/00000000-0000-0000-0000-000000000000/highlights" \
  '{"page":1,"range":"0-50","note":"smoke"}'

echo "## agents: GET /agents/km/debug/loaded_skills?only=lit-triage&only=deep-read&only=synthesis"
# FastAPI Query(list[str]) wants repeated keys, NOT a comma-joined value
hit GET "$AGENTS" "/agents/km/debug/loaded_skills?only=lit-triage&only=deep-read&only=synthesis"

echo "## agents: GET /agents/km/state/00000000-0000-0000-0000-000000000000"
hit GET "$AGENTS" "/agents/km/state/00000000-0000-0000-0000-000000000000"

echo
echo "Expected:"
echo "  km/notes/search   200 with {results:[]}"
echo "  km/notes POST     201 if default library exists for smoke-user, else 400 'no_library' (smoke-user is unseeded — 400 is fine)"
echo "  reader/library    200 (may be empty)"
echo "  reader/passages   200 with {results:[]} OR 404 if doc not found"
echo "  reader/pages      404 'page text not extracted' for fake doc"
echo "  reader/highlights 404 doc-not-found OR 400 schema mismatch"
echo "  agents/debug      200 with [{name,tools,subagents}, ...] for 3 enabled skills"
echo "  agents/state      200 with {todos:[],pending_interrupts:[]}"
echo
echo "Failure signals to investigate:"
echo "  401 anywhere = HMAC sig mismatch (secret + path canonicalization)"
echo "  500 = server-side bug, check logs"
echo "  Connection refused = service not running on expected port"
