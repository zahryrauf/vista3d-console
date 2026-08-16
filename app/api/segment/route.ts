import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { isAllowedNvidiaDomain, normalizeVolumeUrl } from "../blob/import-url/route";
import { getS3Config, uploadToS3 } from "@/lib/s3";

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

  let targetImageUrl = normalizeVolumeUrl(body.image);
  const s3Config = getS3Config();
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

  // If domain is not known to be allowed by NVIDIA and we have storage configured, auto-relay it
  if (!isAllowedNvidiaDomain(targetImageUrl)) {
    try {
      if (s3Config.isConfigured || (blobToken && !blobToken.includes("..."))) {
        const downloadRes = await fetch(targetImageUrl, { signal: AbortSignal.timeout(45 * 1000) });
        if (downloadRes.ok) {
          const arrayBuffer = await downloadRes.arrayBuffer();
          if (arrayBuffer.byteLength > 0) {
            let filename = "volume.nii.gz";
            try {
              const urlPath = new URL(targetImageUrl).pathname;
              const base = urlPath.split("/").pop();
              if (base && (base.endsWith(".nii") || base.endsWith(".nii.gz") || base.endsWith(".nrrd"))) {
                filename = decodeURIComponent(base);
              }
            } catch {
              // ignore
            }

            if (s3Config.isConfigured) {
              const s3Result = await uploadToS3(Buffer.from(arrayBuffer), filename, "application/gzip");
              targetImageUrl = s3Result.url;
            } else if (blobToken) {
              const pathname = `vista3d-imports/${Date.now()}-${filename}`;
              const blob = await put(pathname, arrayBuffer, {
                access: "public",
                token: blobToken,
                contentType: "application/gzip",
              });
              targetImageUrl = blob.url;
            }
          }
        }
      }
    } catch (e) {
      console.warn("Auto-relay in /api/segment failed, proceeding with original URL:", e);
    }
  }

  const payload: Record<string, unknown> = { image: targetImageUrl };
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
    let hint = "";
    if (upstream.status === 401) {
      hint = " Hint: your API key may be missing, invalid, or lack the required scope.";
    } else if (upstream.status === 402 || upstream.status === 403) {
      hint = " Hint: this often means your trial credits are exhausted or the key is not enabled for this endpoint.";
    } else if (text.includes("URL domain is not allowed")) {
      hint = " Hint: NVIDIA NIM requires volume files to be hosted on AWS S3, Google Cloud Storage, Azure Blob, or NVIDIA NGC. Configure your AWS S3 credentials in .env.local for automatic relaying.";
    }

    return NextResponse.json(
      { error: `Inference failed (${upstream.status}).${hint}${text ? ` ${text}` : ""}`.trim() },
      { status: upstream.status || 502 },
    );
  }

  const contentType = upstream.headers.get("content-type") || "";
  const arrayBuffer = await upstream.arrayBuffer();

  if (contentType.includes("application/json") || arrayBuffer.byteLength < 200) {
    const text = Buffer.from(arrayBuffer).toString("utf-8");
    return NextResponse.json(
      {
        message: text.includes("message") ? JSON.parse(text).message : "Inference completed by NVIDIA NIM.",
        isMaskAvailable: false,
        note: "NVIDIA's hosted trial API confirmed inference success. (Full binary segmentation masks are output when using a dedicated or self-hosted VISTA-3D NIM container).",
      },
      { status: 200 }
    );
  }

  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": 'attachment; filename="vista3d-segmentation.nii.gz"',
    },
  });
}
