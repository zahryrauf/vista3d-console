import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

export async function POST(request: Request): Promise<NextResponse> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json(
      {
        error:
          "BLOB_READ_WRITE_TOKEN is missing. Add it to .env.local, then restart the dev server.",
      },
      { status: 500 },
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing upload file." }, { status: 400 });
  }

  const pathname = `vista3d-uploads/${Date.now()}-${file.name}`;

  try {
    const blob = await put(pathname, file, {
      access: "public",
      token,
      contentType: file.type || "application/octet-stream",
    });

    return NextResponse.json({ url: blob.url, pathname: blob.pathname });
  } catch (error) {
    console.error("Blob upload failed:", error);
    const message = error instanceof Error ? error.message : "Upload failed.";
    return NextResponse.json(
      {
        error: message.includes("Store not found")
          ? "Vercel Blob store not found for this token. Make sure the Blob store exists in your Vercel project and BLOB_READ_WRITE_TOKEN belongs to that project."
          : message.includes("No token found") || message.includes("Invalid `token`")
            ? "BLOB_READ_WRITE_TOKEN is missing or invalid. Re-copy it from Vercel into .env.local and restart the dev server."
            : message,
      },
      { status: 500 },
    );
  }
}
