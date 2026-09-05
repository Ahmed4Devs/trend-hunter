import type { Container } from '../container';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    /** Everything the application is composed of. See `src/container.ts`. */
    container: Container;
  }
}

export interface ContextOptions {
  readonly container: Container;
}

/**
 * Decorates the server with the composition root.
 *
 * A decorator rather than a module-level import, so a test can build a server
 * around a container full of fakes, and so nothing in a route module can reach
 * a connection that the test did not provide.
 */
const contextPlugin: FastifyPluginAsync<ContextOptions> = (app, options) => {
  app.decorate('container', options.container);
  return Promise.resolve();
};

export default fp(contextPlugin, { name: 'context' });
