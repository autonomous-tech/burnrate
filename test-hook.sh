#!/bin/bash
# Test hook script for burnrate
# Replace API_KEY with your actual key from registration

API_KEY="${1:-your-api-key-here}"
API_URL="https://burnrate.autonomoustech.ca/api/usage/submit"

# Generate sample ccusage data (simulating ccusage --json output)
cat <<EOF | curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d @-
{
  "data": [
    {
      "date": "$(date +%Y-%m-%d)",
      "model": "claude-sonnet-4-5",
      "inputTokens": 1245,
      "outputTokens": 3456,
      "cacheCreateTokens": 512,
      "cacheReadTokens": 256,
      "cost": 0.15,
      "project": "test-project"
    }
  ]
}
EOF

echo ""
echo "✅ Test usage submitted to burnrate"
