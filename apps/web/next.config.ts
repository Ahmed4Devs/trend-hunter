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
