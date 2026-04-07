import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import type { Request } from 'express';

export const UPLOAD_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export const UPLOAD_ALLOWED_IMAGES = /\.(jpg|jpeg|png|gif|webp)$/i;
export const UPLOAD_ALLOWED_DOCUMENTS =
  /\.(jpg|jpeg|png|gif|pdf|doc|docx|txt)$/i;

/**
 * Allowed MIME types per file extension. Used alongside the extension regex
 * so a renamed file (e.g. `evil.exe` → `evil.jpg`) is rejected because its
 * real MIME type does not match what the extension claims.
 */
export const UPLOAD_ALLOWED_MIME_TYPES: Record<string, readonly string[]> = {
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  gif: ['image/gif'],
  webp: ['image/webp'],
  pdf: ['application/pdf'],
  doc: ['application/msword'],
  docx: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ],
  txt: ['text/plain']
};

/**
 * Creates multer disk-storage options for a given upload destination.
 *
 * Usage in a controller:
 *   @UseInterceptors(FileInterceptor('file', createDiskStorageOptions({ destination: './public/uploads/avatars' })))
 *
 * @param destination  Folder where files are stored (relative to cwd or absolute).
 * @param allowedExtensions  Regex tested against the original filename (default: images + common docs).
 * @param maxFileSizeBytes   Maximum file size in bytes (default: 5 MB).
 */
export function createDiskStorageOptions(options: {
  destination: string;
  allowedExtensions?: RegExp;
  maxFileSizeBytes?: number;
}): MulterOptions {
  const {
    destination,
    allowedExtensions = UPLOAD_ALLOWED_DOCUMENTS,
    maxFileSizeBytes = UPLOAD_MAX_FILE_SIZE
  } = options;

  return {
    storage: diskStorage({
      destination,
      filename(
        _req: Request,
        file: Express.Multer.File,
        callback: (error: Error | null, filename: string) => void
      ) {
        const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        callback(
          null,
          `${Date.now()}-${Math.round(Math.random() * 1e9)}-${sanitized}`
        );
      }
    }),
    limits: { fileSize: maxFileSizeBytes },
    fileFilter(
      _req: Request,
      file: Express.Multer.File,
      callback: (error: Error | null, acceptFile: boolean) => void
    ) {
      if (!allowedExtensions.test(file.originalname)) {
        return callback(
          new BadRequestException('File type not allowed'),
          false
        );
      }
      const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
      const expectedMimeTypes = UPLOAD_ALLOWED_MIME_TYPES[ext];
      if (!expectedMimeTypes || !expectedMimeTypes.includes(file.mimetype)) {
        return callback(
          new BadRequestException('File MIME type does not match extension'),
          false
        );
      }
      callback(null, true);
    }
  };
}
