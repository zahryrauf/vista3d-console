import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getS3Config, uploadToS3 } from "@/lib/s3";

export async function POST(request: Request): Promise<NextResponse> {
  const s3Config = getS3Config();
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const hasValidBlobToken = Boolean(token && !token.includes("..."));

  if (!s3Config.isConfigured && !hasValidBlobToken) {
    return NextResponse.json(
      {
        error:
          "Storage is not configured. Add your AWS S3 credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET) or BLOB_READ_WRITE_TOKEN to .env.local and restart the dev server.",
      },
      { status: 500 },
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing upload file." }, { status: 400 });
  }

  try {
    const arrayBuffer = await file.arrayBuffer();

    // Primary: Upload to S3 if configured
    if (s3Config.isConfigured) {
      const result = await uploadToS3(
        Buffer.from(arrayBuffer),
        file.name,
        file.type || "application/octet-stream"
      );
      return NextResponse.json({
        url: result.url,
        pathname: result.key,
        provider: "s3",
        filename: file.name,
      });
    }

    // Fallback: Vercel Blob
    const pathname = `vista3d-uploads/${Date.now()}-${file.name}`;
    const blob = await put(pathname, file, {
      access: "public",
      token: token!,
      contentType: file.type || "application/octet-stream",
    });

    return NextResponse.json({
      url: blob.url,
      pathname: blob.pathname,
      provider: "vercel-blob",
      filename: file.name,
    });
  } catch (error) {
    console.error("Upload failed:", error);
    const message = error instanceof Error ? error.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
