import { APP_CONFIG } from "@/configs/app.config";
import { createSuccessResponse } from "@/utils/api-response";
import { ExpressError } from "@/utils/expressError";
import { logError, logInfo, logWarn } from "@/utils/logger";
import { ytDlp, getYtDlpBinaryPath } from "@/utils/ytdlp";

const { Innertube } = await import("youtubei.js");
const { getQuickJS } = await import("quickjs-emscripten");

let youtubeClient = null;

async function getClient() {
  if (youtubeClient) {
    return youtubeClient;
  }

  const QuickJS = await getQuickJS();

  youtubeClient = await Innertube.create({
    lang: "en",
    location: "US",
    retrieve_player: true,
    generate_session_locally: true,
    js_evaluator: (code) => {
      const vm = QuickJS.newContext();

      try {
        const result = vm.evalCode(code);

        if (result.error) {
          const message = vm.dump(result.error);
          result.error.dispose();
          throw new Error(typeof message === "object" ? JSON.stringify(message) : String(message));
        }

        const value = vm.dump(result.value);
        result.value.dispose();
        return String(value);
      } finally {
        vm.dispose();
      }
    },
  });

  return youtubeClient;
}

function formatDuration(seconds) {
  const total = Number(seconds || 0);

  if (!total) {
    return "00:00";
  }

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value) => String(value).padStart(2, "0");

  return hours ? [hours, minutes, secs].map(pad).join(":") : [minutes, secs].map(pad).join(":");
}

function trimText(text, maxLength) {
  if (!text) {
    return "Formats ready to download.";
  }

  return text.length <= maxLength ? text : `${text.slice(0, maxLength).trim()}...`;
}

