import { NextResponse } from "next/server";

export async function GET() {
  const ready = Boolean(process.env.NVIDIA_API_KEY);
  return NextResponse.json({
    ready,
    error: ready
      ? undefined
      : "NVIDIA_API_KEY is missing. Add it to .env.local and restart the dev server.",
  });
}
