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

function randomCode() {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function sessionKey(id) {
  return `session:${id}`;
}

async function getSession(storage, id) {
  const raw = await storage.get(sessionKey(id));
  if (!raw) return null;
  if (Date.now() - raw.createdAt > SESSION_TTL_MS) {
    await storage.delete(sessionKey(id));
    return null;
  }
  return raw;
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

    const storage = env.REMOTE_REGISTRY;
    if (!storage) return json({ error: 'Durable Object binding REMOTE_REGISTRY is missing' }, 500, origin);

    const path = url.pathname.replace(/^\/api\/remote\/session\/?/, '');
    const parts = path ? path.split('/') : [];
    const code = (url.searchParams.get('code') || '').trim().toUpperCase();

    // POST /api/remote/session
    if (request.method === 'POST' && parts.length === 0) {
      const sessionId = crypto.randomUUID();
      const pairingCode = randomCode();
      await storage.put(sessionKey(sessionId), {
        id: sessionId,
        code: pairingCode,
        offer: '',
        answer: '',
        createdAt: Date.now()
      }, { expirationTtl: 600 });
      return json({ sessionId, code: pairingCode, expiresInSeconds: 600 }, 200, origin);
    }

    // GET /api/remote/session?code=XXXXXX
    if (request.method === 'GET' && parts.length === 0) {
      const list = await storage.list({ prefix: 'session:' });
      for (const [key, session] of list) {
        if (session?.code === code && Date.now() - session.createdAt <= SESSION_TTL_MS) {
          return json({ sessionId: session.id, code: session.code }, 200, origin);
        }
      }
      return json({ error: 'pairing session not found' }, 404, origin);
    }

    if (!parts[0]) return json({ error: 'not found' }, 404, origin);

    const sessionId = parts[0];
    const session = await getSession(storage, sessionId);
    if (!session) return json({ error: 'session not found or expired' }, 404, origin);

    if (!code || code !== session.code) {
      return json({ error: 'invalid pairing code' }, 403, origin);
    }

    if (parts.length === 1) {
      if (request.method !== 'DELETE') return json({ error: 'method not allowed' }, 405, origin);
      await storage.delete(sessionKey(sessionId));
      return json({ ok: true }, 200, origin);
    }

    const type = parts[1];
    if (type !== 'offer' && type !== 'answer') return json({ error: 'not found' }, 404, origin);

    if (request.method === 'GET') {
      const current = await getSession(storage, sessionId);
      if (!current || !current[type]) {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      }
      return json({ sdp: current[type] }, 200, origin);
    }

    if (request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (_) {
        return json({ error: 'invalid JSON' }, 400, origin);
      }
      const sdp = typeof body?.sdp === 'string' ? body.sdp : '';
      if (!sdp.includes('v=0')) return json({ error: 'invalid SDP' }, 400, origin);

      const current = await getSession(storage, sessionId);
      if (!current) return json({ error: 'session not found or expired' }, 404, origin);
      current[type] = sdp;
      await storage.put(sessionKey(sessionId), current, { expirationTtl: 600 });
      return json({ ok: true }, 200, origin);
    }

    return json({ error: 'method not allowed' }, 405, origin);
  }
};

export class RemoteRegistry {
  constructor() {}
  async fetch() {
    return new Response('RemoteRegistry', { status: 200 });
  }
}
