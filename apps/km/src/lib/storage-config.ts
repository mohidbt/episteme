import type { StorageConfig } from "@episteme/storage";

type StorageEnvironment = Record<string, string | undefined>;

const LOCAL_DEFAULTS = {
  endpoint: "http://localhost:9000",
  bucket: "episteme-dev",
  accessKey: "episteme",
  secretKey: "episteme-dev",
  region: "us-east-1",
} as const;

function value(env: StorageEnvironment, key: string): string | undefined {
  const raw = env[key]?.trim();
  return raw ? raw : undefined;
}

function required(env: StorageEnvironment, key: string): string {
  const resolved = value(env, key);
  if (!resolved) throw new Error(`${key} is required in production`);
  return resolved;
}

/** Resolve one shared S3 configuration for all KM object-store clients. */
export function resolveStorageConfig(
  env: StorageEnvironment = process.env,
): StorageConfig {
  const production = env.NODE_ENV === "production";
  const endpoint = production
    ? required(env, "S3_ENDPOINT")
    : value(env, "S3_ENDPOINT") ?? LOCAL_DEFAULTS.endpoint;
  const bucket = production
    ? required(env, "S3_BUCKET")
    : value(env, "S3_BUCKET") ?? LOCAL_DEFAULTS.bucket;
  const accessKey = production
    ? required(env, "S3_ACCESS_KEY")
    : value(env, "S3_ACCESS_KEY") ?? LOCAL_DEFAULTS.accessKey;
  const secretKey = production
    ? required(env, "S3_SECRET_KEY")
    : value(env, "S3_SECRET_KEY") ?? LOCAL_DEFAULTS.secretKey;
  const region = value(env, "S3_REGION") ?? LOCAL_DEFAULTS.region;

  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new Error("S3_ENDPOINT must be an absolute http(s) URL");
  }
  if (!["http:", "https:"].includes(parsedEndpoint.protocol)) {
    throw new Error("S3_ENDPOINT must be an absolute http(s) URL");
  }
  if (parsedEndpoint.username || parsedEndpoint.password) {
    throw new Error("S3_ENDPOINT must not contain credentials");
  }
  if (
    production &&
    parsedEndpoint.protocol !== "https:" &&
    env.S3_ALLOW_INSECURE_HTTP !== "true"
  ) {
    throw new Error(
      "S3_ENDPOINT must use HTTPS in production (set S3_ALLOW_INSECURE_HTTP=true only for a trusted private network)",
    );
  }

  return {
    endpoint: parsedEndpoint.toString().replace(/\/$/, ""),
    bucket,
    accessKey,
    secretKey,
    region,
    forcePathStyle: true,
  };
}
