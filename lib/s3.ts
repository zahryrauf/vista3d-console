import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export function getS3Config() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  const region = process.env.AWS_REGION?.trim() || "us-east-1";
  const bucket = process.env.AWS_S3_BUCKET?.trim();

  const isConfigured = Boolean(
    accessKeyId &&
    secretAccessKey &&
    bucket &&
    !accessKeyId.includes("...") &&
    !secretAccessKey.includes("...") &&
    !bucket.includes("...")
  );

  return { accessKeyId, secretAccessKey, region, bucket, isConfigured };
}

let s3ClientInstance: S3Client | null = null;

export function getS3Client(): S3Client {
  if (s3ClientInstance) return s3ClientInstance;

  const { accessKeyId, secretAccessKey, region } = getS3Config();
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS credentials are not properly configured.");
  }

  s3ClientInstance = new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return s3ClientInstance;
}

export interface UploadResult {
  url: string;
  key: string;
  bucket: string;
}

/**
 * Uploads a file buffer to S3 and returns a clean URL acceptable by NVIDIA NIM
 * (NVIDIA requires the URL string to end directly in .nii, .nii.gz, or .nrrd without query parameters)
 */
export async function uploadToS3(
  buffer: Buffer | Uint8Array,
  filename: string,
  contentType: string = "application/gzip"
): Promise<UploadResult> {
  const { bucket, region, isConfigured } = getS3Config();
  if (!isConfigured || !bucket) {
    throw new Error(
      "AWS S3 is not configured. Please add AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, and AWS_S3_BUCKET to your .env.local file."
    );
  }

  const client = getS3Client();
  const key = `vista3d-volumes/${Date.now()}-${filename}`;

  // Attempt upload with public-read, fallback without ACL if bucket owner enforced
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ACL: "public-read",
      })
    );
  } catch (aclError) {
    // If ACLs are disabled on the bucket, upload without ACL
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );
  }

  // Generate clean S3 URL ending in the proper file extension
  let url = `https://${bucket}.s3.amazonaws.com/${key}`;
  if (region && region !== "us-east-1") {
    url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  return { url, key, bucket };
}
