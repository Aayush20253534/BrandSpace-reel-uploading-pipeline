/**
 * Provider-neutral media contract.
 *
 * Phase 1 intentionally defines the boundary without authenticating to Drive.
 * Phase 4 implements GoogleDriveMediaStorage behind this interface.
 */
export interface MediaObject {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  checksum?: string;
  modifiedAt?: Date;
}

export interface MediaStorage {
  getMetadata(id: string): Promise<MediaObject>;
  listChildren(folderId: string): Promise<MediaObject[]>;
  downloadToFile(id: string, destination: string): Promise<void>;
}
