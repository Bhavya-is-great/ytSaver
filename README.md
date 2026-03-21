# YTSaver

Next.js 16 App Router application for fetching YouTube formats and proxying downloads through server routes.

## Local development

```bash
npm install
npm run dev
```

The app listens on `http://localhost:3000`.

## Required runtime assumptions

- `yt-dlp` must be available either through `YTDLP_PATH`, the system `PATH`, or `node_modules/yt-dlp-exec/bin`.
- `ffmpeg` must be available through `FFMPEG_PATH` or the system `PATH` if you want merged video+audio downloads.
- Cookie files are intentionally excluded from Docker builds. Mount them into the container or provide your own runtime secret strategy if restricted videos require them.

## Docker

The project is configured for standalone Next.js output and a multi-stage Linux image.

### Build

```bash
docker build -t ytsaver .
```

### Run

```bash
docker run --rm -p 3000:3000 \
  -e NODE_ENV=production \
  -e HOSTNAME=0.0.0.0 \
  -e PORT=3000 \
  -e YTDLP_PATH=/app/node_modules/yt-dlp-exec/bin/yt-dlp \
  -e FFMPEG_PATH=/usr/bin/ffmpeg \
  ytsaver
```

### Compose

```bash
docker compose up --build
```

## Deployment notes

- Put a reverse proxy such as nginx, Caddy, Traefik, or your platform ingress in front of the container.
- Persist or externalize `.next/cache` only if you later add ISR or shared cache requirements.
- If you run multiple replicas behind a load balancer, set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` consistently across instances.
- Keep `.env.local`, cookies, and other local secrets out of the image. Inject them at runtime.
