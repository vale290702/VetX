import { createHash } from "node:crypto";
import type { ClinicalImagingArchive } from "../imaging/orthanc.js";
import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  type DynamicModule,
  Get,
  Header,
  Inject,
  Injectable,
  Module,
  Param,
  PayloadTooLargeException,
  ParseIntPipe,
  ParseUUIDPipe,
  Put,
  Query,
  ServiceUnavailableException,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor, MulterModule } from "@nestjs/platform-express";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { DocumentConfig } from "@vetx/config";
import type { MedicalDocument, PrismaDatabase } from "@vetx/database";
import { isUUID } from "class-validator";
import type { Request } from "express";
import type { AccessPrincipal, OwnerPrincipal, StaffPrincipal } from "@vetx/permissions";
import { BearerAuthGuard, OwnerIdentity, StaffIdentity } from "../identity-context.js";
import { ApiErrorDto } from "../http.js";
import { documentKey, inspectDocument, InvalidDocument } from "./content.js";
import type { DocumentStorage } from "./storage.js";
import {
  DocumentSharingDto,
  DocumentTitleDto,
  OwnerDocumentsDto,
  StaffDocumentDto,
  StaffDocumentsDto,
} from "./contracts.js";
export type DocumentStore = Pick<
  PrismaDatabase,
  | "getPatient"
  | "preflightDocument"
  | "reserveDocument"
  | "finishDocument"
  | "finishDicomDocument"
  | "shareDocument"
  | "listDocuments"
  | "getDocument"
  | "getOwnerDocument"
  | "listOwnerDocuments"
