import { join } from 'node:path';

import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The React Compiler memoises components automatically. This UI re-renders
  // large tables and charts on every filter change, which is exactly the case
  // manual memoisation gets wrong first.
  reactCompiler: true,

  // Workspace packages ship TypeScript sources rather than a build, so Next has
  // to compile them itself.
  transpilePackages: ['@trendhunter/ui'],

  // Standalone output is a packaging concern for the container image, so it is
  // opt-in rather than the default. The traced tree keeps pnpm's symlinks, and
  // Node cannot follow those on Windows without elevated permissions — a local
  // `next start` against a standalone build fails with EPERM. The Dockerfile
  // sets this; a developer's build stays ordinary.
  // eslint-disable-next-line no-restricted-properties -- build-time packaging switch, not runtime configuration
  ...(process.env.NEXT_OUTPUT === 'standalone'
    ? {
        output: 'standalone' as const,
        // Without this the trace root is inferred from the nearest lockfile,
        // which in a pnpm workspace is the app directory — and the trace then
        // misses every dependency in the repository root's store.
        outputFileTracingRoot: join(import.meta.dirname, '../..'),
      }
    : {}),

  // `X-Powered-By` advertises the framework and version to anyone scanning.
  poweredByHeader: false,

  // Every `Link` target and `router.push` is checked against the routes that
  // actually exist, so a renamed segment fails the build rather than becoming a
  // 404 someone finds later.
  typedRoutes: true,

  experimental: {
    // Barrel files: importing one icon from lucide-react would otherwise pull
    // the whole set into the client bundle.
    optimizePackageImports: ['lucide-react', 'recharts', '@trendhunter/ui'],
  },
};

export default createNextIntlPlugin('./i18n/request.ts')(nextConfig);
