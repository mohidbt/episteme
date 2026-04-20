import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@episteme/db", "@episteme/auth"],
};

export default config;
