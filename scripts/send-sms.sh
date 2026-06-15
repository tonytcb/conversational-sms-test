#!/usr/bin/env bash
# Thin wrapper around the Node-based inbound SMS simulator.
# Usage: ./scripts/send-sms.sh <from> <to> <body>
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/send-sms.mjs" "$@"
