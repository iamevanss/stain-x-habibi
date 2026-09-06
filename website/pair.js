/* Stain × Habibi — single-page pairing */
(function () {
  var API = (window.__STAIN_API__ || 'https://api.stainxhabibi.example').replace(/\/$/, '');
  var pollTimer = null;
  var pairToken = null;
  var lastSessionId = null;

  function $(id) { return document.getElementById(id); }

  function cleanPhone(v) {
    return String(v || '').replace(/\D/g, '');
  }

  function bootstrapTemplate(sessionId, ownerNumber) {
    var ownerLine = ownerNumber
      ? "const OWNER_NUMBER = '" + ownerNumber + "'"
      : "const OWNER_NUMBER = ''";
    return [
      '/**',
      ' * STAIN × HABIBI — USER BOOTSTRAP',
      ' * Upload as index.js | Start: node index.js',
      ' * Do NOT create a separate .env file.',
      ' */',
      '',
      "const SESSION_ID = '" + sessionId + "'",
      ownerLine,
      "const BOT_NAME = 'Stain × Habibi'",
      "const PREFIX = '.'",
      "const TELEGRAM_BOT_TOKEN = ''",
      '',
      '// Runtime restore needs Oracle pairing API online',
      "console.log('Session:', SESSION_ID)",
      "console.log('Owner:', OWNER_NUMBER || '(paired number)')",
      "console.log('Upload this file on your panel and run: node index.js')"
    ].join('\n');
  }

  function showCode(code) {
    $('block-code').hidden = false;
    $('pair-code').textContent = code;
    $('pair-status').className = 'status';
    $('pair-status').textContent = 'Waiting for you to connect on WhatsApp…';
    $('block-code').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function showDone(sessionId) {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    lastSessionId = sessionId;
    $('block-done').hidden = false;
    $('session-id').textContent = sessionId;
    $('connected-msg').textContent = 'Connected. Your Session ID is ready.';
    $('pair-status').className = 'status ok';
    $('pair-status').textContent = 'WhatsApp linked successfully.';
    var phone = cleanPhone($('phone').value);
    if (phone && !$('owner').value) $('owner').value = phone;
    $('block-done').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  var btnGen = $('btn-generate');
  if (btnGen) {
    btnGen.addEventListener('click', async function () {
      var status = $('phone-status');
      var phone = cleanPhone($('phone').value);
      status.className = 'status';
      status.textContent = '';
      if (phone.length < 10 || phone.length > 15) {
        status.className = 'status err';
        status.textContent = 'Enter a valid number with country code (10–15 digits).';
        return;
      }
      btnGen.disabled = true;
      status.textContent = 'Generating pairing code…';
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
          status.textContent = body.error || 'Pairing service is not online yet (Oracle backend required for live codes).';
          btnGen.disabled = false;
          return;
        }
        pairToken = body.token || body.pair_token || null;
        status.textContent = '';
        showCode(body.code);
        if (pairToken) {
          pollTimer = setInterval(async function () {
            try {
              var r = await fetch(API + '/v1/pair/status?token=' + encodeURIComponent(pairToken), {
                headers: { Accept: 'application/json' }
              });
              var st = {};
              try { st = await r.json(); } catch (e) {}
              if (st.status === 'paired' || st.status === 'active') {
                showDone(st.public_session_id || st.session_id);
              } else if (st.status === 'expired' || st.status === 'failed') {
                clearInterval(pollTimer);
                pollTimer = null;
                $('pair-status').className = 'status err';
                $('pair-status').textContent = st.error || 'Pairing expired or failed. Try again.';
              }
            } catch (e) {}
          }, 3000);
        }
      } catch (e) {
        status.className = 'status err';
        status.textContent = 'Cannot reach pairing API yet. UI is ready — Oracle backend still needed for live codes.';
      } finally {
        btnGen.disabled = false;
      }
    });
  }

  var btnCopy = $('btn-copy-id');
  if (btnCopy) {
    btnCopy.addEventListener('click', async function () {
      try {
        await navigator.clipboard.writeText(lastSessionId || $('session-id').textContent);
        btnCopy.textContent = 'Copied';
        setTimeout(function () { btnCopy.textContent = 'Copy Session ID'; }, 1500);
      } catch (e) {}
    });
  }

  var btnFinish = $('btn-finish');
  if (btnFinish) {
    btnFinish.addEventListener('click', function () {
      var sid = lastSessionId || $('session-id').textContent;
      if (!sid || sid.indexOf('·') !== -1) {
        $('finish-status').className = 'status err';
        $('finish-status').textContent = 'No Session ID yet. Connect WhatsApp first.';
        return;
      }
      var owner = cleanPhone($('owner').value);
      var text = bootstrapTemplate(sid, owner);
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
      a.download = 'index.js';
      a.click();
      URL.revokeObjectURL(a.href);
      $('finish-status').className = 'status ok';
      $('finish-status').textContent = 'Bootstrap downloaded. Upload as index.js → node index.js';
    });
  }
})();
