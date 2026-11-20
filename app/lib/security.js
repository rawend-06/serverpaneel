'use strict';
/*
 * Inloggen met Face ID / vingerafdruk (passkeys, WebAuthn) en "even bevestigen" voor gevaarlijke acties
 * (server herstarten, terminal openen, agenda verwijderen ...).
 * Je gezicht/vingerafdruk verlaat je gsm nooit: het paneel krijgt enkel een handtekening.
 */
const crypto = require('crypto');
const wa = require('@simplewebauthn/server');

module.exports = function security(ctx) {
  const { wrap, bad, auth, saveAuth } = ctx;
  const challenges = new Map(); // id -> { challenge, rpID, origin, kind, t, session }
  const STEPUP_MS = 10 * 60 * 1000;

  function originOf(req) {
    const host = req.headers['x-forwarded-host'] || req.headers.host || '';
    const proto = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const rpID = host.replace(/:\d+$/, '');
    return { rpID, origin: `${proto}://${host}`, secure: proto === 'https' || rpID === 'localhost' };
  }
  function keep(kind, req, challenge, session) {
    const id = crypto.randomBytes(12).toString('hex');
    const o = originOf(req);
    challenges.set(id, { challenge, kind, rpID: o.rpID, origin: o.origin, t: Date.now(), session });
    for (const [k, v] of challenges) if (Date.now() - v.t > 5 * 60e3) challenges.delete(k);
    return id;
  }
  function take(id, kind) { const c = challenges.get(id); challenges.delete(id); if (!c || c.kind !== kind || Date.now() - c.t > 5 * 60e3) throw bad('Te lang gewacht, probeer opnieuw'); return c; }
  const passkeys = () => (auth() && auth().passkeys) || [];
  const b64 = (u8) => Buffer.from(u8).toString('base64url');

  // ------------------------------------------------------------ bevestigen (step-up)
  function stepUpOk(req) { const s = ctx.sessionOf(req); return !!(s && s.stepUpAt && Date.now() - s.stepUpAt < STEPUP_MS); }
  async function requireStepUp(req, what) {
    if (ctx.DEMO) return;
    if (stepUpOk(req)) return;
    const e = new Error(`Bevestig even dat jij het bent om ${what}.`); e.status = 403; e.code = 'STEP_UP'; throw e;
  }

  function routes(app, { publicRoutes = false } = {}) {
    if (publicRoutes) {
      // ---- inloggen met passkey (zonder sessie)
      app.post('/api/passkey/login/options', wrap(async (req, res) => {
        const o = originOf(req);
        if (!o.secure) throw bad('Face ID werkt enkel via https (je domein), niet via het lokale IP-adres.');
        const mine = passkeys().filter((p) => p.rpID === o.rpID);
        if (!mine.length) throw bad('Nog geen Face ID / vingerafdruk ingesteld voor dit adres. Log in met je wachtwoord en zet het aan bij Instellingen.');
        const opts = await wa.generateAuthenticationOptions({ rpID: o.rpID, userVerification: 'required', allowCredentials: mine.map((p) => ({ id: p.id, transports: p.transports })) });
        res.json({ id: keep('login', req, opts.challenge), options: opts });
      }));
      app.post('/api/passkey/login/verify', wrap(async (req, res) => {
        const ip = req.ip;
        if (ctx.tooManyFailures(ip)) throw bad('Te veel foute pogingen. Probeer over 15 minuten opnieuw.', 429);
        const c = take(req.body.id, 'login');
        const resp = req.body.response || {};
        const pk = passkeys().find((p) => p.id === resp.id && p.rpID === c.rpID);
        if (!pk) { ctx.addFailure(ip); throw bad('Deze Face ID / sleutel is niet (meer) gekoppeld', 401); }
        let v;
        try { v = await wa.verifyAuthenticationResponse({ response: resp, expectedChallenge: c.challenge, expectedOrigin: c.origin, expectedRPID: c.rpID, credential: { id: pk.id, publicKey: Buffer.from(pk.publicKey, 'base64url'), counter: pk.counter || 0, transports: pk.transports }, requireUserVerification: true }); }
        catch (e) { ctx.addFailure(ip); throw bad(`Inloggen mislukt: ${e.message}`, 401); }
        if (!v.verified) { ctx.addFailure(ip); throw bad('Inloggen mislukt', 401); }
        pk.counter = v.authenticationInfo.newCounter; pk.lastUsed = Date.now(); saveAuth();
        ctx.createSession(req, res, { stepUpAt: Date.now() });
        res.json({ ok: true });
      }));
      app.get('/api/passkey/available', (req, res) => { const o = originOf(req); res.json({ secure: o.secure, count: passkeys().filter((p) => p.rpID === o.rpID).length }); });
      return;
    }
    // ---- passkeys beheren (ingelogd)
    app.get('/api/passkeys', (req, res) => { const o = originOf(req); res.json({ secure: o.secure, rpID: o.rpID, list: passkeys().map((p) => ({ id: p.id, name: p.name, rpID: p.rpID, createdAt: p.createdAt, lastUsed: p.lastUsed || 0, here: p.rpID === o.rpID })) }); });
    app.post('/api/passkeys/options', wrap(async (req, res) => {
      const o = originOf(req);
      if (!o.secure) throw bad('Face ID instellen kan enkel via https (open het paneel via je domein).');
      const a = auth(); if (!a.userId) { a.userId = crypto.randomBytes(16).toString('base64url'); saveAuth(); }
      const opts = await wa.generateRegistrationOptions({
        rpName: 'Rawendpaneel', rpID: o.rpID, userName: ctx.CFG.hostName || 'rawend', userDisplayName: 'Rawendpaneel', userID: Buffer.from(a.userId, 'base64url'),
        attestationType: 'none', excludeCredentials: passkeys().filter((p) => p.rpID === o.rpID).map((p) => ({ id: p.id, transports: p.transports })),
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      });
      res.json({ id: keep('register', req, opts.challenge), options: opts });
    }));
    app.post('/api/passkeys/verify', wrap(async (req, res) => {
      const c = take(req.body.id, 'register');
      let v;
      try { v = await wa.verifyRegistrationResponse({ response: req.body.response, expectedChallenge: c.challenge, expectedOrigin: c.origin, expectedRPID: c.rpID, requireUserVerification: true }); }
      catch (e) { throw bad(`Instellen mislukt: ${e.message}`); }
      if (!v.verified || !v.registrationInfo) throw bad('Instellen mislukt');
      const cred = v.registrationInfo.credential;
      const a = auth(); a.passkeys = a.passkeys || [];
      const ua = String(req.headers['user-agent'] || '');
      const name = String(req.body.name || '').slice(0, 40) || (/iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Toestel');
      a.passkeys.push({ id: cred.id, publicKey: b64(cred.publicKey), counter: cred.counter || 0, transports: cred.transports || req.body.response?.response?.transports || [], name, rpID: c.rpID, createdAt: Date.now() });
      saveAuth(); res.json({ ok: true, name });
    }));
    app.delete('/api/passkeys/:id', wrap(async (req, res) => { const a = auth(); a.passkeys = passkeys().filter((p) => p.id !== req.params.id); saveAuth(); res.json({ ok: true }); }));

    // ---- bevestigen voor een gevaarlijke actie
    app.get('/api/stepup', (req, res) => { const o = originOf(req); res.json({ ok: stepUpOk(req), passkey: o.secure && passkeys().some((p) => p.rpID === o.rpID), totp: !!(auth() && auth().totpEnabled) }); });
    app.post('/api/stepup/options', wrap(async (req, res) => {
      const o = originOf(req); const mine = passkeys().filter((p) => p.rpID === o.rpID);
      if (!o.secure || !mine.length) throw bad('Geen Face ID beschikbaar op dit adres');
      const opts = await wa.generateAuthenticationOptions({ rpID: o.rpID, userVerification: 'required', allowCredentials: mine.map((p) => ({ id: p.id, transports: p.transports })) });
      res.json({ id: keep('stepup', req, opts.challenge, ctx.sessionToken(req)), options: opts });
    }));
    app.post('/api/stepup/verify', wrap(async (req, res) => {
      const ip = req.ip;
      if (ctx.tooManyFailures(ip)) throw bad('Te veel foute pogingen. Probeer over 15 minuten opnieuw.', 429);
      const s = ctx.sessionOf(req); if (!s) throw bad('Niet ingelogd', 401);
      const a = auth();
      if (req.body.response) {
        const c = take(req.body.id, 'stepup');
        const pk = passkeys().find((p) => p.id === req.body.response.id && p.rpID === c.rpID);
        if (!pk) throw bad('Onbekende sleutel', 401);
        let v; try { v = await wa.verifyAuthenticationResponse({ response: req.body.response, expectedChallenge: c.challenge, expectedOrigin: c.origin, expectedRPID: c.rpID, credential: { id: pk.id, publicKey: Buffer.from(pk.publicKey, 'base64url'), counter: pk.counter || 0, transports: pk.transports }, requireUserVerification: true }); } catch (e) { ctx.addFailure(ip); throw bad(`Bevestigen mislukt: ${e.message}`, 401); }
        if (!v.verified) { ctx.addFailure(ip); throw bad('Bevestigen mislukt', 401); }
        pk.counter = v.authenticationInfo.newCounter; pk.lastUsed = Date.now(); saveAuth();
      } else if (req.body.code && a.totpEnabled) {
        if (!ctx.verifyTotp(a.totpSecret, req.body.code)) { ctx.addFailure(ip); throw bad('Verkeerde code', 401); }
      } else if (req.body.password) {
        if (a.totpEnabled) throw bad('Gebruik je 2FA-code of Face ID');
        if (!ctx.checkPassword(req.body.password, a.passwordHash)) { ctx.addFailure(ip); await new Promise((r) => setTimeout(r, 500)); throw bad('Verkeerd wachtwoord', 401); }
      } else throw bad('Geef je code of gebruik Face ID');
      s.stepUpAt = Date.now();
      res.json({ ok: true });
    }));
  }
  return { routes, requireStepUp, stepUpOk };
};
