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

  // Off while the route tree is still being built out: it validates every
  // `Link` target against the routes that exist, which would make the
  // navigation component uncompilable until the last page it points at lands.
  // Turned on in the hardening pass, once the tree is complete.
  typedRoutes: false,

  experimental: {
    // Barrel files: importing one icon from lucide-react would otherwise pull
    // the whole set into the client bundle.
    optimizePackageImports: ['lucide-react', 'recharts', '@trendhunter/ui'],
  },
};

export default createNextIntlPlugin('./i18n/request.ts')(nextConfig);
