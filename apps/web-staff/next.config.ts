import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:locale(en|es)/organizations/:path*",
        headers: [{ key: "Referrer-Policy", value: "strict-origin" }],
      },
    ];
  },
  agentRules: false,
  transpilePackages: ["@vetx/api-client", "@vetx/config", "@vetx/i18n", "@vetx/ui-web"],
};

export default withNextIntl(nextConfig);
