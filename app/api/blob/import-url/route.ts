import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { getS3Config, uploadToS3 } from "@/lib/s3";

export function normalizeVolumeUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  // Transform GitHub blob URLs to raw user content URLs
  const githubBlobMatch = url.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/,
  );
  if (githubBlobMatch) {
    const [, user, repo, branch, path] = githubBlobMatch;
    return `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${path}`;
  }

  // Transform GitLab blob URLs to raw URLs
  const gitlabBlobMatch = url.match(
    /^https?:\/\/gitlab\.com\/([^/]+)\/([^/]+)\/-\/blob\/([^/]+)\/(.+)$/,
  );
  if (gitlabBlobMatch) {
    const [, user, repo, branch, path] = gitlabBlobMatch;
    return `https://gitlab.com/${user}/${repo}/-/raw/${branch}/${path}`;
  }

  return url;
}

export function isAllowedNvidiaDomain(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    return (
      host === "assets.ngc.nvidia.com" ||
      host.endsWith(".s3.amazonaws.com") ||
      host.endsWith(".amazonaws.com") ||
      host === "storage.googleapis.com" ||
      host.endsWith(".blob.core.windows.net") ||
      (host === "raw.githubusercontent.com" && parsed.pathname.toLowerCase().startsWith("/nvidia/"))
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const s3Config = getS3Config();
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  const hasValidBlobToken = Boolean(blobToken && !blobToken.includes("..."));

  if (!s3Config.isConfigured && !hasValidBlobToken) {
    return NextResponse.json(
      {
        error:
          "Neither AWS S3 nor Vercel Blob is configured. To enable automatic URL importing and relaying for NVIDIA NIM, please add your AWS credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET) or BLOB_READ_WRITE_TOKEN to .env.local.",
      },
      { status: 500 },
    );
  }

  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  if (!body.url || typeof body.url !== "string") {
    return NextResponse.json({ error: "A valid 'url' string is required." }, { status: 400 });
  }

  const normalizedUrl = normalizeVolumeUrl(body.url);

  try {
    const downloadRes = await fetch(normalizedUrl, {
      signal: AbortSignal.timeout(60 * 1000),
    });

    if (!downloadRes.ok) {
      return NextResponse.json(
        {
          error: `Failed to download file from remote URL (${downloadRes.status} ${downloadRes.statusText}). Ensure the URL is publicly accessible.`,
        },
        { status: 400 },
      );
    }

    const contentType = downloadRes.headers.get("content-type") || "application/octet-stream";
    if (contentType.includes("text/html")) {
      return NextResponse.json(
        {
          error:
            "The remote URL returned an HTML page instead of a medical volume. Ensure you are linking directly to the raw .nii, .nii.gz, or .nrrd file.",
        },
        { status: 400 },
      );
    }

    const arrayBuffer = await downloadRes.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      return NextResponse.json({ error: "The downloaded file is empty." }, { status: 400 });
    }

    // Determine filename
    let filename = "volume.nii.gz";
    try {
      const urlPath = new URL(normalizedUrl).pathname;
      const base = urlPath.split("/").pop();
      if (base && (base.endsWith(".nii") || base.endsWith(".nii.gz") || base.endsWith(".nrrd"))) {
        filename = decodeURIComponent(base);
      }
    } catch {
      // fallback to default
    }

    // Primary: Upload to S3 if configured
    if (s3Config.isConfigured) {
      const result = await uploadToS3(Buffer.from(arrayBuffer), filename, "application/gzip");
      return NextResponse.json({
        url: result.url,
        pathname: result.key,
        provider: "s3",
        originalUrl: body.url,
        normalizedUrl,
        filename,
        size: arrayBuffer.byteLength,
      });
    }

    // Fallback: Upload to Vercel Blob
    const pathname = `vista3d-imports/${Date.now()}-${filename}`;
    const blob = await put(pathname, arrayBuffer, {
      access: "public",
      token: blobToken!,
      contentType: "application/gzip",
    });

    return NextResponse.json({
      url: blob.url,
      pathname: blob.pathname,
      provider: "vercel-blob",
      originalUrl: body.url,
      normalizedUrl,
      filename,
      size: arrayBuffer.byteLength,
    });
  } catch (error) {
    console.error("Auto URL import error:", error);
    const message = error instanceof Error ? error.message : "Failed to import remote URL.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
