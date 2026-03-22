import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ytDlpModule = await import("yt-dlp-exec");
const ytDlpDefault = ytDlpModule.default;

function normalizeEnvPath(filePath) {
  if (!filePath) {
    return null;
  }

  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), filePath);
}

function isExecutable(filePath) {
  if (!filePath) {
    return false;
  }

  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isReadableFile(filePath) {
  if (!filePath) {
    return false;
  }

  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveFromPath(binaryName) {
  const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);

  for (const entry of pathEntries) {
    const candidate = path.join(entry, binaryName);

    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveBinaryPath() {
  const binaryName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const envPath = normalizeEnvPath(process.env.YTDLP_PATH);

  if (isExecutable(envPath)) {
    return envPath;
  }

  const pathBinary = resolveFromPath(binaryName);

  if (pathBinary) {
    return pathBinary;
  }

  const localPath = path.join(/* turbopackIgnore: true */ process.cwd(), "node_modules", "yt-dlp-exec", "bin", binaryName);

  if (isExecutable(localPath) && typeof ytDlpDefault?.create === "function") {
    return localPath;
  }

  return null;
}

function resolveInlineCookies() {
  if (process.env.YTDLP_COOKIES_CONTENT?.trim()) {
    return process.env.YTDLP_COOKIES_CONTENT.trim();
  }

  if (process.env.YTDLP_COOKIES_BASE64?.trim()) {
    try {
      return Buffer.from(process.env.YTDLP_COOKIES_BASE64.trim(), "base64").toString("utf8").trim();
    } catch {
      return null;
    }
  }

  return null;
}

function resolveCookiesPath() {
  const envPath = normalizeEnvPath(process.env.YTDLP_COOKIES_PATH);

  if (isReadableFile(envPath)) {
    return envPath;
  }

  const localCookiesPath = path.join(/* turbopackIgnore: true */ process.cwd(), "cookies.txt");

  if (isReadableFile(localCookiesPath)) {
    return localCookiesPath;
  }

  const inlineCookies = resolveInlineCookies();

  if (!inlineCookies) {
    return null;
  }

  const runtimeDir = path.join(os.tmpdir(), "ytsaver");

  try {
    fs.mkdirSync(runtimeDir, { recursive: true });
    const generatedPath = path.join(runtimeDir, "yt-dlp-cookies.txt");
    fs.writeFileSync(generatedPath, `${inlineCookies}\n`, "utf8");
    return generatedPath;
  } catch {
    return null;
  }
}

const binaryPath = resolveBinaryPath();
const cookiesPath = resolveCookiesPath();

export const ytDlp = binaryPath && typeof ytDlpDefault?.create === "function"
  ? ytDlpDefault.create(binaryPath)
  : ytDlpDefault;

export function getYtDlpBinaryPath() {
  return binaryPath;
}

export function getYtDlpCookiesPath() {
  return cookiesPath;
}

export function withYtDlpRuntimeFlags(flags = {}) {
  return cookiesPath && !flags.cookies
    ? { ...flags, cookies: cookiesPath }
    : flags;
}
