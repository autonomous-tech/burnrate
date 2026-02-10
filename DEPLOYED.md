# 🔥 burnrate - DEPLOYED

## Live URLs

- **Production:** https://burnrate.autonomoustech.ca
- **Workers URL:** https://burnrate.autonomous-technologies-inc.workers.dev

## Deployment Details

**Date:** 2026-02-10  
**Account:** Autonomous Technologies Inc (`12e483cac08ce486262e6cd63a88026f`)  
**Region:** EEUR (Eastern Europe)  
**Database:** `burnrate` (`ddf5e84d-d9d1-4d52-b978-2928cd26f93c`)

## What's Working

✅ **Frontend**
- Registration form with email + display name
- Auto-generated API key display
- Copy-paste hook setup instructions
- Live leaderboard (refreshes every 30s)

✅ **API Endpoints**
- `POST /api/auth/register` - Create account
- `POST /api/usage/submit` - Submit ccusage data
- `GET /api/leaderboard/daily` - Daily rankings
- `GET /api/usage/me` - Personal stats

✅ **Database**
- 3 tables: users, usage_logs, daily_stats
- Indexes for performance
- Automatic aggregation on insert

## How to Use

### 1. Register

Visit https://burnrate.autonomoustech.ca and enter your email to get an API key.

**Example:**
```bash
curl -X POST https://burnrate.autonomoustech.ca/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","displayName":"Your Name"}'

# Response:
# {
#   "userId": "...",
#   "apiKey": "br_...",
#   "email": "you@example.com"
# }
```

### 2. Setup Claude Code Hook

Create `~/.claude/hooks/scripts/burnrate.sh`:

```bash
#!/bin/bash
API_KEY="your-api-key-here"
API_URL="https://burnrate.autonomoustech.ca/api/usage/submit"

npx ccusage@latest --json | curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d @-

echo "✅ Usage submitted to burnrate"
```

Make it executable:
```bash
chmod +x ~/.claude/hooks/scripts/burnrate.sh
```

Configure Claude Code (`~/.claude/settings.json`):
```json
{
  "hooks": {
    "SessionEnd": [
      {
        "type": "command",
        "command": "~/.claude/hooks/scripts/burnrate.sh"
      }
    ]
  }
}
```

### 3. Test It

```bash
# Test with sample data
cd ~/clawd/repos/burnrate
./test-hook.sh your-api-key-here

# Or trigger manually after a Claude session
~/.claude/hooks/scripts/burnrate.sh
```

### 4. View Leaderboard

Visit https://burnrate.autonomoustech.ca to see daily rankings.

**API:**
```bash
curl https://burnrate.autonomoustech.ca/api/leaderboard/daily | jq
```

## Data Format

burnrate accepts ccusage JSON format:

```json
{
  "data": [
    {
      "date": "2026-02-10",
      "model": "claude-sonnet-4-5",
      "inputTokens": 1245,
      "outputTokens": 3456,
      "cacheCreateTokens": 512,
      "cacheReadTokens": 256,
      "cost": 0.15,
      "project": "my-project"
    }
  ]
}
```

## Monitoring

**Worker Logs:**
```bash
CLOUDFLARE_API_TOKEN="..." npx wrangler tail burnrate
```

**Database Queries:**
```bash
# Count users
CLOUDFLARE_API_TOKEN="..." npx wrangler d1 execute burnrate --remote --command="SELECT COUNT(*) FROM users"

# View today's stats
CLOUDFLARE_API_TOKEN="..." npx wrangler d1 execute burnrate --remote --command="SELECT * FROM daily_stats WHERE date = date('now')"
```

**Analytics:**
https://dash.cloudflare.com/12e483cac08ce486262e6cd63a88026f/workers/burnrate/analytics

## Updates

To deploy changes:
```bash
cd ~/clawd/repos/burnrate
CLOUDFLARE_API_TOKEN="..." npx wrangler deploy
```

## Database Schema

See `schema.sql` for full schema.

**Key tables:**
- `users` - Email, API key, display name, privacy settings
- `usage_logs` - Raw usage entries (tokens, cost, model, date)
- `daily_stats` - Aggregated totals for leaderboard

## Privacy

Users can control visibility:
- `is_public = 0` → Show as "Anonymous" on leaderboard
- `is_public = 1` → Show display name/email prefix

To update privacy settings, modify the database or add an API endpoint.

## Next Steps

**Potential features:**
- Weekly/monthly leaderboards
- Project-level breakdowns
- Cost projections
- Team analytics
- API key regeneration
- Profile page with usage graphs
- CSV export
- Webhook notifications

## Support

Issues or questions? Check the logs or reach out to Abdullah.
