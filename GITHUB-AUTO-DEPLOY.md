# GitHub Auto-Deploy Configuration

## ✅ Status: WORKING

burnrate is now configured with automatic deployment from GitHub to Cloudflare Workers.

## Repository

**GitHub:** https://github.com/autonomous-tech/burnrate  
**Organization:** autonomous-tech  
**Visibility:** Public

## Auto-Deploy Setup

### GitHub Actions Workflow

**File:** `.github/workflows/deploy.yml`

**Triggers:**
- Push to `master` branch
- Push to `main` branch

**Process:**
1. Checkout code
2. Setup Node.js 20
3. Install dependencies (`npm ci`)
4. Deploy to Cloudflare Workers using `wrangler-action@v3`

### GitHub Secrets

Two secrets are configured:

1. **CLOUDFLARE_API_TOKEN**
   - Cloudflare API token with Workers:Edit and D1:Edit permissions
   - Added: 2026-02-10

2. **CLOUDFLARE_ACCOUNT_ID**
   - Account: `12e483cac08ce486262e6cd63a88026f`
   - Added: 2026-02-10

### Deployment History

| Run | Status | Version | Time |
|-----|--------|---------|------|
| `21877520919` | ✅ Success | `32d874c9-6fab-4fdd-9019-97007c3fd941` | 27s |
| `21877480396` | ❌ Failed | - | Package lock mismatch |
| `21877463499` | ❌ Failed | - | Package lock mismatch |

**Latest successful deploy:** 2026-02-10 18:31:56 UTC

## How It Works

1. **Developer pushes to GitHub:**
   ```bash
   git add .
   git commit -m "feat: new feature"
   git push origin master
   ```

2. **GitHub Actions triggers automatically**
   - Workflow starts within seconds
   - Takes ~25-30 seconds to complete

3. **Cloudflare Workers updated**
   - New version deployed to `burnrate.autonomoustech.ca`
   - Zero downtime deployment
   - Old version remains available during rollout

## Manual Deployment (Legacy)

Manual deployment still works if needed:

```bash
cd ~/clawd/repos/burnrate
CLOUDFLARE_API_TOKEN="..." npx wrangler deploy
```

But with auto-deploy, you rarely need this.

## Workflow Monitoring

### View Runs

```bash
# List recent runs
gh run list --repo autonomous-tech/burnrate --limit 10

# Watch a specific run
gh run watch <run-id> --repo autonomous-tech/burnrate

# View logs
gh run view <run-id> --repo autonomous-tech/burnrate --log
```

### GitHub Actions Dashboard

https://github.com/autonomous-tech/burnrate/actions

### Badges

Deployment status badge in README.md:

```markdown
[![Deploy to Cloudflare Workers](https://github.com/autonomous-tech/burnrate/actions/workflows/deploy.yml/badge.svg)](https://github.com/autonomous-tech/burnrate/actions/workflows/deploy.yml)
```

## Troubleshooting

### Deployment Fails

1. Check workflow logs:
   ```bash
   gh run view <run-id> --repo autonomous-tech/burnrate --log-failed
   ```

2. Common issues:
   - Package lock out of sync → Run `npm install` and commit
   - API token expired → Regenerate in Cloudflare Dashboard
   - Wrangler config error → Check `wrangler.toml`

### Secrets Expired

Update secrets:

```bash
# Update API token
echo "new-token" | gh secret set CLOUDFLARE_API_TOKEN --repo autonomous-tech/burnrate

# Update account ID
echo "new-account-id" | gh secret set CLOUDFLARE_ACCOUNT_ID --repo autonomous-tech/burnrate
```

### Manual Deployment Needed

If GitHub Actions is down:

```bash
cd ~/clawd/repos/burnrate
git pull
CLOUDFLARE_API_TOKEN="..." npx wrangler deploy
```

## Development Workflow

1. **Make changes locally:**
   ```bash
   cd ~/clawd/repos/burnrate
   # Edit files
   ```

2. **Test locally (optional):**
   ```bash
   npm run dev
   # Visit http://localhost:8787
   ```

3. **Commit and push:**
   ```bash
   git add .
   git commit -m "feat: description"
   git push
   ```

4. **Wait ~30 seconds for auto-deploy** ✅

5. **Verify at https://burnrate.autonomoustech.ca**

## Benefits

✅ **No manual deploy needed** - Just push to GitHub  
✅ **Fast** - Deploys in ~30 seconds  
✅ **Reliable** - GitHub Actions has 99.9% uptime  
✅ **Auditable** - Full deployment history in GitHub  
✅ **Rollback** - Previous versions available via Cloudflare  
✅ **Team-friendly** - Anyone with repo access can deploy  

## Future Enhancements

Potential improvements:

- [ ] Add staging environment (deploy on PR)
- [ ] Run tests before deploy
- [ ] Slack/Discord notifications on deploy
- [ ] Automatic database migrations
- [ ] Preview deployments for branches
- [ ] Deploy metrics to dashboard
