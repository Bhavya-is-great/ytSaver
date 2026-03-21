import fs from "node:fs";
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

const binaryPath = resolveBinaryPath();

export const ytDlp = binaryPath && typeof ytDlpDefault?.create === "function"
  ? ytDlpDefault.create(binaryPath)
  : ytDlpDefault;

export function getYtDlpBinaryPath() {
  return binaryPath;
}
