import { resolveUrlFromRoute } from "@/utils/url-path";
import DownloadShell from "@/components/DownloadShell";

export default async function DownloadFromPathPage({ params, searchParams }) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const initialUrl = resolveUrlFromRoute(resolvedParams?.url || [], resolvedSearchParams);

  return <DownloadShell initialUrl={initialUrl} />;
}
