#!/usr/bin/env bash
# End-to-end API walkthrough in mock mode: donate -> sync -> payout -> open -> unlock -> redeem.
# Usage: start the API (npm run dev, or npm start), then: bash scripts/curl-walkthrough.sh [base-url]
# Needs curl and node (node parses the JSON, so jq is not required).
set -euo pipefail

B="${1:-http://localhost:8787}/api"
J="Content-Type: application/json"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=process.argv[1].split(".").reduce((o,k)=>o?.[k],JSON.parse(s));console.log(v??"")})' "$1"; }

echo "1. Health";            curl -s "$B/health"; echo
echo "2. Organizer login";   curl -s -c "$JAR" -H "$J" -d '{"email":"organizer@example.com","password":"change-me-now"}' "$B/auth/login"; echo
echo "3. Mock donation (2 ZEC) + sync"
curl -s -b "$JAR" -H "$J" -d '{"amountZat":200000000,"memo":"stay strong"}' "$B/dev/mock-donate" >/dev/null   # organizer session required
curl -s -b "$JAR" -X POST "$B/admin/sync" | field availableZat | sed 's/^/   availableZat: /'

echo "4. New payout: N50,000 medical"
CREATED="$(curl -s -b "$JAR" -H "$J" -d '{"amountNgn":50000,"category":"medical","expiresInDays":7}' "$B/admin/payouts")"
LINK="$(echo "$CREATED" | field link)"
PIN="$(echo "$CREATED" | field pin)"
ID="${LINK##*/c/}"; ID="${ID%%#*}"
SECRET="${LINK#*#}"
echo "   link: $LINK"
echo "   pin:  $PIN   (shown once; send it separately)"

echo "5. Recipient opens the link"; curl -s -H "$J" -d "{\"secret\":\"$SECRET\"}" "$B/claims/$ID/open"; echo
echo "6. Wrong PIN";                curl -s -H "$J" -d "{\"secret\":\"$SECRET\",\"pin\":\"$([ "$PIN" = 000000 ] && echo 111111 || echo 000000)\"}" "$B/claims/$ID/unlock"; echo
echo "7. Right PIN"
UNLOCKED="$(curl -s -H "$J" -d "{\"secret\":\"$SECRET\",\"pin\":\"$PIN\"}" "$B/claims/$ID/unlock")"
echo "   $(echo "$UNLOCKED" | field amountNgnDisplay) ($(echo "$UNLOCKED" | field amountZecDisplay))"
TOKEN="$(echo "$UNLOCKED" | field claimToken)"

echo "8. Redeem to a testnet address"
curl -s -H "$J" -d "{\"claimToken\":\"$TOKEN\",\"method\":\"zcash_address\",\"zcashAddress\":\"utest1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq\"}" "$B/claims/$ID/redeem"; echo
echo "9. Same token again (double claim)"
curl -s -H "$J" -d "{\"claimToken\":\"$TOKEN\",\"method\":\"zcash_address\",\"zcashAddress\":\"utest1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq\"}" "$B/claims/$ID/redeem"; echo

echo "10. Public transparency totals"; curl -s "$B/transparency" | field totals; echo
