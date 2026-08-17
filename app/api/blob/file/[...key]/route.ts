import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) {
    return NextResponse.json({ error: "AWS_S3_BUCKET is missing." }, { status: 500 });
  }

  const { key } = await params;
  const objectKey = key.map(decodeURIComponent).join("/");

  try {
    const result = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: objectKey,
      }),
    );

    const headers = new Headers();
    headers.set("Content-Type", result.ContentType || "application/octet-stream");
    if (result.ContentLength !== undefined) {
      headers.set("Content-Length", String(result.ContentLength));
    }

    return new NextResponse(result.Body as BodyInit, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("S3 proxy fetch failed:", error);
    const message = error instanceof Error ? error.message : "File not found.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
