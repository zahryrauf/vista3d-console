# VISTA-3D Console

A web client for [NVIDIA NIM for VISTA-3D](https://build.nvidia.com/nvidia/vista-3d) that can talk to the hosted trial API or a local VISTA-3D NIM container, then renders results in-browser with [NiiVue](https://github.com/niivue/niivue).

**Research use only**. VISTA-3D is not approved for clinical use.

## Setup

1. Get an API key from [build.nvidia.com](https://build.nvidia.com) under `Profile -> API Keys`.
2. Make sure the key has `AI Foundation Models and Endpoints` enabled.
3. Copy `.env.local.example` to `.env.local`.
4. Put your NVIDIA key into `.env.local` and, if you want local file uploads, also add your AWS S3 credentials.
5. If you want to use a local NIM container instead of the hosted endpoint, set `NIM_VISTA3D_INFERENCE_URL` to your container URL, for example `http://localhost:8000/v1/vista3d/inference`.

```bash
NVIDIA_API_KEY=nvapi-your-key-here
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_S3_BUCKET=your-bucket-name
AWS_S3_PUBLIC_URL=https://your-bucket.s3.us-east-1.amazonaws.com
NIM_VISTA3D_INFERENCE_URL=http://localhost:8000/v1/vista3d/inference
```

6. Install dependencies and start the app:

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## How it works

- The app calls `NIM_VISTA3D_INFERENCE_URL` when it is set, otherwise it falls back to NVIDIA's hosted VISTA-3D endpoint.
- Each inference call uses your NVIDIA API key server-side only.
- The trial includes 1000 free credits, and each inference call costs 1 credit.
- Credits and limits are shared across NVIDIA NIM microservices tied to the same account.
- If you upload a local file, the app stores it in S3 and then gives the inference service the public URL to fetch.
- The volume URL must still be publicly reachable unless you are using a local NIM container with mounted local paths.

## Using the console

1. Upload a local NIfTI (`.nii` or `.nii.gz`) or NRRD file, or paste a public URL.
2. Pick `All labels` or choose specific anatomy classes.
3. Run segmentation.
4. The response is streamed back as a single `.nii.gz` file and rendered as an overlay in the browser.

## Alternative: self-hosted container

If you want to avoid trial credits or hosted rate limits, run the NVIDIA container locally and point `NIM_VISTA3D_INFERENCE_URL` at it. See NVIDIA's [Getting Started](https://docs.nvidia.com/nim/medical/vista3d/latest/getting-started.html) guide for the container workflow.

## Notes

- If the key is missing, the app shows an inline reminder to add `NVIDIA_API_KEY=nvapi-...` to `.env.local` and restart the dev server.
- If local uploads fail, confirm the AWS S3 env vars are present in `.env.local`, the bucket is public or fronted by a public URL, and the IAM user can `s3:PutObject` to the bucket.
- The result download is `vista3d-segmentation.nii.gz`.
- The overlay renders entirely in your browser through WebGL; nothing else is uploaded by the viewer.
