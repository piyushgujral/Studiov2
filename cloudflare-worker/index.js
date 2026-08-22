const ALLOWED_ORIGIN = 'https://piyushgujral.github.io';
const SESSION_TTL_SECONDS = 600;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' }
  });
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

export class RemoteRegistry {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async getSession(id) {
    const session = await this.state.storage.get(`session:${id}`);
    if (!session) return null;
    if (Date.now() - session.createdAt > SESSION_TTL_SECONDS * 1000) {
      await this.state.storage.delete(`session:${id}`);
      return null;
    }
    return session;
  }

  async findByCode(code) {
    const sessions = await this.state.storage.list({ prefix: 'session:' });
    for (const session of sessions.values()) {
      if (session?.code === code && Date.now() - session.createdAt <= SESSION_TTL_SECONDS * 1000) {
        return session;
      }
    }
    return null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const path = url.pathname.replace(/^\/api\/remote\/session\/?/, '');
    const parts = path ? path.split('/') : [];
    const code = (url.searchParams.get('code') || '').trim().toUpperCase();

    // POST /api/remote/session
    if (request.method === 'POST' && parts.length === 0) {
      const sessionId = crypto.randomUUID();
      const bytes = new Uint8Array(3);
      crypto.getRandomValues(bytes);
      const pairingCode = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

      await this.state.storage.put(`session:${sessionId}`, {
        id: sessionId,
        code: pairingCode,
        offer: '',
        answer: '',
        createdAt: Date.now()
      }, { expirationTtl: SESSION_TTL_SECONDS });

      return json({ sessionId, code: pairingCode, expiresInSeconds: SESSION_TTL_SECONDS }, 200, origin);
    }

    // GET /api/remote/session?code=XXXXXX
    if (request.method === 'GET' && parts.length === 0) {
      if (!code) return json({ error: 'pairing code is required' }, 400, origin);
      const session = await this.findByCode(code);
      if (!session) return json({ error: 'pairing session not found' }, 404, origin);
      return json({ sessionId: session.id, code: session.code }, 200, origin);
    }

    if (!parts[0]) return json({ error: 'not found' }, 404, origin);

    const sessionId = parts[0];
    const session = await this.getSession(sessionId);
    if (!session) return json({ error: 'session not found or expired' }, 404, origin);

    if (!code || code !== session.code) {
      return json({ error: 'invalid pairing code' }, 403, origin);
    }

    if (parts.length === 1) {
      if (request.method !== 'DELETE') return json({ error: 'method not allowed' }, 405, origin);
      await this.state.storage.delete(`session:${sessionId}`);
      return json({ ok: true }, 200, origin);
    }

    const type = parts[1];
    if (type !== 'offer' && type !== 'answer') return json({ error: 'not found' }, 404, origin);

    if (request.method === 'GET') {
      const current = await this.getSession(sessionId);
      if (!current || !current[type]) {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      }
      return json({ sdp: current[type] }, 200, origin);
    }

    if (request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'invalid JSON' }, 400, origin);
      }

      const sdp = typeof body?.sdp === 'string' ? body.sdp : '';
      if (!sdp.includes('v=0')) return json({ error: 'invalid SDP' }, 400, origin);

      const current = await this.getSession(sessionId);
      if (!current) return json({ error: 'session not found or expired' }, 404, origin);
      current[type] = sdp;
      await this.state.storage.put(`session:${sessionId}`, current, { expirationTtl: SESSION_TTL_SECONDS });
      return json({ ok: true }, 200, origin);
    }

    return json({ error: 'method not allowed' }, 405, origin);
  }
};
