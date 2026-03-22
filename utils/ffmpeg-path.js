import fs from "node:fs";
import path from "node:path";

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

function resolvePackagedBinary() {
  const packagesDir = path.join(/* turbopackIgnore: true */ process.cwd(), "node_modules", "@ffmpeg-installer");
  const binaryName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

  if (!fs.existsSync(packagesDir)) {
    return null;
  }

  const packageNames = fs.readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${process.platform}-`))
    .map((entry) => entry.name)
    .sort((left, right) => {
      if (left === `${process.platform}-${process.arch}`) {
        return -1;
      }

      if (right === `${process.platform}-${process.arch}`) {
        return 1;
      }

      return left.localeCompare(right);
    });

  for (const packageName of packageNames) {
    const candidate = path.join(packagesDir, packageName, binaryName);

    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

function walkForBinary(startDir, targetName, depth = 5) {
  if (!startDir || !fs.existsSync(startDir) || depth < 0) {
    return null;
  }

  const entries = fs.readdirSync(startDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(startDir, entry.name);

    if (entry.isFile() && entry.name.toLowerCase() === targetName.toLowerCase()) {
      return fullPath;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const result = walkForBinary(path.join(startDir, entry.name), targetName, depth - 1);
    if (result) {
      return result;
    }
  }

  return null;
}

function resolveFfmpegPath() {
  const envPath = normalizeEnvPath(process.env.FFMPEG_PATH);

  if (isExecutable(envPath)) {
    return envPath;
  }

  const pathBinary = resolveFromPath(process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

  if (pathBinary) {
    return pathBinary;
  }

  const packagedBinary = resolvePackagedBinary();

  if (packagedBinary) {
    return packagedBinary;
  }

  const packagesRoot = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages")
    : null;

  if (packagesRoot && fs.existsSync(packagesRoot)) {
    const packageDirs = fs.readdirSync(packagesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().includes("ffmpeg"))
      .map((entry) => path.join(packagesRoot, entry.name));

    for (const packageDir of packageDirs) {
      const found = walkForBinary(packageDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg", 6);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

export const ffmpegPath = resolveFfmpegPath();
