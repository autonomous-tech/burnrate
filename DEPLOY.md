# Deployment Guide

## Step 1: Create D1 Database

```bash
cd ~/clawd/repos/burnrate
npx wrangler d1 create burnrate
```

**Output will look like:**
```
✅ Successfully created DB 'burnrate' in region WEUR
Created your database using D1's new storage backend.

[[d1_databases]]
binding = "DB"
database_name = "burnrate"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**Copy the `database_id` and update `wrangler.toml`:**
```toml
[[d1_databases]]
binding = "DB"
database_name = "burnrate"
database_id = "paste-your-database-id-here"
```

## Step 2: Initialize Database Schema

```bash
# Initialize production database
npx wrangler d1 execute burnrate --remote --file=./schema.sql
```

## Step 3: Deploy Worker

```bash
# Deploy to Cloudflare
npx wrangler deploy
```

**Output:**
```
Published burnrate (2.34 sec)
  https://burnrate.your-subdomain.workers.dev
```

## Step 4: Configure Custom Domain

1. Go to Cloudflare Dashboard: https://dash.cloudflare.com
2. Navigate to: **Workers & Pages** → **burnrate** → **Settings** → **Domains**
3. Click **Add custom domain**
4. Enter: `burnrate.autonomoustech.ca`
5. Click **Add domain**

Cloudflare will automatically configure DNS records.

## Step 5: Test

```bash
# Test registration
curl -X POST https://burnrate.autonomoustech.ca/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","displayName":"Test User"}'

# Expected response:
# {"userId":"...","apiKey":"br_...","email":"test@example.com"}
```

## Local Development

```bash
# Start local dev server with local D1 database
npx wrangler dev

# Initialize local database (first time only)
npx wrangler d1 execute burnrate --local --file=./schema.sql

# Test locally
curl http://localhost:8787/
```

## Troubleshooting

### "Error: Unknown binding DB"
- Make sure you've created the D1 database and updated `wrangler.toml` with the correct `database_id`

### "Database not found"
- Run the schema initialization: `npm run db:init:prod`

### Custom domain not working
- Wait 5-10 minutes for DNS propagation
- Check DNS records in Cloudflare DNS dashboard
- Verify domain is added in Workers & Pages settings

## Monitoring

- **Logs:** `npx wrangler tail`
- **Analytics:** Cloudflare Dashboard → Workers & Pages → burnrate → Analytics
- **Database:** `npx wrangler d1 execute burnrate --remote --command="SELECT COUNT(*) FROM users"`
