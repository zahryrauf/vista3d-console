# VISTA-3D Console

A web client for [NVIDIA NIM for VISTA-3D](https://build.nvidia.com/nvidia/vista-3d) that talks to NVIDIA's hosted trial API and renders results in-browser with [NiiVue](https://github.com/niivue/niivue).

**Research use only**. VISTA-3D is not approved for clinical use.

## Hosted API Setup

1. Get an API key from [build.nvidia.com](https://build.nvidia.com) under `Profile -> API Keys`.
2. Make sure the key has `AI Foundation Models and Endpoints` enabled.
3. Copy `.env.local.example` to `.env.local`.
4. Put your key into `.env.local` and, if you want local file uploads, also add your Vercel Blob read-write token:

```bash
NVIDIA_API_KEY=nvapi-your-key-here
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

5. Install dependencies and start the app:

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## How it works

- The app calls NVIDIA's hosted VISTA-3D trial endpoint at `https://health.api.nvidia.com/v1/medicalimaging/nvidia/vista-3d`.
- Each inference call uses your NVIDIA API key server-side only.
- The trial includes 1000 free credits, and each inference call costs 1 credit.
- Credits and limits are shared across NVIDIA NIM microservices tied to the same account.
- If you upload a local file, the app stores it in Vercel Blob and then gives NVIDIA the public Blob URL to fetch.
- The volume URL must still be publicly reachable, because NVIDIA's servers fetch it directly.

## Using the console

1. Upload a local NIfTI (`.nii` or `.nii.gz`) or NRRD file, or paste a public URL.
2. Pick `All labels` or choose specific anatomy classes.
3. Run segmentation.
4. The response is streamed back as a single `.nii.gz` file and rendered as an overlay in the browser.

## Alternative: self-hosted container

If you want to avoid trial credits or hosted rate limits, the original self-hosted Docker path still exists. See NVIDIA's [Getting Started](https://docs.nvidia.com/nim/medical/vista3d/latest/getting-started.html) guide for the container workflow.

## Notes

- If the key is missing, the app shows an inline reminder to add `NVIDIA_API_KEY=nvapi-...` to `.env.local` and restart the dev server.
- If local uploads fail, confirm `BLOB_READ_WRITE_TOKEN` is present in `.env.local` and that your Vercel Blob store exists for this project.
- The result download is `vista3d-segmentation.nii.gz`.
- The overlay renders entirely in your browser through WebGL; nothing else is uploaded by the viewer.
