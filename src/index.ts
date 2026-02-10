export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
}

interface CorsHeaders {
  'Access-Control-Allow-Origin': string;
  'Access-Control-Allow-Methods': string;
  'Access-Control-Allow-Headers': string;
}

const corsHeaders: CorsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function generateId(): string {
  return crypto.randomUUID();
}

function generateApiKey(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return 'br_' + Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Route handlers
    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      return handleRegister(request, env);
    }

    if (url.pathname === '/api/usage/submit' && request.method === 'POST') {
      return handleUsageSubmit(request, env);
    }

    if (url.pathname === '/api/leaderboard/daily' && request.method === 'GET') {
      return handleLeaderboard(request, env, 'daily');
    }

    if (url.pathname === '/api/usage/me' && request.method === 'GET') {
      return handleMyUsage(request, env);
    }

    // Serve static HTML for root
    if (url.pathname === '/') {
      return new Response(getIndexHTML(), {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};

async function handleRegister(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { email: string; displayName?: string };
    
    if (!body.email) {
      return jsonResponse({ error: 'Email required' }, 400);
    }

    // Check if user exists
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(body.email)
      .first();

    if (existing) {
      return jsonResponse({ error: 'Email already registered' }, 409);
    }

    const userId = generateId();
    const apiKey = generateApiKey();
    const now = Date.now();

    await env.DB.prepare(
      'INSERT INTO users (id, email, api_key, display_name, created_at) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(userId, body.email, apiKey, body.displayName || null, now)
      .run();

    return jsonResponse({
      userId,
      apiKey,
      email: body.email,
    });
  } catch (error) {
    return jsonResponse({ error: 'Registration failed' }, 500);
  }
}

async function handleUsageSubmit(request: Request, env: Env): Promise<Response> {
  try {
    // Extract API key from Authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Missing API key' }, 401);
    }

    const apiKey = authHeader.substring(7);

    // Verify API key and get user
    const user = await env.DB.prepare('SELECT id FROM users WHERE api_key = ?')
      .bind(apiKey)
      .first<{ id: string }>();

    if (!user) {
      return jsonResponse({ error: 'Invalid API key' }, 401);
    }

    // Parse ccusage JSON output
    const body = await request.json() as any;

    // ccusage daily --json returns: { data: [...] }
    const entries = body.data || [body];

    const now = Date.now();
    let inserted = 0;

    for (const entry of entries) {
      const logId = generateId();
      const date = entry.date || new Date().toISOString().split('T')[0];
      
      // Insert usage log
      await env.DB.prepare(`
        INSERT INTO usage_logs 
        (id, user_id, date, model, input_tokens, output_tokens, cache_create_tokens, cache_read_tokens, cost_usd, project, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        logId,
        user.id,
        date,
        entry.model || 'unknown',
        entry.inputTokens || 0,
        entry.outputTokens || 0,
        entry.cacheCreateTokens || 0,
        entry.cacheReadTokens || 0,
        entry.cost || 0,
        entry.project || null,
        now
      ).run();

      // Update daily stats
      const totalTokens = (entry.inputTokens || 0) + (entry.outputTokens || 0) + 
                         (entry.cacheCreateTokens || 0) + (entry.cacheReadTokens || 0);

      await env.DB.prepare(`
        INSERT INTO daily_stats (user_id, date, total_tokens, total_cost)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, date) DO UPDATE SET
          total_tokens = total_tokens + excluded.total_tokens,
          total_cost = total_cost + excluded.total_cost
      `).bind(user.id, date, totalTokens, entry.cost || 0).run();

      inserted++;
    }

    return jsonResponse({ success: true, inserted });
  } catch (error) {
    console.error('Usage submit error:', error);
    return jsonResponse({ error: 'Failed to submit usage' }, 500);
  }
}

async function handleLeaderboard(request: Request, env: Env, period: string): Promise<Response> {
  try {
    const today = new Date().toISOString().split('T')[0];

    const results = await env.DB.prepare(`
      SELECT 
        u.display_name,
        u.email,
        u.is_public,
        s.total_tokens,
        s.total_cost
      FROM daily_stats s
      JOIN users u ON s.user_id = u.id
      WHERE s.date = ?
      ORDER BY s.total_tokens DESC
      LIMIT 10
    `).bind(today).all();

    const leaderboard = results.results?.map((row: any, index: number) => ({
      rank: index + 1,
      name: row.is_public ? (row.display_name || row.email.split('@')[0]) : 'Anonymous',
      tokens: row.total_tokens,
      cost: row.total_cost,
    })) || [];

    return jsonResponse({ period, date: today, leaderboard });
  } catch (error) {
    return jsonResponse({ error: 'Failed to fetch leaderboard' }, 500);
  }
}

async function handleMyUsage(request: Request, env: Env): Promise<Response> {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Missing API key' }, 401);
    }

    const apiKey = authHeader.substring(7);
    const user = await env.DB.prepare('SELECT id, email, display_name FROM users WHERE api_key = ?')
      .bind(apiKey)
      .first<{ id: string; email: string; display_name: string }>();

    if (!user) {
      return jsonResponse({ error: 'Invalid API key' }, 401);
    }

    const today = new Date().toISOString().split('T')[0];

    const stats = await env.DB.prepare(`
      SELECT 
        date,
        total_tokens,
        total_cost
      FROM daily_stats
      WHERE user_id = ?
      ORDER BY date DESC
      LIMIT 30
    `).bind(user.id).all();

    return jsonResponse({
      email: user.email,
      displayName: user.display_name,
      stats: stats.results || [],
    });
  } catch (error) {
    return jsonResponse({ error: 'Failed to fetch usage' }, 500);
  }
}

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

function getIndexHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>burnrate - Track Your Claude Code Token Usage</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
      min-height: 100vh;
      padding: 2rem;
    }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { font-size: 3rem; margin-bottom: 1rem; }
    .tagline { font-size: 1.5rem; opacity: 0.9; margin-bottom: 3rem; }
    .card {
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 2rem;
      margin-bottom: 2rem;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }
    .form-group { margin-bottom: 1.5rem; }
    label { display: block; margin-bottom: 0.5rem; font-weight: 500; }
    input {
      width: 100%;
      padding: 0.75rem;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
      font-size: 1rem;
    }
    input::placeholder { color: rgba(255, 255, 255, 0.5); }
    button {
      background: #fff;
      color: #667eea;
      padding: 0.75rem 2rem;
      border-radius: 8px;
      border: none;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
    }
    button:hover { transform: translateY(-2px); }
    .code-block {
      background: rgba(0, 0, 0, 0.3);
      padding: 1rem;
      border-radius: 8px;
      font-family: 'Courier New', monospace;
      font-size: 0.9rem;
      overflow-x: auto;
      margin: 1rem 0;
    }
    .success { color: #4ade80; }
    .error { color: #f87171; }
    #setupInstructions { display: none; }
    .leaderboard { margin-top: 2rem; }
    .leaderboard-item {
      display: flex;
      justify-content: space-between;
      padding: 0.75rem;
      background: rgba(255, 255, 255, 0.05);
      margin-bottom: 0.5rem;
      border-radius: 8px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔥 burnrate</h1>
    <p class="tagline">Track your Claude Code token burn rate</p>

    <div class="card">
      <h2>Get Started</h2>
      <form id="registerForm">
        <div class="form-group">
          <label for="email">Email</label>
          <input type="email" id="email" placeholder="you@example.com" required>
        </div>
        <div class="form-group">
          <label for="displayName">Display Name (optional)</label>
          <input type="text" id="displayName" placeholder="Your Name">
        </div>
        <button type="submit">Generate API Key</button>
      </form>
      <div id="result"></div>
    </div>

    <div id="setupInstructions" class="card">
      <h2>Setup Instructions</h2>
      <p>1. Create hook script:</p>
      <div class="code-block">mkdir -p ~/.claude/hooks/scripts
cat > ~/.claude/hooks/scripts/burnrate.sh << 'EOF'
#!/bin/bash
API_KEY="<span id="apiKeyPlaceholder"></span>"
API_URL="https://burnrate.autonomoustech.ca/api/usage/submit"

npx ccusage@latest --json | curl -X POST "$API_URL" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $API_KEY" \\
  -d @-

echo "✅ Usage submitted to burnrate"
EOF
chmod +x ~/.claude/hooks/scripts/burnrate.sh</div>

      <p>2. Configure Claude Code hooks:</p>
      <div class="code-block">cat > ~/.claude/settings.json << 'EOF'
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
EOF</div>

      <p>3. Test it:</p>
      <div class="code-block">~/.claude/hooks/scripts/burnrate.sh</div>
    </div>

    <div class="card leaderboard">
      <h2>Today's Leaderboard</h2>
      <div id="leaderboardContent">Loading...</div>
    </div>
  </div>

  <script>
    document.getElementById('registerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const displayName = document.getElementById('displayName').value;

      try {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, displayName: displayName || null }),
        });

        const data = await response.json();

        if (response.ok) {
          document.getElementById('result').innerHTML = 
            '<p class="success">✅ API Key generated!</p>' +
            '<div class="code-block">' + data.apiKey + '</div>' +
            '<p>⚠️ Save this key - you won\\'t see it again!</p>';
          
          document.getElementById('apiKeyPlaceholder').textContent = data.apiKey;
          document.getElementById('setupInstructions').style.display = 'block';
        } else {
          document.getElementById('result').innerHTML = 
            '<p class="error">❌ ' + data.error + '</p>';
        }
      } catch (error) {
        document.getElementById('result').innerHTML = 
          '<p class="error">❌ Registration failed</p>';
      }
    });

    // Load leaderboard
    async function loadLeaderboard() {
      try {
        const response = await fetch('/api/leaderboard/daily');
        const data = await response.json();
        
        const html = data.leaderboard.map(item => 
          '<div class="leaderboard-item">' +
          '<span>' + item.rank + '. ' + item.name + '</span>' +
          '<span>' + item.tokens.toLocaleString() + ' tokens ($' + item.cost.toFixed(2) + ')</span>' +
          '</div>'
        ).join('');

        document.getElementById('leaderboardContent').innerHTML = html || '<p>No entries yet - be the first!</p>';
      } catch (error) {
        document.getElementById('leaderboardContent').innerHTML = '<p>Failed to load leaderboard</p>';
      }
    }

    loadLeaderboard();
    setInterval(loadLeaderboard, 30000); // Refresh every 30s
  </script>
</body>
</html>`;
}
