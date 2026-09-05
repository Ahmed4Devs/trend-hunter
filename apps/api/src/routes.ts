import type { FastifyPluginAsync } from 'fastify';

import { healthRoutes } from './modules/health';
import { postRoutes } from './modules/posts';

/**
 * The `/api/v1` surface.
 *
 * Every module is registered here and nowhere else, so the set of endpoints
 * this service exposes can be read in one place.
 */
export const registerRoutes: FastifyPluginAsync = async (app) => {
  await app.register(healthRoutes);
  await app.register(postRoutes);
};