function pickBestThumbnail(thumbnails = [], videoId = "") {
  const fallback = videoId ? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` : "";

  if (!Array.isArray(thumbnails) || !thumbnails.length) {
    return fallback;
  }

  const best = [...thumbnails]
    .filter((thumbnail) => thumbnail?.url)
    .sort((left, right) => (right.width || 0) - (left.width || 0))[0];

  if (!best?.url) {
    return fallback;
  }

  const url = best.url.startsWith("//") ? `https:${best.url}` : best.url;

  try {
    new URL(url);
    return url;
  } catch {
    return fallback;
  }
}

function extractVideoId(url) {
  const patterns = [
    /(?:v=|youtu\.be\/)([\w-]{11})/,
    /youtube\.com\/shorts\/([\w-]{11})/,
    /youtube\.com\/embed\/([\w-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function isValidYoutubeUrl(url) {
  return Boolean(extractVideoId(url));
}

function normalizeYoutubeUrl(url) {
  const videoId = extractVideoId(url);
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : url;
}

function safeFileSizeMB(bytes) {
  if (!bytes) {
    return "Variable size";
  }

  return `${Math.round(Number(bytes) / 1048576)} MB`;
}

function getMimeBase(mimeType = "") {
  return mimeType.split(";")[0].trim().toLowerCase();
}

function sanitizeFilename(filename = "download") {
  return filename.replace(/[\\/:*?"<>|]/g, "_");
}

function buildProxyUrl(streamUrl, filename) {
  return `/api/proxy?url=${encodeURIComponent(streamUrl)}&filename=${encodeURIComponent(sanitizeFilename(filename))}`;
}

function buildYtDlpProxyUrl(sourceUrl, formatId, filename) {
  return `/api/proxy?sourceUrl=${encodeURIComponent(sourceUrl)}&formatId=${encodeURIComponent(formatId)}&filename=${encodeURIComponent(sanitizeFilename(filename))}`;
}

function getErrorText(error) {
  return [
    error?.name,
    error?.message,
    error?.stderr,
    error?.stdout,
    error?.shortMessage,
    error?.stack,
  ]
    .filter(Boolean)
    .join(" ");
}

function normalizeYoutubeError(error) {
  const text = getErrorText(error);

  if (/private|not available|unavailable|region|copyright/i.test(text)) {
    return new ExpressError("This video is unavailable, private, or region-restricted.", 404);
  }

  if (/sign in|login|age.restricted|confirm your age/i.test(text)) {
    return new ExpressError("This video requires sign-in or is age-restricted.", 403);
  }

  if (/rate.limit|429|too many|429 Too Many Requests/i.test(text)) {
    return new ExpressError("YouTube is rate-limiting requests. Wait a moment and try again.", 429);
  }

  if (/network|ECONNRESET|ETIMEDOUT|ENOTFOUND|EACCES|AggregateError|fetch failed/i.test(text)) {
    return new ExpressError("Server cannot reach YouTube right now. Retry shortly.", 503);
  }

  if (/No downloadable formats found/i.test(text)) {
    return new ExpressError("No downloadable formats found for this video.", 404);
  }

  return new ExpressError("Unable to load formats for this video. Try another link or retry shortly.", 500);
}

function normalizeResolvedUrl(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value.startsWith("http") ? value : null;
  }

  if (typeof value === "object" && typeof value.toString === "function") {
    const text = value.toString();
    return text.startsWith("http") ? text : null;
  }

  return null;
}

function isDirectFormatUrl(url = "") {
  return /^https?:\/\//i.test(url) && !/\.m3u8(\?|$)/i.test(url);
}

function getYtDlpFileSize(format) {
  return Number(format?.filesize || format?.filesize_approx || 0);
}

function getYtDlpQualityLabel(format) {
  return (
    format?.format_note ||
    format?.resolution ||
    (format?.height ? `${format.height}p` : null) ||
    format?.format_id ||
    "Unknown"
  );
}

function isUsableYtDlpVideoFormat(format) {
  return Boolean(
    format?.url &&
      isDirectFormatUrl(format.url) &&
      format?.vcodec &&
      format.vcodec !== "none" &&
      ["mp4", "webm"].includes(String(format.ext || "").toLowerCase())
  );
}

function isUsableYtDlpAudioFormat(format) {
  return Boolean(
    format?.url &&
      isDirectFormatUrl(format.url) &&
      format?.acodec &&
      format.acodec !== "none" &&
      (!format?.vcodec || format.vcodec === "none") &&
      ["m4a", "mp3", "webm", "opus"].includes(String(format.ext || "").toLowerCase())
  );
}

function formatHasEmbeddedAudio(format) {
  return Boolean(format?.acodec && format.acodec !== "none");
}

function isPreferredAudioContainer(audioFormat, videoExt) {
  if (videoExt === "mp4") {
    return ["m4a", "mp4"].includes(String(audioFormat?.ext || "").toLowerCase());
  }

  if (videoExt === "webm") {
    return ["webm", "opus"].includes(String(audioFormat?.ext || "").toLowerCase());
  }

  return true;
}

function selectBestAudioFormat(allFormats, videoExt) {
  const audioFormats = allFormats
    .filter(isUsableYtDlpAudioFormat)
    .sort((left, right) => Number(right.abr || right.tbr || 0) - Number(left.abr || left.tbr || 0));

  return audioFormats.find((format) => isPreferredAudioContainer(format, videoExt)) || audioFormats[0] || null;
}

function buildMergedFormatId(videoFormat, audioFormat) {
  if (formatHasEmbeddedAudio(videoFormat) || !audioFormat) {
    return String(videoFormat.format_id);
  }

  return `${videoFormat.format_id}+${audioFormat.format_id}`;
}

function pickYtDlpThumbnail(info, videoId) {
  if (info?.thumbnail) {
    return info.thumbnail;
  }

  return pickBestThumbnail(info?.thumbnails, videoId);
}

function buildPayload(details, sourceUrl, videoId, videoFormats, audioFormats, extractor) {
  const thumbnail = pickBestThumbnail(details?.thumbnails, videoId);

  return {
    id: details?.id || videoId,
    sourceUrl,
    title: details?.title || "Unknown title",
    author: details?.author || "Unknown creator",
    duration: formatDuration(details?.duration),
    thumbnail,
    description: trimText(details?.short_description, APP_CONFIG.maxDescriptionLength),
    formatUrlExpiresNote: "Format URLs expire after a few hours. Re-fetch if downloads fail.",
    extractor,
    formats: {
      video: videoFormats,
      audio: audioFormats,
    },
  };
}

function buildYtDlpPayload(info, sourceUrl, videoId) {
  const allFormats = Array.isArray(info?.formats) ? info.formats : [];

  const videoFormats = allFormats
    .filter(isUsableYtDlpVideoFormat)
    .sort((left, right) => {
      const heightDiff = Number(right.height || 0) - Number(left.height || 0);
      if (heightDiff) {
        return heightDiff;
      }

      return Number(right.fps || 0) - Number(left.fps || 0);
    })
    
    .map((format) => {
      const quality = getYtDlpQualityLabel(format);
      const extension = String(format.ext || "mp4").toLowerCase();
      const preferredAudio = selectBestAudioFormat(allFormats, extension);
      const mergedFormatId = buildMergedFormatId(format, preferredAudio);
      const hasAudio = formatHasEmbeddedAudio(format) || Boolean(preferredAudio);
      const filename = `${videoId}_${quality}.${extension}`;
      const audioSuffix = formatHasEmbeddedAudio(format)
        ? " - Includes audio"
        : preferredAudio
          ? ` - Merged with ${Math.round(Number(preferredAudio.abr || preferredAudio.tbr || 0))} kbps audio`
          : " - No audio";

      return {
        itag: mergedFormatId,
        quality,
        type: extension.toUpperCase(),
        requiresMerge: !formatHasEmbeddedAudio(format) && Boolean(preferredAudio),
        details: `${format.fps || 30} fps - ${safeFileSizeMB(getYtDlpFileSize(format))}${audioSuffix}`,
        url: buildYtDlpProxyUrl(sourceUrl, mergedFormatId, filename),
        mode: String(mergedFormatId).includes("+") ? "Merged HD" : "Instant",
      };
    });

  const audioFormats = allFormats
    .filter(isUsableYtDlpAudioFormat)
    .sort((left, right) => Number(right.abr || right.tbr || 0) - Number(left.abr || left.tbr || 0))
    
    .map((format, index) => {
      const kbps = Math.round(Number(format.abr || format.tbr || 128));
      const extension = String(format.ext || "m4a").toLowerCase();
      const filename = `${videoId}_audio_${kbps}kbps.${extension}`;
      const badge = index === 0 ? "Best available" : format.format_note || "Audio";

      return {
        itag: String(format.format_id),
        quality: `${kbps} kbps`,
        type: extension.toUpperCase(),
        details: `${badge} - ${format.acodec || "Audio"} - ${safeFileSizeMB(getYtDlpFileSize(format))}`,
        url: buildYtDlpProxyUrl(sourceUrl, String(format.format_id), filename),
        mode: index === 0 ? "Best Audio" : "Instant",
      };
    });

  const thumbnail = pickYtDlpThumbnail(info, videoId);

  return {
    id: info?.id || videoId,
    sourceUrl: info?.webpage_url || sourceUrl,
    title: info?.title || "Unknown title",
    author: info?.uploader || info?.channel || info?.creator || "Unknown creator",
    duration: formatDuration(info?.duration),
    thumbnail,
    description: trimText(info?.description, APP_CONFIG.maxDescriptionLength),
    formatUrlExpiresNote: "Format URLs expire after a few hours. Re-fetch if downloads fail.",
    extractor: "yt-dlp",
    formats: {
      video: videoFormats,
      audio: audioFormats,
    },
  };
}

async function fetchWithYtDlp(url, videoId) {
  logInfo("[YTDLP] Fetching formats", {
    videoId,
    url,
    binaryPath: getYtDlpBinaryPath(),
  });

  const info = await ytDlp(
    url,
    {
      dumpSingleJson: true,
      skipDownload: true,
      noWarnings: true,
      noPlaylist: true,
      quiet: true,
    },
    {
      timeout: 30000,
      windowsHide: true,
    }
  );

  const formatCount = Array.isArray(info?.formats) ? info.formats.length : 0;

  logInfo("[YTDLP] Fetched formats", {
    videoId,
    formatCount,
    title: info?.title,
  });

  if (!formatCount) {
    throw new ExpressError("No downloadable formats found for this video.", 404);
  }

  return info;
}

async function resolveStreamUrl(format, player) {
  const directUrl = normalizeResolvedUrl(format.url);

  if (directUrl) {
    return directUrl;
  }

  if (typeof format.decipher === "function") {
    const deciphered = normalizeResolvedUrl(await format.decipher(player));
    if (deciphered) {
      return deciphered;
    }
  }

  return null;
}

async function resolveFormats(youtube, info, videoId, client) {
  const streamingData = info.streaming_data;

  if (!streamingData) {
    logWarn("[YOUTUBEI] Missing streaming_data", { videoId, client });
    return { videoFormats: [], audioFormats: [] };
  }

  const allFormats = [...(streamingData.formats || []), ...(streamingData.adaptive_formats || [])];
  const player = youtube?.session?.player;

  logInfo("[YOUTUBEI] Resolving formats", {
    client,
    videoId,
    totalFormats: allFormats.length,
    hasPlayer: Boolean(player),
  });

  const resolved = await Promise.all(
    allFormats.map(async (format) => {
      try {
        const url = await resolveStreamUrl(format, player);

        if (!url || !isDirectFormatUrl(url)) {
          return null;
        }

        return { format, url };
      } catch (error) {
        logWarn("[YOUTUBEI] Format resolution failed", {
          client,
          videoId,
          itag: format?.itag,
          message: error?.message || String(error),
        });
        return null;
      }
    })
  );

  const valid = resolved.filter(Boolean);

  const videoFormats = valid
    .filter(({ format }) => format.has_video && getMimeBase(format.mime_type) === "video/mp4")
    .sort((left, right) => (right.format.height || 0) - (left.format.height || 0))
    
    .map(({ format, url }) => {
      const quality = format.quality_label || `${format.height || "?"}p`;

      return {
        itag: format.itag,
        quality,
        type: "MP4",
        requiresMerge: !format.has_audio,
        details: `${format.fps || 30} fps - ${safeFileSizeMB(format.content_length)}${!format.has_audio ? " - No audio" : " - Includes audio"}`,
        url: buildProxyUrl(url, `${videoId}_${quality}.mp4`),
        mode: format.has_audio ? "Instant" : "Video Only",
      };
    });

  const audioFormats = valid
    .filter(({ format }) => {
      const mime = getMimeBase(format.mime_type);
      return format.has_audio && !format.has_video && mime.startsWith("audio");
    })
    .sort((left, right) => (right.format.bitrate || 0) - (left.format.bitrate || 0))
    
    .map(({ format, url }, index) => {
      const mime = getMimeBase(format.mime_type);
      const extension = mime.split("/")?.[1] || "webm";
      const kbps = Math.round((format.bitrate || 128000) / 1000);
      const badge = index === 0 ? "Best available" : (format.audio_quality || "Audio");

      return {
        itag: format.itag,
        quality: `${kbps} kbps`,
        type: extension.toUpperCase(),
        details: `${badge} - ${format.approx_duration_ms ? `${Math.round(Number(format.approx_duration_ms) / 60000)} min` : "Ready"}`,
        url: buildProxyUrl(url, `${videoId}_audio_${kbps}kbps.${extension}`),
        mode: index === 0 ? "Best Audio" : "Instant",
      };
    });

  logInfo("[YOUTUBEI] Resolved formats", {
    client,
    videoId,
    resolvedFormats: valid.length,
    videoCount: videoFormats.length,
    audioCount: audioFormats.length,
  });

  return { videoFormats, audioFormats };
}

async function fetchWithYoutubei(url, videoId) {
  const clients = ["WEB", "ANDROID", "IOS", "TV_EMBEDDED"];

  let info = null;
  let youtube = null;
  let selectedClient = null;
  let resolvedFormats = { videoFormats: [], audioFormats: [] };

  for (const client of clients) {
    try {
      youtube = await getClient();
      info = await youtube.getBasicInfo(videoId, { client });

      const formatCount = (info?.streaming_data?.formats?.length || 0) + (info?.streaming_data?.adaptive_formats?.length || 0);

      logInfo("[YOUTUBEI] Client fetched info", {
        client,
        videoId,
        formatCount,
      });

      if (!formatCount) {
        continue;
      }

      resolvedFormats = await resolveFormats(youtube, info, videoId, client);

      if (resolvedFormats.videoFormats.length || resolvedFormats.audioFormats.length) {
        selectedClient = client;
        break;
      }

      logWarn("[YOUTUBEI] Client returned no usable formats", {
        client,
        videoId,
      });
    } catch (error) {
      logWarn("[YOUTUBEI] Client failed", {
        client,
        videoId,
        message: error?.message || String(error),
      });
      youtubeClient = null;
      info = null;
    }
  }

  if (!info || !selectedClient) {
    throw new ExpressError("No downloadable formats found for this video with the available YouTube clients.", 404);
  }

  const details = info?.basic_info;
  const streamingData = info?.streaming_data;

  if (!details || !streamingData) {
    throw new ExpressError("Could not retrieve video info. The video may be unavailable.", 404);
  }

  return {
    extractor: `youtubei:${selectedClient}`,
    payload: buildPayload(details, url, videoId, resolvedFormats.videoFormats, resolvedFormats.audioFormats, `youtubei:${selectedClient}`),
  };
}

export async function downloadController(request) {
  let body;

  try {
    body = await request.json();
  } catch {
    throw new ExpressError("Invalid or missing JSON body.", 400);
  }

  const rawUrl = body?.url?.trim();

  if (!rawUrl) {
    throw new ExpressError("Please paste a YouTube link first.", 400);
  }

  const url = normalizeYoutubeUrl(rawUrl);

  if (!isValidYoutubeUrl(url)) {
    throw new ExpressError("The provided URL is not a valid YouTube video link.", 400);
  }

  const videoId = extractVideoId(url);
  let ytDlpError = null;

  try {
    const ytDlpInfo = await fetchWithYtDlp(url, videoId);
    const payload = buildYtDlpPayload(ytDlpInfo, url, videoId);

    if (payload.formats.video.length || payload.formats.audio.length) {
      return createSuccessResponse("Download links are ready via yt-dlp.", payload);
    }

    throw new ExpressError("No downloadable formats found for this video.", 404);
  } catch (error) {
    ytDlpError = error;
    logWarn("[YTDLP] Primary extractor failed", {
      videoId,
      message: error?.message || String(error),
      stderr: error?.stderr,
    });
  }

  try {
    const result = await fetchWithYoutubei(url, videoId);
    return createSuccessResponse(`Download links are ready via ${result.extractor}.`, result.payload);
  } catch (youtubeiError) {
    logError("[DOWNLOAD] All extractors failed", {
      videoId,
      ytDlp: getErrorText(ytDlpError),
      youtubei: getErrorText(youtubeiError),
    });

    throw normalizeYoutubeError(ytDlpError || youtubeiError);
  }
}