>;
export interface DocumentDependencies {
  database?: DocumentStore;
  imaging?: ClinicalImagingArchive;
  storage?: DocumentStorage;
  config?: DocumentConfig;
}
const depsKey = Symbol("document dependencies");
interface FileUpload {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}
@Injectable()
class Documents {
  constructor(@Inject(depsKey) private readonly deps: DocumentDependencies) {}
  onApplicationShutdown() {
    this.deps.storage?.close?.();
  }
  get db() {
    if (!this.deps.database) throw new ServiceUnavailableException();
    return this.deps.database;
  }
  assertUploadEnabled() {
    if (!this.deps.config || !this.deps.storage) throw new ServiceUnavailableException();
  }
  get storage() {
    if (!this.deps.storage) throw new ServiceUnavailableException();
    return this.deps.storage;
  }
  async attach(
    actor: StaffPrincipal,
    org: string,
    clinic: string,
    patient: string,
    id: string,
    title: string,
    file: FileUpload | undefined,
  ) {
    const { config } = this.deps;
    if (!config) throw new ServiceUnavailableException();
    if (!file) throw new BadRequestException();
    if (file.buffer.length > config.maxBytes) throw new PayloadTooLargeException();
    let integrity;
    try {
      const type =
        file.mimetype === "application/octet-stream" && /[.]dcm$/i.test(file.originalname)
          ? "application/dicom"
          : file.mimetype;
      integrity = inspectDocument(file.buffer, type, config.maxBytes);
    } catch (error) {
      if (error instanceof InvalidDocument) throw new BadRequestException();
      throw error;
    }
    const input = { title: title.trim(), ...integrity };
    let scan: Awaited<ReturnType<ClinicalImagingArchive["ingest"]>> | undefined;
    if (integrity.mediaType === "application/dicom") {
      const existing = await this.db.preflightDocument(actor, org, clinic, patient, id, input);
      if (existing?.ready) return existing;
      if (!this.deps.imaging) throw new ServiceUnavailableException();
      scan = await this.deps.imaging.ingest(file.buffer, integrity.sha256);
    }
    // Recheck the write grant and matching request after any archive work.
    const doc = await this.db.reserveDocument(actor, org, clinic, patient, id, input);
    if (doc.ready) return doc;
    const key = documentKey(org, clinic, patient, id, doc.sha256);
    await this.storage.put(key, file.buffer, integrity);
    if (scan) {
      const { metadata, preview } = scan;
      if (preview) {
        const checksum = {
          sha256: createHash("sha256").update(preview).digest("hex"),
          byteLength: preview.length,
        };
        await this.storage.put(documentKey(org, clinic, patient, id, checksum.sha256), preview, {
          ...checksum,
          mediaType: "image/png",
        });
        return this.db.finishDicomDocument(actor, org, clinic, patient, id, doc.sha256, {
          ...metadata,
          preview: checksum,
        });
      }
      return this.db.finishDicomDocument(actor, org, clinic, patient, id, doc.sha256, metadata);
    }
    return this.db.finishDocument(actor, org, clinic, patient, id, doc.sha256);
  }
  async preview(authorize: () => Promise<MedicalDocument>) {
    const doc = await authorize();
    const info = doc.imaging?.preview;
    if (!info) throw new NotFoundException();
    const bytes = await this.storage.read(
      documentKey(doc.organizationId, doc.clinicId, doc.patientId, doc.id, info.sha256),
      { ...info, mediaType: "image/png" },
    );
    await authorize();
    return new StreamableFile(bytes, {
      type: "image/png",
      length: bytes.length,
      disposition: "inline",
    });
  }
  async download(authorize: () => Promise<MedicalDocument>) {
    const doc = await authorize();
    const { organizationId, clinicId, patientId, id, sha256 } = doc;
    const bytes = await this.storage.read(
      documentKey(organizationId, clinicId, patientId, id, sha256),
      doc,
    );
    // A release can be withdrawn while the file is being read and verified.
    await authorize();
    const ext = {
      "application/dicom": "dcm",
      "application/pdf": "pdf",
      "image/png": "png",
      "image/jpeg": "jpg",
    }[doc.mediaType];
    const name = encodeURIComponent(doc.title + "." + ext).replace(
      /[!'()*]/g,
      (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
    );
    return new StreamableFile(bytes, {
      type: "application/octet-stream",
      length: bytes.length,
      disposition: `attachment; filename="document-${id}.${ext}"; filename*=UTF-8''${name}`,
    });
  }
}
@Injectable()
class UploadAccessGuard implements CanActivate {
  constructor(@Inject(Documents) private readonly docs: Documents) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { vetxPrincipal?: AccessPrincipal }>();
    const actor = request.vetxPrincipal;
    if (!actor || actor.kind !== "staff") throw new ForbiddenException();
    const { organizationId, clinicId, patientId, documentId } = request.params;
    if (
      typeof organizationId !== "string" ||
      typeof clinicId !== "string" ||
      typeof patientId !== "string" ||
      typeof documentId !== "string" ||
      ![organizationId, clinicId, patientId, documentId].every((id) => isUUID(id))
    )
      throw new BadRequestException();
    await this.docs.db.getPatient({ ...actor, kind: "staff" }, organizationId, clinicId, patientId);
    this.docs.assertUploadEnabled();
    return true;
  }
}
const idParam = (name: string) => ApiParam({ name, format: "uuid" });
const secured = () =>
  applyDecorators(
    ApiTags("medical documents"),
    ApiBearerAuth(),
    UseGuards(BearerAuthGuard),
    ApiUnauthorizedResponse({ type: ApiErrorDto }),
    ApiForbiddenResponse({ type: ApiErrorDto }),
    ApiNotFoundResponse({ type: ApiErrorDto }),
    ApiBadRequestResponse({ type: ApiErrorDto }),
    ApiServiceUnavailableResponse({ type: ApiErrorDto }),
  );
const pages = () =>
  ApiQuery({ name: "page", required: false, schema: { type: "integer", minimum: 1, default: 1 } });
const pagePipe = new DefaultValuePipe(1);
function pageNumber(page: number) {
  if (page < 1 || page > 2147483647) throw new BadRequestException();
  return page;
}
const binary = () =>
  applyDecorators(
    Header("X-Content-Type-Options", "nosniff"),
    Header("Content-Security-Policy", "sandbox; default-src 'none'"),
    ApiProduces("application/octet-stream"),
    ApiOkResponse({ schema: { type: "string", format: "binary" } }),
  );
@secured()
@idParam("organizationId")
@idParam("clinicId")
@idParam("patientId")
@Controller("organizations/:organizationId/clinics/:clinicId/patients/:patientId/documents")
class StaffDocuments {
  constructor(@Inject(Documents) private readonly docs: Documents) {}
  @Get()
  @pages()
  @ApiOperation({ operationId: "listPatientDocuments" })
  @ApiOkResponse({ type: StaffDocumentsDto })
  list(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patient: string,
    @Query("page", pagePipe, ParseIntPipe) page: number,
  ) {
    return this.docs.db.listDocuments(actor, org, clinic, patient, pageNumber(page));
  }
  @Put(":documentId")
  @idParam("documentId")
  @ApiOperation({ operationId: "uploadPatientDocument" })
  @ApiOkResponse({ type: StaffDocumentDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["title", "file"],
      properties: {
        title: { type: "string", maxLength: 180 },
        file: { type: "string", format: "binary" },
      },
    },
  })
  @ApiPayloadTooLargeResponse({ type: ApiErrorDto })
  @UseGuards(UploadAccessGuard)
  @UseInterceptors(FileInterceptor("file"))
  upload(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patient: string,
    @Param("documentId", ParseUUIDPipe) id: string,
    @Body() input: DocumentTitleDto,
    @UploadedFile() file?: FileUpload,
  ) {
    return this.docs.attach(actor, org, clinic, patient, id, input.title, file);
  }
  @Put(":documentId/sharing")
  @idParam("documentId")
  @ApiOperation({ operationId: "sharePatientDocument" })
  @ApiOkResponse({ type: DocumentSharingDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  share(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patient: string,
    @Param("documentId", ParseUUIDPipe) id: string,
    @Body() input: DocumentSharingDto,
  ) {
    return this.docs.db.shareDocument(actor, org, clinic, patient, id, input);
  }
  @Get(":documentId/preview")
  @idParam("documentId")
  @Header("X-Content-Type-Options", "nosniff")
  @ApiOperation({ operationId: "previewStaffDicom" })
  @ApiOkResponse({ content: { "image/png": { schema: { type: "string", format: "binary" } } } })
  preview(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patient: string,
    @Param("documentId", ParseUUIDPipe) id: string,
  ) {
    return this.docs.preview(() => this.docs.db.getDocument(actor, org, clinic, patient, id));
  }
  @Get(":documentId/content")
  @idParam("documentId")
  @binary()
  @ApiOperation({ operationId: "downloadPatientDocument" })
  async read(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patient: string,
    @Param("documentId", ParseUUIDPipe) id: string,
  ) {
    return this.docs.download(() => this.docs.db.getDocument(actor, org, clinic, patient, id));
  }
}
@secured()
@idParam("petId")
@Controller("owner/pets/:petId/documents")
class OwnerDocuments {
  constructor(@Inject(Documents) private readonly docs: Documents) {}
  @Get()
  @pages()
  @ApiOperation({ operationId: "listOwnerDocuments" })
  @ApiOkResponse({ type: OwnerDocumentsDto })
  list(
    @OwnerIdentity() actor: OwnerPrincipal,
    @Param("petId", ParseUUIDPipe) pet: string,
    @Query("page", pagePipe, ParseIntPipe) page: number,
  ) {
    return this.docs.db.listOwnerDocuments(actor, pet, pageNumber(page));
  }
  @Get(":assetId/preview")
  @idParam("assetId")
  @Header("X-Content-Type-Options", "nosniff")
  @ApiOperation({ operationId: "previewOwnerDicom" })
  @ApiOkResponse({ content: { "image/png": { schema: { type: "string", format: "binary" } } } })
  preview(
    @OwnerIdentity() actor: OwnerPrincipal,
    @Param("petId", ParseUUIDPipe) pet: string,
    @Param("assetId", ParseUUIDPipe) id: string,
  ) {
    return this.docs.preview(() => this.docs.db.getOwnerDocument(actor, pet, id));
  }
  @Get(":assetId/content")
  @idParam("assetId")
  @binary()
  @ApiOperation({ operationId: "downloadOwnerDocument" })
  async read(
    @OwnerIdentity() actor: OwnerPrincipal,
    @Param("petId", ParseUUIDPipe) pet: string,
    @Param("assetId", ParseUUIDPipe) asset: string,
  ) {
    return this.docs.download(() => this.docs.db.getOwnerDocument(actor, pet, asset));
  }
}
@Module({
  controllers: [StaffDocuments, OwnerDocuments],
  providers: [Documents, UploadAccessGuard],
})
export class DocumentModule {
  static register(deps: DocumentDependencies = {}): DynamicModule {
    return {
      module: DocumentModule,
      providers: [{ provide: depsKey, useValue: deps }],
      imports: [
        MulterModule.register({
          limits: {
            fileSize: (deps.config?.maxBytes ?? 0) + 1,
            files: 1,
            fields: 1,
            parts: 3,
            fieldSize: 1024,
          },
        }),
      ],
    };
  }
}
