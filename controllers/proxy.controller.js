import crypto from "node:crypto";
import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { ExpressError } from "@/utils/expressError";
import { logError, logInfo } from "@/utils/logger";
import { ffmpegPath } from "@/utils/ffmpeg-path";
import { ytDlp, withYtDlpRuntimeFlags } from "@/utils/ytdlp";

const DOWNLOAD_CACHE_ROOT = path.join(os.tmpdir(), "ytsaver-download-cache");
const DOWNLOAD_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function sanitizeFilename(filename) {
  return filename.replace(/[\\/:*?"<>|]/g, "_");
}

function isAllowedHost(hostname) {
  const allowedDomains = ["googlevideo.com", "youtube.com", "googleusercontent.com"];
  return allowedDomains.some((domain) => hostname.endsWith(domain));
}

function buildDownloadHeaders(filename, contentType, contentLength, status = 200, contentRange = null, acceptRanges = true) {
  const headers = new Headers({
    "Content-Type": contentType || "application/octet-stream",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  });

  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }

  if (acceptRanges) {
    headers.set("Accept-Ranges", "bytes");
  }

  if (contentRange) {
    headers.set("Content-Range", contentRange);
  }

  return headers;
}

function inferContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mapping = {
    ".mp4": "video/mp4",
    ".m4a": "audio/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".opus": "audio/ogg",
    ".mkv": "video/x-matroska",
  };

  return mapping[extension] || "application/octet-stream";
}

async function cleanupTempDir(tempDir) {
  await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => null);
}

function buildCacheKey(sourceUrl, formatId) {
  return crypto.createHash("sha1").update(`${sourceUrl}::${formatId}`).digest("hex");
}

async function ensureCacheRoot() {
  await fsPromises.mkdir(DOWNLOAD_CACHE_ROOT, { recursive: true });
}

async function pruneDownloadCache() {
  await ensureCacheRoot();

  const entries = await fsPromises.readdir(DOWNLOAD_CACHE_ROOT, { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - DOWNLOAD_CACHE_TTL_MS;

  await Promise.all(entries.map(async (entry) => {
    if (!entry.isDirectory()) {
      return;
    }

    const fullPath = path.join(DOWNLOAD_CACHE_ROOT, entry.name);
    const stats = await fsPromises.stat(fullPath).catch(() => null);

    if (stats && stats.mtimeMs < cutoff) {
      await cleanupTempDir(fullPath);
    }
  }));
}

async function findCompletedDownload(cacheDir) {
  const files = await fsPromises.readdir(cacheDir).catch(() => []);
  const downloadedFile = files.find((file) => !file.endsWith(".part") && !file.endsWith(".ytdl"));

  return downloadedFile ? path.join(cacheDir, downloadedFile) : null;
}

function parseRangeHeader(rangeHeader, fileSize) {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());

  if (!match) {
    return { invalid: true };
  }

  const [, startText, endText] = match;

  if (!startText && !endText) {
    return { invalid: true };
  }

  let start = 0;
  let end = fileSize - 1;

  if (!startText) {
    const suffixLength = Number(endText);

    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return { invalid: true };
    }

    start = Math.max(fileSize - suffixLength, 0);
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : fileSize - 1;

    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      return { invalid: true };
    }
  }

  if (start < 0 || end < start || start >= fileSize || end >= fileSize) {
    return { invalid: true };
  }

  return { start, end };
}

async function resolveYtDlpFormat(sourceUrl, formatId) {
  const info = await ytDlp(
    sourceUrl,
    withYtDlpRuntimeFlags({
      dumpSingleJson: true,
      skipDownload: true,
      noWarnings: true,
      noPlaylist: true,
      quiet: true,
      format: formatId,
    }),
    {
      timeout: 30000,
      windowsHide: true,
    }
  );

  const allFormats = Array.isArray(info?.formats) ? info.formats : [];
  const matchedFormat = allFormats.find((format) => String(format?.format_id) === String(formatId));
  const directUrl = info?.url || matchedFormat?.url;
  const headers = matchedFormat?.http_headers || info?.http_headers || {};
  const extension = String(matchedFormat?.ext || info?.ext || "").toLowerCase();

  if (!directUrl) {
    throw new ExpressError("Could not resolve a downloadable media URL for this format.", 404);
  }

  return {
    directUrl,
    headers,
    contentType: inferContentType(`file.${extension || "bin"}`),
  };
}

async function downloadWithYtDlpToCache(sourceUrl, formatId, filename) {
  if (!ffmpegPath && String(formatId).includes("+")) {
    throw new ExpressError("FFmpeg is not available, so merged video+audio downloads cannot be created yet.", 503);
  }

  await pruneDownloadCache();

  const cacheDir = path.join(DOWNLOAD_CACHE_ROOT, buildCacheKey(sourceUrl, formatId));
  const shouldMerge = String(formatId).includes("+");
  const cachedFile = await findCompletedDownload(cacheDir);

  if (cachedFile) {
    const stats = await fsPromises.stat(cachedFile);

    return {
      filePath: cachedFile,
      contentType: inferContentType(cachedFile),
      contentLength: String(stats.size),
    };
  }

  await fsPromises.mkdir(cacheDir, { recursive: true });

  const parsedName = path.parse(filename);
  const outputTemplate = path.join(cacheDir, `${parsedName.name || "download"}.%(ext)s`);

  logInfo("[PROXY] Starting yt-dlp download", {
    sourceUrl,
    formatId,
    shouldMerge,
    ffmpegPath,
    cacheDir,
  });

  try {
    await ytDlp.exec(
      sourceUrl,
      withYtDlpRuntimeFlags({
        format: formatId,
        output: outputTemplate,
        noWarnings: true,
        noPlaylist: true,
        quiet: true,
        continue: true,
        ffmpegLocation: ffmpegPath || undefined,
        mergeOutputFormat: shouldMerge ? "mp4" : undefined,
      }),
      {
        windowsHide: true,
      }
    );

    const downloadedFile = await findCompletedDownload(cacheDir);

    if (!downloadedFile) {
      throw new ExpressError("The media file was not created after download.", 500);
    }

    const stats = await fsPromises.stat(downloadedFile);

    return {
      filePath: downloadedFile,
      contentType: inferContentType(downloadedFile),
      contentLength: String(stats.size),
    };
  } catch (error) {
    if (!(await findCompletedDownload(cacheDir))) {
      await cleanupTempDir(cacheDir);
    }

    if (error instanceof ExpressError) {
      throw error;
    }

    throw error;
  }
}

