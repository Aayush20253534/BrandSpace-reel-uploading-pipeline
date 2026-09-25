import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { google, type drive_v3 } from "googleapis";

export const GOOGLE_DRIVE_FOLDER_MIME_TYPE =
  "application/vnd.google-apps.folder";

export interface MediaObject {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  checksum?: string;
  revisionId?: string;
  parentIds?: string[];
  createdAt?: Date;
  modifiedAt?: Date;
}

export interface UploadMediaInput {
  parentId: string;
  name: string;
  mimeType: string;
  sourcePath: string;
}

export interface MediaStorage {
  getMetadata(id: string): Promise<MediaObject>;
  listChildren(folderId: string): Promise<MediaObject[]>;
  downloadToFile(id: string, destination: string): Promise<void>;
  uploadFromFile(input: UploadMediaInput): Promise<MediaObject>;
}

export type GoogleDriveMode = "my-drive" | "shared-drive";

export interface GoogleDriveMediaStorageOptions {
  mode: GoogleDriveMode;
  driveId?: string;
  rootFolderId: string;
  serviceAccountEmail: string;
  privateKey: string;
  drive?: drive_v3.Drive;
}

const FILE_FIELDS =
  "id,name,mimeType,size,md5Checksum,version,parents,createdTime,modifiedTime";

const required = (value: string | null | undefined, field: string) => {
  if (!value) throw new Error(`Google Drive response is missing ${field}`);
  return value;
};

const toMediaObject = (file: drive_v3.Schema$File): MediaObject => {
  const sizeBytes =
    file.size === null || file.size === undefined
      ? undefined
      : Number(file.size);

  if (sizeBytes !== undefined && !Number.isSafeInteger(sizeBytes)) {
    throw new Error(`Drive file ${file.id ?? "unknown"} has an unsafe size`);
  }

  return {
    id: required(file.id, "id"),
    name: required(file.name, "name"),
    mimeType: required(file.mimeType, "mimeType"),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    ...(file.md5Checksum ? { checksum: file.md5Checksum } : {}),
    ...(file.version !== null && file.version !== undefined
      ? { revisionId: file.version.toString() }
      : {}),
    ...(file.parents?.length ? { parentIds: file.parents } : {}),
    ...(file.createdTime ? { createdAt: new Date(file.createdTime) } : {}),
    ...(file.modifiedTime ? { modifiedAt: new Date(file.modifiedTime) } : {}),
  };
};

const escapeQueryValue = (value: string) =>
  value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");

export const normalizeGooglePrivateKey = (value: string) =>
  value.replaceAll("\\n", "\n");

export class GoogleDriveMediaStorage implements MediaStorage {
  private readonly drive: drive_v3.Drive;
  private readonly mode: GoogleDriveMode;
  private readonly driveId: string | undefined;
  readonly rootFolderId: string;

  constructor(options: GoogleDriveMediaStorageOptions) {
    if (options.mode === "shared-drive" && !options.driveId) {
      throw new Error("GOOGLE_DRIVE_ID is required in shared-drive mode");
    }

    this.mode = options.mode;
    this.driveId = options.driveId;
    this.rootFolderId = options.rootFolderId;

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: options.serviceAccountEmail,
        private_key: normalizeGooglePrivateKey(options.privateKey),
      },
      scopes: ["https://www.googleapis.com/auth/drive"],
    });

    this.drive = options.drive ?? google.drive({ version: "v3", auth });
  }

  async verifyConnection() {
    if (this.mode === "shared-drive") {
      await this.drive.drives.get({
        driveId: required(this.driveId, "driveId"),
        fields: "id,name",
      });
    }

    const root = await this.getMetadata(this.rootFolderId);
    if (root.mimeType !== GOOGLE_DRIVE_FOLDER_MIME_TYPE) {
      throw new Error("GOOGLE_DRIVE_ROOT_FOLDER_ID must reference a folder");
    }
  }

  async getMetadata(id: string): Promise<MediaObject> {
    const response = await this.drive.files.get({
      fileId: id,
      supportsAllDrives: true,
      fields: FILE_FIELDS,
    });
    return toMediaObject(response.data);
  }

  async listChildren(folderId: string): Promise<MediaObject[]> {
    const files: MediaObject[] = [];
    let pageToken: string | undefined;

    do {
      const params: drive_v3.Params$Resource$Files$List = {
        q: `'${escapeQueryValue(folderId)}' in parents and trashed = false`,
        spaces: "drive",
        corpora: this.mode === "shared-drive" ? "drive" : "user",
        supportsAllDrives: true,
        includeItemsFromAllDrives: this.mode === "shared-drive",
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        pageSize: 1000,
        ...(this.mode === "shared-drive"
          ? { driveId: required(this.driveId, "driveId") }
          : {}),
        ...(pageToken ? { pageToken } : {}),
      };

      const response = await this.drive.files.list(params);
      files.push(...(response.data.files ?? []).map(toMediaObject));
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return files;
  }

  async downloadToFile(id: string, destination: string): Promise<void> {
    await mkdir(dirname(destination), { recursive: true });
    const response = await this.drive.files.get(
      { fileId: id, alt: "media", supportsAllDrives: true },
      { responseType: "stream" },
    );
    await pipeline(
      response.data as unknown as Readable,
      createWriteStream(destination, { flags: "wx" }),
    );
  }

  async uploadFromFile(input: UploadMediaInput): Promise<MediaObject> {
    const response = await this.drive.files.create({
      supportsAllDrives: true,
      fields: FILE_FIELDS,
      requestBody: { name: input.name, parents: [input.parentId] },
      media: {
        mimeType: input.mimeType,
        body: createReadStream(input.sourcePath),
      },
    });
    return toMediaObject(response.data);
  }

  async getStartPageToken(): Promise<string> {
    const params: drive_v3.Params$Resource$Changes$Getstartpagetoken = {
      supportsAllDrives: true,
      ...(this.mode === "shared-drive"
        ? { driveId: required(this.driveId, "driveId") }
        : {}),
    };
    const response = await this.drive.changes.getStartPageToken(params);
    return required(response.data.startPageToken, "startPageToken");
  }
}
