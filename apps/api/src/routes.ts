import type { FastifyPluginAsync } from 'fastify';

import { contentRoutes } from './modules/content';
import { dashboardRoutes } from './modules/dashboard';
import { healthRoutes } from './modules/health';
import { operationRoutes } from './modules/operations';
import { postRoutes } from './modules/posts';
import { savedRoutes } from './modules/saved';
import { searchRoutes } from './modules/search';
import { sourceRoutes } from './modules/sources';
import { topicRoutes } from './modules/topics';
import { translationRoutes } from './modules/translations';

/**
 * The `/api/v1` surface.
 *
 * Every module is registered here and nowhere else, so the set of endpoints
 * this service exposes can be read in one place.
 */
export const registerRoutes: FastifyPluginAsync = async (app) => {
  await app.register(healthRoutes);
  await app.register(dashboardRoutes);
  await app.register(postRoutes);
  await app.register(topicRoutes);
  await app.register(searchRoutes);
  await app.register(sourceRoutes);
  await app.register(translationRoutes);
  await app.register(contentRoutes);
  await app.register(savedRoutes);
  await app.register(operationRoutes);
};
