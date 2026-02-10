# 🔥 burnrate

Track your Claude Code token burn rate. Competitive leaderboard for your team.

## Quick Start

### 1. Deploy to Cloudflare

```bash
# Install dependencies
npm install

# Login to Cloudflare
npx wrangler login

# Create D1 database
npm run db:create
# Copy the database_id from output and paste into wrangler.toml

# Initialize database schema
npm run db:init:prod

# Deploy worker
npm run deploy
```

### 2. Configure Custom Domain

In Cloudflare Dashboard:
- Go to Workers & Pages → burnrate → Settings → Domains
- Add custom domain: `burnrate.autonomoustech.ca`

### 3. Use It

1. Visit https://burnrate.autonomoustech.ca
2. Register with your email
3. Copy the API key
4. Follow setup instructions to configure Claude Code hooks

## API Endpoints

- `POST /api/auth/register` - Create account, get API key
- `POST /api/usage/submit` - Submit ccusage JSON (authenticated)
- `GET /api/leaderboard/daily` - Today's leaderboard
- `GET /api/usage/me` - Your usage stats

## Local Development

```bash
# Start local dev server
npm run dev

# Initialize local database
npm run db:init

# Test locally
curl http://localhost:8787/
```

## Hook Script

Once you have your API key, create:

**`~/.claude/hooks/scripts/burnrate.sh`:**
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

**`~/.claude/settings.json`:**
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

## Tech Stack

- **Cloudflare Workers** - Serverless API
- **D1** - SQLite database
- **TypeScript** - Type-safe code
- **ccusage** - Claude Code usage parser

## Architecture

```
Claude Code → SessionEnd Hook → burnrate.sh → POST /api/usage/submit
                                                   ↓
                                              D1 Database
                                                   ↓
                                           Leaderboard API
```

## Database Schema

- **users** - Email, API key, display name
- **usage_logs** - Raw usage entries
- **daily_stats** - Aggregated daily totals

## License

MIT
