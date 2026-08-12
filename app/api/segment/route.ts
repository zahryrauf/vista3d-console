import { NextRequest, NextResponse } from "next/server";

type ClassPrompt = string | number;
type PointPrompt = Record<string, [number, number, number][]>;

interface SegmentRequestBody {
  image: string;
  prompts?: {
    classes?: ClassPrompt[];
    points?: PointPrompt;
  };
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
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

  const payload: Record<string, unknown> = { image: body.image };
  const hasClassPrompts = body.prompts?.classes && body.prompts.classes.length > 0;
  const hasPointPrompts = body.prompts?.points && Object.keys(body.prompts.points).length > 0;
  if (hasClassPrompts || hasPointPrompts) {
    payload.prompts = {
      ...(hasClassPrompts ? { classes: body.prompts!.classes } : {}),
      ...(hasPointPrompts ? { points: body.prompts!.points } : {}),
    };
  }
  payload.output = { extension: ".nii.gz", dtype: "uint8" };

  let upstream: Response;
  try {
    upstream = await fetch("https://health.api.nvidia.com/v1/medicalimaging/nvidia/vista-3d", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return NextResponse.json(
      {
        error: timedOut
          ? "The NVIDIA hosted VISTA-3D endpoint did not finish inference in time."
          : "Could not reach NVIDIA's hosted VISTA-3D endpoint. Check your network connection and API key.",
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

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": 'attachment; filename="vista3d-segmentation.nii.gz"',
    },
  });
}
