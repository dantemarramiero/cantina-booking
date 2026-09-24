// Utilità comuni alle API dei moduli (Finance, People, …).
// HttpError: un errore con codice HTTP e messaggio leggibile, che il router trasforma in risposta.
class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Registra le route sotto `base` con authAdmin davanti. Il gestore restituisce il JSON da inviare
// (oppure scrive lui la risposta). uniqueErrors: [regex sul messaggio SQLite, messaggio per l'utente]
// per trasformare le violazioni di vincoli UNIQUE in 409 comprensibili.
function createRouter(app, base, authAdmin, uniqueErrors = []) {
  const wrap = handler => (req, res) => {
    try {
      const out = handler(req, res);
      if (out && typeof out.then === 'function') {
        return out.then(v => { if (v !== undefined && !res.headersSent) res.json(v); }).catch(e => fail(res, e));
      }
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      fail(res, e);
    }
  };
  function fail(res, e) {
    if (res.headersSent) return;
    if (e instanceof HttpError || e.status) return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
    for (const [re, msg] of uniqueErrors) if (re.test(e.message)) return res.status(409).json({ error: msg });
    console.error(e);
    res.status(500).json({ error: 'Errore interno.' });
  }
  const r = {};
  for (const m of ['get', 'post', 'patch', 'put', 'delete']) r[m] = (p, ...handlers) => {
    const h = handlers.pop();
    app[m](base + p, authAdmin, ...handlers, wrap(h));
  };
  return r;
}

module.exports = { HttpError, createRouter };
