import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages ship platform-specific executables/native bindings. Keep
  // them external so Next resolves the artifact for the server's architecture.
  serverExternalPackages: ["@openai/codex", "node-hid"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
