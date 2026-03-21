function normalizeWatchPath(pathname) {
  return pathname.replace(/\/{2,}/g, "/").replace(/^\/+/, "");
}

function normalizeClientYoutubeUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      return id ? `https://www.youtube.com/watch?v=${id}` : url;
    }

    if (host === "youtube.com" || host === "m.youtube.com") {
      if (parsed.pathname.startsWith("/shorts/")) {
        const id = parsed.pathname.split("/").filter(Boolean)[1];
        return id ? `https://www.youtube.com/watch?v=${id}` : url;
      }
    }

    return url;
  } catch {
    return url;
  }
}

export function buildDownloadPath(url) {
  if (!url) {
    return "/";
  }

  try {
    const parsed = new URL(normalizeClientYoutubeUrl(url));
    const host = parsed.host;
    const pathname = normalizeWatchPath(parsed.pathname);
    const search = parsed.search || "";

    return `/${parsed.protocol.replace(":", "")}/${host}/${pathname}${search}`;
  } catch {
    return "/";
  }
}

export function resolveUrlFromRoute(segments = [], searchParams = {}) {
  if (!segments.length) {
    return "";
  }

  const [protocol = "https", host = "", ...rest] = segments;

  if (!host) {
    return "";
  }

  const pathname = rest.length ? `/${rest.join("/")}` : "";
  const params = new URLSearchParams();

  Object.entries(searchParams || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => params.append(key, entry));
      return;
    }

    if (value !== undefined) {
      params.append(key, value);
    }
  });

  const query = params.toString();
  return normalizeClientYoutubeUrl(`${protocol}://${host}${pathname}${query ? `?${query}` : ""}`);
}
