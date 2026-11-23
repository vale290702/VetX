# Medical documents

Staff can attach a PDF, JPEG, PNG or DICOM Part 10 image to a patient record. Each file starts private. Staff select individual linked guardians to grant access and can withdraw that access. Removing a guardian also ends access. Each new download checks the current permission. A copy already saved on a device remains with its recipient.

The API checks file size, media type and file signatures before upload. Private S3 storage uses a server-generated object key and an immutable write. The API checks the stored length and SHA-256 digest before delivering an attachment. A database reservation keeps the file hidden until storage confirms the upload. Retrying the same file under the same identifier resumes an interrupted upload. These checks do not perform a malware scan.

DICOM uploads also pass through the configured Orthanc archive. The original and its first-frame PNG preview share the same patient and guardian access checks. View other frames in a DICOM viewer using the original file. For configuration and the local integration test, see the [imaging setup](../README.md#local-setup).

## Local setup

Run the following commands after installing dependencies and starting PostgreSQL. The local setup command creates the bucket on the configured loopback service and enables its public access block.

```sh
node scripts/init-local-env.mjs
pnpm compose up -d --wait storage
pnpm db:migrate
pnpm --filter @vetx/api storage:init
pnpm --filter @vetx/api test:storage
```

For a deployment, provision a private S3-compatible bucket and restrict its runtime identity to object access within the clinical prefix. Configure the HTTPS endpoint, region, bucket and maximum upload size with `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` and `DOCUMENT_MAX_BYTES`. The in-memory implementation accepts a deployment limit up to 32 MiB. An IAM workload identity can supply credentials through the AWS SDK chain. Static credentials can be supplied through the secret manager as `S3_ACCESS_KEY` and `S3_SECRET_KEY`. Keep object storage off the public application route and enable encryption at rest, backups and retention on the chosen provider.