function buildUpstreamHeaders(request, extraHeaders = {}) {
  const range = request.headers.get("range");

  return {
    Accept: "*/*",
    ...(range ? { Range: range } : {}),
    ...extraHeaders,
  };
}

async function proxyDirectMedia(parsedUrl, filename, request) {
  const upstream = await fetch(parsedUrl, {
    headers: buildUpstreamHeaders(request, {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://www.youtube.com/",
      Origin: "https://www.youtube.com",
    }),
    redirect: "follow",
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    throw new ExpressError(`Media source returned ${upstream.status}.`, upstream.status || 502);
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: buildDownloadHeaders(
      filename,
      upstream.headers.get("content-type"),
      upstream.headers.get("content-length"),
      upstream.status,
      upstream.headers.get("content-range")
    ),
  });
}

async function proxyResolvedYtDlpStream(sourceUrl, formatId, filename, request) {
  const { directUrl, headers, contentType } = await resolveYtDlpFormat(sourceUrl, formatId);

  logInfo("[PROXY] Streaming direct yt-dlp format", {
    sourceUrl,
    formatId,
    host: new URL(directUrl).hostname,
  });

  const upstream = await fetch(directUrl, {
    headers: buildUpstreamHeaders(request, headers),
    redirect: "follow",
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    throw new ExpressError(`Media source returned ${upstream.status}.`, upstream.status || 502);
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: buildDownloadHeaders(
      filename,
      upstream.headers.get("content-type") || contentType,
      upstream.headers.get("content-length"),
      upstream.status,
      upstream.headers.get("content-range")
    ),
  });
}

async function proxyCachedFile(filePath, filename, request) {
  const stats = await fsPromises.stat(filePath);
  const range = parseRangeHeader(request.headers.get("range"), stats.size);

  if (range?.invalid) {
    return new NextResponse(null, {
      status: 416,
      headers: buildDownloadHeaders(filename, inferContentType(filePath), "0", 416, `bytes */${stats.size}`),
    });
  }

  if (!range) {
    const fileStream = fs.createReadStream(filePath);

    return new NextResponse(Readable.toWeb(fileStream), {
      status: 200,
      headers: buildDownloadHeaders(filename, inferContentType(filePath), String(stats.size)),
    });
  }

  const chunkSize = range.end - range.start + 1;
  const fileStream = fs.createReadStream(filePath, { start: range.start, end: range.end });

  return new NextResponse(Readable.toWeb(fileStream), {
    status: 206,
    headers: buildDownloadHeaders(
      filename,
      inferContentType(filePath),
      String(chunkSize),
      206,
      `bytes ${range.start}-${range.end}/${stats.size}`
    ),
  });
}

async function proxyMergedYtDlpMedia(sourceUrl, formatId, filename, request) {
  const { filePath } = await downloadWithYtDlpToCache(sourceUrl, formatId, filename);
  return proxyCachedFile(filePath, path.basename(filePath), request);
}

export async function proxyController(request) {
  const { searchParams } = new URL(request.url);
  const upstreamUrl = searchParams.get("url");
  const sourceUrl = searchParams.get("sourceUrl");
  const formatId = searchParams.get("formatId");
  const filename = sanitizeFilename(searchParams.get("filename") || "download");

  if (sourceUrl && formatId) {
    try {
      if (String(formatId).includes("+")) {
        return await proxyMergedYtDlpMedia(sourceUrl, formatId, filename, request);
      }

      return await proxyResolvedYtDlpStream(sourceUrl, formatId, filename, request);
    } catch (error) {
      if (error instanceof ExpressError) {
        throw error;
      }

      logError("[PROXY_YTDLP_ERROR]", {
        sourceUrl,
        formatId,
        message: error?.message || String(error),
        stderr: error?.stderr || null,
        stack: error?.stack || null,
      });

      throw new ExpressError("Failed to fetch the media stream.", 502);
    }
  }

  if (!upstreamUrl) {
    throw new ExpressError("Missing media URL.", 400);
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(upstreamUrl);
  } catch {
    throw new ExpressError("Invalid media URL.", 400);
  }

  if (!isAllowedHost(parsedUrl.hostname)) {
    throw new ExpressError("Media source host is not allowed.", 403);
  }

  try {
    return await proxyDirectMedia(parsedUrl, filename, request);
  } catch (error) {
    if (error instanceof ExpressError) {
      throw error;
    }

    logError("[PROXY_ERROR]", {
      url: parsedUrl.toString(),
      message: error?.message || String(error),
      stack: error?.stack || null,
    });

    throw new ExpressError("Failed to fetch the media stream.", 502);
  }
}
