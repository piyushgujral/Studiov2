import { DurableObject } from 'cloudflare:workers';

const ALLOWED_ORIGIN = 'https://piyushgujral.github.io';
const SESSION_TTL_MS = 10 * 60 * 1000;

function corsHeaders(origin) {
  const allowed = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

function codeFromBytes(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === '/health') {
      return json({ status: 'ok', service: 'payuu-remote-signaling' }, 200, origin);
    }

    if (!url.pathname.startsWith('/api/remote/session')) {
      return json({ error: 'not found' }, 404, origin);
    }

    const id = env.REMOTE_REGISTRY.idFromName('global');
    const stub = env.REMOTE_REGISTRY.get(id);
    return stub.fetch(request);
  }
};

export class RemoteRegistry extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        offer TEXT NOT NULL DEFAULT '',
        answer TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      )
    `);
  }

  cleanup() {
    const cutoff = Date.now() - SESSION_TTL_MS;
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE created_at < ?', cutoff);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const path = url.pathname.replace(/^\/api\/remote\/session\/?/, '');
    const parts = path ? path.split('/') : [];
    const code = (url.searchParams.get('code') || '').trim().toUpperCase();

    this.cleanup();

    if (request.method === 'POST' && parts.length === 0) {
      const bytes = new Uint8Array(3);
      crypto.getRandomValues(bytes);
      const sessionId = crypto.randomUUID();
      const pairingCode = codeFromBytes(bytes);
      this.ctx.storage.sql.exec(
        'INSERT INTO sessions (id, code, offer, answer, created_at) VALUES (?, ?, ?, ?, ?)',
        sessionId, pairingCode, '', '', Date.now()
      );
      return json({ sessionId, code: pairingCode, expiresInSeconds: 600 }, 200, origin);
    }

    if (request.method === 'GET' && parts.length === 0) {
      const rows = this.ctx.storage.sql.exec(
        'SELECT id, code FROM sessions WHERE code = ? AND created_at >= ?',
        code, Date.now() - SESSION_TTL_MS
      ).toArray();
      if (!rows.length) return json({ error: 'pairing session not found' }, 404, origin);
      return json({ sessionId: rows[0].id, code: rows[0].code }, 200, origin);
    }

    if (parts.length < 1 || !parts[0]) return json({ error: 'not found' }, 404, origin);

    const sessionId = parts[0];
    const rows = this.ctx.storage.sql.exec(
      'SELECT id, code, offer, answer, created_at FROM sessions WHERE id = ?',
      sessionId
    ).toArray();
    const session = rows[0];

    if (!session || Date.now() - session.created_at > SESSION_TTL_MS) {
      return json({ error: 'session not found or expired' }, 404, origin);
    }
    if (!code || code.toUpperCase() !== session.code.toUpperCase()) {
      return json({ error: 'invalid pairing code' }, 403, origin);
    }

    if (parts.length === 1) {
      if (request.method !== 'DELETE') return json({ error: 'method not allowed' }, 405, origin);
      this.ctx.storage.sql.exec('DELETE FROM sessions WHERE id = ?', sessionId);
      return json({ ok: true }, 200, origin);
    }

    const type = parts[1];
    if (!['offer', 'answer'].includes(type)) return json({ error: 'not found' }, 404, origin);

    if (request.method === 'GET') {
      const row = this.ctx.storage.sql.exec(
        `SELECT ${type} AS sdp FROM sessions WHERE id = ?`, sessionId
      ).toArray()[0];
      if (!row?.sdp) return new Response(null, { status: 204, headers: corsHeaders(origin) });
      return json({ sdp: row.sdp }, 200, origin);
    }

    if (request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: 'invalid JSON' }, 400, origin); }
      const sdp = typeof body?.sdp === 'string' ? body.sdp : '';
      if (!sdp.includes('v=0')) return json({ error: 'invalid SDP' }, 400, origin);
      this.ctx.storage.sql.exec(`UPDATE sessions SET ${type} = ? WHERE id = ?`, sdp, sessionId);
      return json({ ok: true }, 200, origin);
    }

    return json({ error: 'method not allowed' }, 405, origin);
  }
}
