import { ServerError } from "./errors";

const MB = 1024 * 1024;

function configured(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number <= 0) throw new ServerError(503, "configuration", `${name} must be a positive integer`);
  return number;
}

export function quotas() {
  return {
    projects: configured("MAX_PROJECTS_PER_ACCOUNT", 10),
    uploadBytes: configured("MAX_UPLOAD_BYTES", 25 * MB),
    sourceBytes: configured("MAX_SOURCE_BYTES", 25 * MB),
    accountSourceBytes: configured("MAX_ACCOUNT_SOURCE_BYTES", 200 * MB),
    comments: configured("MAX_COMMENTS_PER_PROJECT", 500),
    anonymousUploadBytes: configured("MAX_ANONYMOUS_UPLOAD_BYTES", 25 * MB),
    anonymousUploadTotalBytes: configured("MAX_ANONYMOUS_UPLOAD_TOTAL_BYTES", 200 * MB),
  };
}

export function refuseCount(label: string, limit: number): never {
  throw new ServerError(429, "quota", `${label} limit is ${limit}; remove an existing item before adding another`);
}

export function refuseBytes(label: string, limit: number): never {
  throw new ServerError(413, "quota", `${label} limit is ${limit >= MB ? `${(limit / MB).toFixed(1)} MB` : `${limit} bytes`}`);
}
