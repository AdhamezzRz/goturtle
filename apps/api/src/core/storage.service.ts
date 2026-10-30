import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import type { Db } from '../db/client';
import { files } from '../db/schema';
import { InjectDb } from './database.module';
import { config } from '../config';
import { newId } from '../db/columns';
import { DomainError } from '../common/errors';
import { eq } from 'drizzle-orm';

export const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'text/csv': '.csv',
  'application/vnd.ms-excel': '.csv',
};

export const FILE_PURPOSES = ['pod_photo', 'signature', 'courier_document', 'handover_proof', 'logo', 'ticket_attachment', 'attempt_photo', 'avatar'] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

/**
 * File storage. Default driver writes to UPLOAD_DIR (set it OUTSIDE the app
 * folder on Hostinger so redeploys keep the files). Files are served by
 * GET /api/v1/files/:key with unguessable keys. Swap `put`/`get` for an
 * S3-compatible driver (Cloudflare R2, AWS S3, Hostinger Object Storage) by
 * implementing the same two methods.
 */
@Injectable()
export class StorageService {
  private readonly log = new Logger(StorageService.name);
  private readonly root = resolve(config.uploadDir);

  constructor(@InjectDb() private readonly db: Db) {}

  async put(buffer: Buffer, mimeType: string, purpose: FilePurpose, uploadedById: string | null) {
    const ext = ALLOWED_MIME[mimeType];
    if (!ext) throw new DomainError('FILE_TYPE', `File type ${mimeType} is not allowed`, 415);
    if (buffer.length > config.maxUploadMb * 1024 * 1024) throw new DomainError('FILE_TOO_LARGE', `Max ${config.maxUploadMb} MB`, 413);
    assertMagic(buffer, mimeType);

    const month = new Date().toISOString().slice(0, 7);
    const key = `${purpose}/${month}/${newId()}${newId().slice(-8)}${ext}`;
    const full = join(this.root, key);
    await mkdir(join(this.root, purpose, month), { recursive: true });
    await writeFile(full, buffer, { mode: 0o640 });
    const url = `/api/v1/files/${key}`;
    const [row] = await this.db.insert(files).values({ key, url, mimeType, sizeBytes: buffer.length, purpose, uploadedById }).$returningId();
    return { id: row.id, key, url, mimeType, sizeBytes: buffer.length };
  }

  async get(key: string): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!/^[a-z_]+\/\d{4}-\d{2}\/[a-z0-9]+\.[a-z]+$/.test(key)) throw new DomainError('NOT_FOUND', 'File not found', 404);
    const [row] = await this.db.select().from(files).where(eq(files.key, key)).limit(1);
    if (!row) throw new DomainError('NOT_FOUND', 'File not found', 404);
    const full = join(this.root, key);
    if (!full.startsWith(this.root)) throw new DomainError('NOT_FOUND', 'File not found', 404);
    try {
      await stat(full);
    } catch {
      this.log.warn(`file row exists but blob missing: ${key}`);
      throw new DomainError('NOT_FOUND', 'File not found', 404);
    }
    return { buffer: await readFile(full), mimeType: row.mimeType };
  }

  extensionOf(name: string) {
    return extname(name).toLowerCase();
  }
}

/** Rejects files whose content does not match the declared type. */
function assertMagic(buf: Buffer, mime: string) {
  const hex = buf.subarray(0, 12).toString('hex');
  const ok =
    (mime === 'image/jpeg' && hex.startsWith('ffd8ff')) ||
    (mime === 'image/png' && hex.startsWith('89504e47')) ||
    (mime === 'image/webp' && hex.startsWith('52494646') && buf.subarray(8, 12).toString() === 'WEBP') ||
    (mime === 'application/pdf' && hex.startsWith('25504446')) ||
    mime === 'text/csv' ||
    mime === 'application/vnd.ms-excel';
  if (!ok) throw new DomainError('FILE_TYPE', 'File content does not match its type', 415);
}
