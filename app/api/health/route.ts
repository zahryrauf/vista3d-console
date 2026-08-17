import { NextResponse } from "next/server";

function isLocalInferenceUrl(url: string | undefined) {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1"
    );
  } catch {
    return false;
  }
}

export async function GET() {
  const localInference = isLocalInferenceUrl(process.env.NIM_VISTA3D_INFERENCE_URL);
  const ready = Boolean(process.env.NVIDIA_API_KEY) || localInference;
  return NextResponse.json({
    ready,
    localInference,
    error: ready
      ? undefined
      : "NVIDIA_API_KEY is missing. Add it to .env.local and restart the dev server.",
  });
}
