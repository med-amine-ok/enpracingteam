import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Hosts where the pages and the API have separate addresses (Render: one *.onrender.com address per service):
// API_PROXY_URL is the API's address, and the pages forward /api/… (and the Django admin) to it, so that the browser
// only ever talks to the pages' address. The login cookies then belong to that one site, as behind Caddy. Without
// API_PROXY_URL (this PC, the Caddy server) nothing is forwarded.
const apiProxy = process.env.API_PROXY_URL?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  // Django's addresses end with "/": keep it (Next.js would otherwise redirect /api/x/ to /api/x).
  skipTrailingSlashRedirect: Boolean(apiProxy),
  async rewrites() {
    if (!apiProxy) {
      return [];
    }
    return ["api", "admin", "static"].map((prefix) => ({
      source: `/${prefix}/:path(.*)`,
      destination: `${apiProxy}/${prefix}/:path`,
    }));
  },
  // The end-to-end tests build into their own folder (playwright.config.ts): the ERP running from .next keeps
  // its pages and its API address while they run.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// Translations setup: src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
