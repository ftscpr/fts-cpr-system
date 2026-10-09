/**
 * Vercel serverless function: the only door between the browser and Google Apps Script.
 *  • Adds the shared secret (the browser never sees it) so Apps Script rejects anyone else.
 *  • Hides the Apps Script URL from the browser.
 *  • Passes the caller's IP and browser name for the audit log.
 * Environment variables (Vercel → Project → Settings → Environment Variables):
 *   APPS_SCRIPT_URL    the Web App URL ending in /exec
 *   API_SHARED_SECRET  the secret shown by the Sheet menu "FTS CPR → Show API secret"
 */
const ACTIONS = /^(auth|chapter|report|file|photo|national)\.[A-Za-z]+$/;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ok: false, error: {code: 'METHOD', message: 'Not allowed.'}});
  const url = process.env.APPS_SCRIPT_URL, secret = process.env.API_SHARED_SECRET;
  if (!url || !secret) return res.status(500).json({ok: false, error: {code: 'CONFIG', message: 'The app is not connected to its server yet. Please contact the National Office.'}});
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object' || !ACTIONS.test(String(body.action || ''))) return res.status(400).json({ok: false, error: {code: 'BAD_REQUEST', message: 'Bad request.'}});
  const payload = JSON.stringify({
    secret, action: body.action, token: typeof body.token === 'string' ? body.token.slice(0, 100) : '', payload: body.payload || {},
    meta: {ip: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim().slice(0, 64), ua: String(req.headers['user-agent'] || '').slice(0, 200)}
  });
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 55000);
  try {
    const r = await fetch(url, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: payload, redirect: 'follow', signal: ctrl.signal});
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch (e) {
      console.error('Apps Script returned non-JSON', r.status, text.slice(0, 300));
      return res.status(502).json({ok: false, error: {code: 'UPSTREAM', message: 'The server is busy. Please try again in a minute.'}});
    }
    return res.status(200).json(json);
  } catch (e) {
    console.error('Apps Script call failed', e && e.message);
    return res.status(504).json({ok: false, error: {code: 'UPSTREAM', message: 'The server took too long to answer. Please try again.'}});
  } finally { clearTimeout(timer); }
};
