#!/usr/bin/env bash
set -euo pipefail

SENTINEL="${SENTINEL_URL:-http://localhost:8080}"
API_KEY="${SENTINEL_API_KEY:-dev-local-key}"
MEETING_ID="seed-meeting-$(date +%s)"

echo "seeding meeting $MEETING_ID with 3 synthetic speakers..."

speakers=("alice" "bob" "carol")
utterances=(
  "alice:Let's align on the Q3 roadmap priorities before we run out of time."
  "bob:I think the authentication refactor should be top priority given the security audit findings."
  "carol:Agreed on auth. We also need to ship the data pipeline changes for the analytics team."
  "alice:Can we scope the auth work to two sprints? The current estimate seems high."
  "bob:Two sprints is realistic if we drop the legacy SSO support for now."
  "carol:The analytics dependency is blocking two downstream teams, so let's not slip that one."
  "alice:Okay, auth in sprint one, data pipeline in sprint two, legacy SSO deferred."
  "bob:Works for me. I'll update the board after this."
  "carol:Same. I'll send a summary to the stakeholders."
)

seq=0
for entry in "${utterances[@]}"; do
  speaker="${entry%%:*}"
  text="${entry#*:}"
  seq=$((seq + 1))

  # connect via WS and send one utterance
  ts_ms=$(python3 -c "import time; print(int(time.time()*1000))")
  payload=$(printf '{"type":"text_chunk","meeting_id":"%s","speaker_id":"%s","seq":%d,"ts_client_ms":%d,"payload":"%s"}' \
    "$MEETING_ID" "$speaker" "$seq" "$ts_ms" "$text")

  # use websocat if available, otherwise skip WS and POST directly to a debug endpoint
  if command -v websocat &>/dev/null; then
    ws_url="ws://$(echo "$SENTINEL" | sed 's|^https://||;s|^http://||')/ws?meetingId=${MEETING_ID}&token=${API_KEY}"
    echo "$payload" | websocat -1 "$ws_url" || true
  else
    echo "websocat not found — skipping live WS seed (install with: brew install websocat)"
  fi

  sleep 0.2
done

echo "seed complete for meeting $MEETING_ID"
