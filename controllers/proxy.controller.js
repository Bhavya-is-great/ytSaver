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

async function downloadWithYtDlpToTemp(sourceUrl, formatId, filename) {
  if (!ffmpegPath && String(formatId).includes("+")) {
    throw new ExpressError("FFmpeg is not available, so merged video+audio downloads cannot be created yet.", 503);
  }

  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ytsaver-"));
  const parsedName = path.parse(filename);
  const outputTemplate = path.join(tempDir, `${parsedName.name}.%(ext)s`);
  const shouldMerge = String(formatId).includes("+");

  logInfo("[PROXY] Starting yt-dlp download", {
    sourceUrl,
    formatId,
    shouldMerge,
    ffmpegPath,
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
        noPart: true,
        ffmpegLocation: ffmpegPath || undefined,
        mergeOutputFormat: shouldMerge ? "mp4" : undefined,
      }),
      {
        windowsHide: true,
      }
    );

    const files = await fsPromises.readdir(tempDir);
    const downloadedFile = files.find((file) => !file.endsWith(".part") && !file.endsWith(".ytdl"));

    if (!downloadedFile) {
      throw new ExpressError("The media file was not created after download.", 500);
    }

    const filePath = path.join(tempDir, downloadedFile);
    const stats = await fsPromises.stat(filePath);

    return {
      filePath,
      tempDir,
      contentType: inferContentType(filePath),
      contentLength: String(stats.size),
    };
  } catch (error) {
    await cleanupTempDir(tempDir);

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

async function proxyMergedYtDlpMedia(sourceUrl, formatId, filename) {
  const { filePath, tempDir, contentType, contentLength } = await downloadWithYtDlpToTemp(sourceUrl, formatId, filename);
  const fileStream = fs.createReadStream(filePath);

  const cleanup = () => {
    void cleanupTempDir(tempDir);
  };

  fileStream.on("close", cleanup);
  fileStream.on("error", cleanup);

  return new NextResponse(Readable.toWeb(fileStream), {
    status: 200,
    headers: buildDownloadHeaders(path.basename(filePath), contentType, contentLength),
  });
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
        return await proxyMergedYtDlpMedia(sourceUrl, formatId, filename);
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


