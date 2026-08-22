const SESSION_TTL_MS = 10 * 60 * 1000;

function cors(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGIN || 'https://piyushgujral.github.io';
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  });
  if (origin === allowed) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

function json(request, env, value, status = 200) {
  const headers = cors(request, env);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(value), { status, headers });
}

function error(request, env, message, status) {
  return json(request, env, { error: message }, status);
}

function makeCode() {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function validSession(session) {
  return session && Date.now() - session.createdAt < SESSION_TTL_MS;
}

async function getRegistry(env) {
  const id = env.REMOTE_REGISTRY.idFromName('global');
  return env.REMOTE_REGISTRY.get(id);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(request, env) });
    }

    if (url.pathname === '/health') {
      return json(request, env, { status: 'ok', service: 'payuu-remote-signaling' });
    }

    if (!url.pathname.startsWith('/api/remote/session')) {
      return error(request, env, 'Not found', 404);
    }

    const registry = await getRegistry(env);

    if (url.pathname === '/api/remote/session') {
      if (request.method === 'POST') {
        return registry.fetch(new Request(new URL('/create', request.url), request));
      }
      if (request.method === 'GET') {
        return registry.fetch(new Request(new URL('/lookup' + url.search, request.url), request));
      }
      return error(request, env, 'Method not allowed', 405);
    }

    const prefix = '/api/remote/session/';
    const path = url.pathname.slice(prefix.length);
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) return error(request, env, 'Not found', 404);

    const internal = new URL('/session/' + parts.join('/'), request.url);
    internal.search = url.search;
    return registry.fetch(new Request(internal, request));
  },
};

export class RemoteRegistry {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async cleanup() {
    const all = await this.state.storage.list({ prefix: 'session:' });
    const now = Date.now();
    const deletes = [];
    for (const [key, session] of all) {
      if (!validSession(session)) deletes.push(this.state.storage.delete(key));
    }
    await Promise.all(deletes);
  }

  async getSession(id) {
    const session = await this.state.storage.get('session:' + id);
    if (!validSession(session)) {
      if (session) await this.state.storage.delete('session:' + id);
      return null;
    }
    return session;
  }

  async fetch(request) {
    const url = new URL(request.url);
    await this.cleanup();

    if (url.pathname === '/create' && request.method === 'POST') {
      const session = {
        id: crypto.randomUUID(),
        code: makeCode(),
        offer: '',
        answer: '',
        createdAt: Date.now(),
      };
      await this.state.storage.put('session:' + session.id, session, { expirationTtl: 600 });
      return json(request, this.env, {
        sessionId: session.id,
        code: session.code,
        expiresInSeconds: 600,
      });
    }

    if (url.pathname === '/lookup' && request.method === 'GET') {
      const wanted = (url.searchParams.get('code') || '').trim().toUpperCase();
      if (!wanted) return error(request, this.env, 'Pairing code required', 400);
      const all = await this.state.storage.list({ prefix: 'session:' });
      for (const [, session] of all) {
        if (validSession(session) && session.code === wanted) {
          return json(request, this.env, { sessionId: session.id, code: session.code });
        }
      }
      return error(request, this.env, 'Pairing session not found', 404);
    }

    if (!url.pathname.startsWith('/session/')) return error(request, this.env, 'Not found', 404);

    const rest = url.pathname.slice('/session/'.length).split('/').filter(Boolean);
    const id = rest[0];
    const resource = rest[1] || '';
    const session = await this.getSession(id);
    if (!session) return error(request, this.env, 'Session not found or expired', 404);

    if ((url.searchParams.get('code') || '').trim().toUpperCase() !== session.code) {
      return error(request, this.env, 'Invalid pairing code', 403);
    }

    if (!resource) {
      if (request.method === 'DELETE') {
        await this.state.storage.delete('session:' + id);
        return json(request, this.env, { ok: true });
      }
      return error(request, this.env, 'Method not allowed', 405);
    }

    if (!['offer', 'answer'].includes(resource)) return error(request, this.env, 'Not found', 404);

    if (request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch (_) { return error(request, this.env, 'Invalid JSON', 400); }
      if (typeof body?.sdp !== 'string' || !body.sdp.includes('v=0')) {
        return error(request, this.env, 'Invalid SDP', 400);
      }
      session[resource] = body.sdp;
      await this.state.storage.put('session:' + id, session, { expirationTtl: 600 });
      return json(request, this.env, { ok: true });
    }

    if (request.method === 'GET') {
      const sdp = session[resource];
      if (!sdp) return new Response(null, { status: 204, headers: cors(request, this.env) });
      return json(request, this.env, { sdp });
    }

    return error(request, this.env, 'Method not allowed', 405);
  }
};
