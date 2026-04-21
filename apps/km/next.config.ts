import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@episteme/db",
    "@episteme/auth",
    "@episteme/editor",
    "@episteme/markdown",
  ],
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
};

export default config;
