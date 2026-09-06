/* Stain x Habibi pairing frontend */
(function () {
  var API = (window.__STAIN_API__ || 'https://api.stainxhabibi.example').replace(/\/$/, '');
  var steps = [1, 2, 3, 4];
  var pollTimer = null;
  var pairToken = null;

  function $(id) { return document.getElementById(id); }

  function setStep(n) {
    steps.forEach(function (s) {
      var el = $('step-' + s);
      if (el) el.hidden = s !== n;
      var pill = document.querySelector('.step-pill[data-step="' + s + '"]');
      if (!pill) return;
      pill.classList.remove('active', 'done');
      if (s === n) pill.classList.add('active');
      else if (s < n) pill.classList.add('done');
    });
  }

  function cleanPhone(v) {
    return String(v || '').replace(/\D/g, '');
  }

  function bootstrapTemplate(sessionId) {
    return [
      '/**',
      ' * STAIN x HABIBI — USER BOOTSTRAP',
      ' * Upload as index.js | Start: node index.js',
      ' * Do NOT create a separate .env file.',
      ' */',
      '',
      "const SESSION_ID = '" + sessionId + "'",
      "const OWNER_NUMBER = ''",
      "const BOT_NAME = 'Stain x Habibi'",
      "const PREFIX = '.'",
      "const TELEGRAM_BOT_TOKEN = ''",
      '',
      '// DO NOT EDIT BELOW',
      "import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'",
      "import { execSync } from 'child_process'",
      "import { fileURLToPath } from 'url'",
      "import path from 'path'",
      "import https from 'https'",
      "import http from 'http'",
      '',
      'const __dirname = path.dirname(fileURLToPath(import.meta.url))',
      "const REPO_URL = 'https://github.com/iamevanss/stain-x-habibi.git'",
      "const BOT_DIR = path.join(__dirname, 'bot-runtime')",
      "const SESSION_API_URL = '" + API + "'",
      '',
      'function die(msg) { console.error("\\n" + msg + "\\n"); process.exit(1) }',
      'function requestJson(url) {',
      '  return new Promise((resolve, reject) => {',
      '    const lib = url.startsWith("https") ? https : http',
      '    const req = lib.get(url, { timeout: 30000 }, (res) => {',
      '      let data = ""',
      '      res.on("data", (c) => (data += c))',
      '      res.on("end", () => {',
      '        try { resolve({ status: res.statusCode, body: JSON.parse(data || "{}") }) }',
      '        catch { reject(new Error("Invalid response")) }',
      '      })',
      '    })',
      '    req.on("error", reject)',
      '    req.on("timeout", () => req.destroy(new Error("timeout")))',
      '  })',
      '}',
      '',
      'async function main() {',
      '  const sid = String(SESSION_ID || "").trim()',
      '  if (!sid || !/^STAIN-[A-Z0-9]{6}$/.test(sid)) die("Invalid SESSION_ID")',
      '  console.log("Session:", sid)',
      '  if (!existsSync(path.join(BOT_DIR, "package.json"))) {',
      '    console.log("[1/4] Downloading bot...")',
      '    execSync("git clone --depth 1 " + REPO_URL + " \"" + BOT_DIR + "\"", { stdio: "inherit", cwd: __dirname })',
      '  } else {',
      '    console.log("[1/4] Bot present")',
      '    try { execSync("git pull --ff-only", { stdio: "inherit", cwd: BOT_DIR }) } catch {}',
      '  }',
      '  const marker = path.join(BOT_DIR, "node_modules", "@whiskeysockets", "baileys")',
      '  if (!existsSync(marker)) {',
      '    console.log("[2/4] Installing...")',
      '    execSync("npm install --legacy-peer-deps", { stdio: "inherit", cwd: BOT_DIR, timeout: 300000 })',
      '  } else console.log("[2/4] Packages ready")',
      '  console.log("[3/4] Restoring session...")',
      '  const { status, body } = await requestJson(SESSION_API_URL + "/v1/session/restore?id=" + encodeURIComponent(sid))',
      '  if (status === 404) die("Session not found")',
      '  if (status === 401 || status === 403) die("Session revoked")',
      '  if (status !== 200 || !body || !body.auth) die("Restore failed HTTP " + status)',
      '  const authDir = path.join(BOT_DIR, "auth_info_baileys")',
      '  if (existsSync(authDir)) rmSync(authDir, { recursive: true, force: true })',
      '  mkdirSync(authDir, { recursive: true })',
      '  for (const [name, content] of Object.entries(body.auth)) {',
      '    writeFileSync(path.join(authDir, name), typeof content === "string" ? content : JSON.stringify(content, null, 2))',
      '  }',
      '  if (String(OWNER_NUMBER || "").trim()) process.env.OWNER_NUMBER = String(OWNER_NUMBER).replace(/\\D/g, "")',
      '  process.env.PREFIX = PREFIX || "."',
      '  process.env.BOT_NAME = BOT_NAME',
      '  process.env.SESSION_ID = sid',
      '  if (String(TELEGRAM_BOT_TOKEN || "").trim()) process.env.TELEGRAM_BOT_TOKEN = String(TELEGRAM_BOT_TOKEN).trim()',
      '  console.log("[4/4] Starting bot...")',
      '  process.chdir(BOT_DIR)',
      '  await import(path.join(BOT_DIR, "bot.js"))',
      '}',
      'main().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1) })',
      ''
    ].join('\n');
  }

  function showSuccess(sessionId) {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    setStep(4);
    $('session-id').textContent = sessionId;
    $('bootstrap-preview').textContent = bootstrapTemplate(sessionId);
    window.__lastBootstrap = bootstrapTemplate(sessionId);
    window.__lastSessionId = sessionId;
  }

  $('btn-start').addEventListener('click', function () { setStep(2); });
  document.querySelectorAll('[data-back]').forEach(function (btn) {
    btn.addEventListener('click', function () { setStep(Number(btn.getAttribute('data-back'))); });
  });

  $('btn-request').addEventListener('click', async function () {
    var status = $('phone-status');
    var phone = cleanPhone($('phone').value);
    status.className = 'status';
    status.textContent = '';
    if (phone.length < 10 || phone.length > 15) {
      status.className = 'status err';
      status.textContent = 'Enter a valid international number (10–15 digits).';
      return;
    }
    $('btn-request').disabled = true;
    status.textContent = 'Requesting pairing code…';
    try {
      var res = await fetch(API + '/v1/pair/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ phone: phone })
      });
      var body = {};
      try { body = await res.json(); } catch (e) {}
      if (res.status >= 400 || !body.code) {
        status.className = 'status err';
        status.textContent = body.error || 'Pairing service is not online yet. Oracle backend required for live codes.';
        $('btn-request').disabled = false;
        return;
      }
      pairToken = body.token || body.pair_token || null;
      $('pair-code').textContent = body.code;
      $('pair-status').className = 'status';
      $('pair-status').textContent = 'Waiting for confirmation on your phone…';
      setStep(3);
      if (pairToken) {
        pollTimer = setInterval(async function () {
          try {
            var r = await fetch(API + '/v1/pair/status?token=' + encodeURIComponent(pairToken), {
              headers: { Accept: 'application/json' }
            });
            var st = {};
            try { st = await r.json(); } catch (e) {}
            if (st.status === 'paired' || st.status === 'active') {
              showSuccess(st.public_session_id || st.session_id);
            } else if (st.status === 'expired' || st.status === 'failed') {
              clearInterval(pollTimer); pollTimer = null;
              $('pair-status').className = 'status err';
              $('pair-status').textContent = st.error || 'Pairing expired or failed.';
            }
          } catch (e) {}
        }, 3000);
      }
    } catch (e) {
      status.className = 'status err';
      status.textContent = 'Cannot reach pairing API yet. Frontend is live; Oracle backend still required.';
    } finally {
      $('btn-request').disabled = false;
    }
  });

  $('btn-cancel-pair').addEventListener('click', function () {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    setStep(2);
  });

  $('btn-copy-id').addEventListener('click', async function () {
    var id = window.__lastSessionId || $('session-id').textContent;
    try {
      await navigator.clipboard.writeText(id);
      $('btn-copy-id').textContent = 'Copied';
      setTimeout(function () { $('btn-copy-id').textContent = 'Copy Session ID'; }, 1500);
    } catch (e) {}
  });

  $('btn-download').addEventListener('click', function () {
    var text = window.__lastBootstrap || bootstrapTemplate($('session-id').textContent);
    var blob = new Blob([text], { type: 'text/javascript' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'index.js';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  setStep(1);
})();
