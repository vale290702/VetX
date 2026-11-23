import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutPublicAccessBlockCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { loadDocumentConfig } from "@vetx/config";
const config = loadDocumentConfig();
if (!config || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(config.endpoint).hostname)) {
  throw new Error("Use a configured loopback object store for local bucket setup");
}
const client = new S3Client({
  endpoint: config.endpoint,
  region: config.region,
  credentials: config.credentials,
  forcePathStyle: true,
});
try {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
  } catch (error) {
    if (error.$metadata?.httpStatusCode !== 404) throw error;
    await client.send(
      new CreateBucketCommand({
        Bucket: config.bucket,
        ...(config.region === "us-east-1"
          ? {}
          : { CreateBucketConfiguration: { LocationConstraint: config.region } }),
      }),
    );
  }
  await client.send(
    new PutPublicAccessBlockCommand({
      Bucket: config.bucket,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    }),
  );
  process.stdout.write("Local document bucket is ready.\n");
} finally {
  client.destroy();
}
