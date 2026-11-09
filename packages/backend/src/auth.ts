import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const PUBLIC = new Set(['/health']);

function equal(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Bearer-токен команды (spec llm-provider → Plugin authentication). */
export function registerAuth(app: FastifyInstance, token: string) {
  app.addHook('onRequest', async (req, reply) => {
    if (PUBLIC.has(req.routeOptions.url ?? req.url)) return;
    const header = req.headers.authorization ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!given || !equal(given, token)) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Нужен командный токен плагина' });
    }
  });
}
