import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials:
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
});

function getPublicBaseUrl() {
  const endpoint = process.env.AWS_S3_PUBLIC_URL || process.env.AWS_S3_ENDPOINT;
  const bucket = process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_REGION;
  if (!bucket || !region) return null;

  if (!endpoint) {
    return `https://${bucket}.s3.${region}.amazonaws.com`;
  }

  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (!trimmed.startsWith("https://")) {
    return null;
  }

  if (trimmed.includes(process.env.AWS_S3_BUCKET)) {
    return trimmed;
  }

  return `${trimmed}/${process.env.AWS_S3_BUCKET}`;
}

function buildFallbackObjectUrl(bucket: string, region: string, key: string) {
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

async function buildSignedObjectUrl(bucket: string, key: string) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
    { expiresIn: 60 * 60 },
  );
}

function inferContentType(fileName: string, fallbackType?: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".nii.gz")) return "application/gzip";
  if (lower.endsWith(".nii")) return "application/octet-stream";
  if (lower.endsWith(".nrrd")) return "application/octet-stream";
  return fallbackType || "application/octet-stream";
}

export async function POST(request: Request): Promise<NextResponse> {
  const bucket = process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_REGION;

  if (!bucket || !region) {
    return NextResponse.json(
      {
        error:
          "AWS_S3_BUCKET and AWS_REGION are required. Add them to .env.local, then restart the dev server.",
      },
      { status: 500 },
    );
  }

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return NextResponse.json(
      {
        error:
          "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required. Add them to .env.local, then restart the dev server.",
      },
      { status: 500 },
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing upload file." }, { status: 400 });
  }

  const safeName = file.name?.trim() ? file.name.trim() : "upload.nii.gz";
  const pathname = `vista3d-uploads/${Date.now()}-${safeName}`;
  const safePathname = pathname
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const body = Buffer.from(await file.arrayBuffer());
  const contentType = inferContentType(safeName, file.type);

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: pathname,
        Body: body,
        ContentType: contentType,
      }),
    );

    const signedUrl = await buildSignedObjectUrl(bucket, pathname);
    const publicBaseUrl = getPublicBaseUrl();
    const fileUrl = new URL(`/api/blob/file/${safePathname}`, request.url).toString();
    const s3Url = buildFallbackObjectUrl(bucket, region, safePathname);
    const publicUrl = publicBaseUrl ? `${publicBaseUrl}/${safePathname}` : "";
    const downloadUrl = signedUrl || publicUrl || s3Url || fileUrl;

    if (!downloadUrl.trim()) {
      return NextResponse.json(
        { error: "Upload completed, but the generated URL was empty." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      downloadUrl,
      url: downloadUrl,
      fileUrl,
      publicUrl,
      s3Url,
      pathname,
      downloadPath: safePathname,
    });
  } catch (error) {
    console.error("S3 upload failed:", error);
    const message = error instanceof Error ? error.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
