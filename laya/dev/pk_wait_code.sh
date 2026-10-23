#!/usr/bin/env bash
# Hands the lobby's verification code to a running `dev/pk_player.mjs`.
#
# The player script cannot read the mailbox itself: it runs in a sandbox where
# every child-process spawn fails with EBUSY. So it publishes a request file and
# this companion (which runs under bash, where spawning is fine) answers it by
# reading the code over IMAP on the gateway.
#
# Usage:  bash dev/pk_wait_code.sh <rendezvous-dir> <user> <email-address> [timeout]
#
# Run it BEFORE the player script: it waits for the request marker, fetches the
# code, and writes it next to the marker.
set -euo pipefail

RV="${1:?rendezvous directory is required}"
USER_NAME="${2:?player user is required}"
ADDRESS="${3:?e-mail address is required}"
TIMEOUT="${4:-180}"

REQUEST="$RV/code-requested-$USER_NAME.txt"
ANSWER="$RV/code-$USER_NAME.txt"
RSH="D:/gotouhou/tools/rsh.sh"
FETCH="/root/gotouhou/Gensoulkyo/tools/fetch_email_code.py"

rm -f "$REQUEST" "$ANSWER"
mkdir -p "$RV"

echo "[wait-code] waiting for $USER_NAME to request a code at $REQUEST"
waited=0
while [ ! -f "$REQUEST" ]; do
  sleep 1
  waited=$((waited + 1))
  if [ "$waited" -ge "$TIMEOUT" ]; then
    echo "[wait-code] no code request after ${TIMEOUT}s" >&2
    exit 1
  fi
done

echo "[wait-code] request seen for $ADDRESS; reading the mailbox"
CODE="$(bash "$RSH" "python3 $FETCH $ADDRESS --timeout 150" | tr -d '[:space:]')"
if ! printf '%s' "$CODE" | grep -Eq '^[0-9]{6}$'; then
  echo "[wait-code] no 6-digit code arrived (got '$CODE')" >&2
  exit 1
fi

printf '%s' "$CODE" > "$ANSWER"
echo "[wait-code] delivered code for $ADDRESS -> $ANSWER"
