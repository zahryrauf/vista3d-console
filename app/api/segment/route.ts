import { NextRequest, NextResponse } from "next/server";
import { unzipSync } from "fflate";

type ClassPrompt = string | number;
type PointPrompt = Record<string, [number, number, number][]>;

interface SegmentRequestBody {
  image: string;
  prompts?: {
    classes?: ClassPrompt[];
    points?: PointPrompt;
  };
}

function getInferenceUrl() {
  return (
    process.env.NIM_VISTA3D_INFERENCE_URL ||
    "https://health.api.nvidia.com/v1/medicalimaging/nvidia/vista-3d"
  );
}

function isLocalInferenceUrl(url: string) {
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

async function readEndpointProblem(inferenceUrl: string) {
  try {
    const healthUrl = new URL("/v1/health/ready", inferenceUrl).toString();
    const health = await fetch(healthUrl, { signal: AbortSignal.timeout(10_000) });
    const text = await health.text().catch(() => "");
    if (health.ok) {
      return `The inference endpoint at ${inferenceUrl} is reachable, but the request still failed.`;
    }
    return `The NIM server at ${inferenceUrl} is reachable, but /v1/health/ready returned ${health.status}.${text ? ` ${text}` : ""}`.trim();
  } catch {
    return `Could not reach the NIM server at ${inferenceUrl}. Confirm that the container is running and exposing port 8000.`;
  }
}

export async function POST(req: NextRequest) {
  const inferenceUrl = getInferenceUrl();
  const localInference = isLocalInferenceUrl(inferenceUrl);
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey && !localInference) {
    return NextResponse.json(
      {
        error:
          "NVIDIA_API_KEY is not set. Add NVIDIA_API_KEY=nvapi-... to your .env.local file and restart the dev server.",
      },
      { status: 500 },
    );
  }

  let body: SegmentRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  if (!body.image || typeof body.image !== "string") {
    return NextResponse.json(
      { error: "An 'image' URL pointing to a NIfTI or NRRD volume is required." },
      { status: 400 },
    );
  }

  const image = body.image.trim();
  if (!image) {
    return NextResponse.json(
      { error: "An 'image' URL pointing to a NIfTI or NRRD volume is required." },
      { status: 400 },
    );
  }

  const payload: Record<string, unknown> = { image };
  const hasClassPrompts = body.prompts?.classes && body.prompts.classes.length > 0;
  const hasPointPrompts = body.prompts?.points && Object.keys(body.prompts.points).length > 0;
  if (hasClassPrompts || hasPointPrompts) {
    payload.prompts = {
      ...(hasClassPrompts ? { classes: body.prompts!.classes } : {}),
      ...(hasPointPrompts ? { points: body.prompts!.points } : {}),
    };
  }
  let upstream: Response;
  try {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };
    if (!localInference && apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    upstream = await fetch(inferenceUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    const endpointHint = localInference
      ? await readEndpointProblem(inferenceUrl)
      : `Could not reach the VISTA-3D inference endpoint at ${inferenceUrl}. Check the URL, network connection, and API key if this is the hosted service.`;
    return NextResponse.json(
      {
        error: timedOut
          ? `The VISTA-3D inference endpoint at ${inferenceUrl} did not finish in time.`
          : endpointHint,
      },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    const hint =
      upstream.status === 401
        ? " Hint: your API key may be missing, invalid, or lack the required scope."
        : upstream.status === 402 || upstream.status === 403
          ? " Hint: this often means your trial credits are exhausted or the key is not enabled for this endpoint."
          : "";
    return NextResponse.json(
      { error: `Inference failed (${upstream.status}).${hint}${text ? ` ${text}` : ""}`.trim() },
      { status: upstream.status || 502 },
    );
  }

  const upstreamContentType = upstream.headers.get("Content-Type") || "";
  if (upstreamContentType.includes("application/json") || upstreamContentType.startsWith("text/")) {
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      {
        error: `NVIDIA returned a non-file response.${text ? ` ${text}` : ""}`.trim(),
      },
      { status: 502 },
    );
  }

  const responseBytes = new Uint8Array(await upstream.arrayBuffer());
  const looksLikeZip = responseBytes.length >= 4 && responseBytes[0] === 0x50 && responseBytes[1] === 0x4b;
  if (!looksLikeZip && responseBytes.length < 1000) {
    return NextResponse.json(
      {
        error: `NVIDIA returned an unexpectedly small payload (${responseBytes.length} bytes). The source URL may not be serving a valid NIfTI/NRRD file.`,
      },
      { status: 502 },
    );
  }

  if (!looksLikeZip) {
    return new NextResponse(responseBytes, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/octet-stream",
        "Content-Disposition": 'attachment; filename="vista3d-segmentation.bin"',
      },
    });
  }

  const entries = unzipSync(responseBytes);
  const entryNames = Object.keys(entries);
  const preferredName =
    entryNames.find((name) => name.endsWith(".nii.gz")) ||
    entryNames.find((name) => name.endsWith(".nii")) ||
    entryNames.find((name) => name.endsWith(".nrrd")) ||
    entryNames[0];

  if (!preferredName) {
    return NextResponse.json(
      { error: "NVIDIA returned an empty ZIP archive." },
      { status: 502 },
    );
  }

  const fileBytes = entries[preferredName];
  const contentType =
    preferredName.endsWith(".nii.gz")
      ? "application/gzip"
      : preferredName.endsWith(".nii")
        ? "application/octet-stream"
        : preferredName.endsWith(".nrrd")
          ? "application/octet-stream"
          : "application/octet-stream";

  return new NextResponse(fileBytes, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${preferredName}"`,
    },
  });
}
