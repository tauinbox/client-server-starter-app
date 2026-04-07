import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { createDiskStorageOptions } from './multer.config';

type FileFilterFn = NonNullable<
  ReturnType<typeof createDiskStorageOptions>['fileFilter']
>;

function runFileFilter(
  filter: FileFilterFn,
  file: Partial<Express.Multer.File>
): { error: Error | null; accepted: boolean } {
  let result: { error: Error | null; accepted: boolean } = {
    error: null,
    accepted: false
  };
  filter({} as Request, file as Express.Multer.File, (error, accepted) => {
    result = { error, accepted: Boolean(accepted) };
  });
  return result;
}

describe('createDiskStorageOptions fileFilter', () => {
  const options = createDiskStorageOptions({ destination: './tmp' });
  const filter: FileFilterFn = (req, file, cb) =>
    (options.fileFilter as FileFilterFn)(req, file, cb);

  it('accepts a file with matching extension and MIME type', () => {
    const { error, accepted } = runFileFilter(filter, {
      originalname: 'photo.jpg',
      mimetype: 'image/jpeg'
    });
    expect(error).toBeNull();
    expect(accepted).toBe(true);
  });

  it('rejects a file with disallowed extension', () => {
    const { error, accepted } = runFileFilter(filter, {
      originalname: 'evil.exe',
      mimetype: 'application/octet-stream'
    });
    expect(error).toBeInstanceOf(BadRequestException);
    expect(accepted).toBe(false);
  });

  it('rejects a renamed file where MIME type does not match extension', () => {
    // Attacker renames evil.exe -> evil.jpg but MIME type is still exe
    const { error, accepted } = runFileFilter(filter, {
      originalname: 'evil.jpg',
      mimetype: 'application/x-msdownload'
    });
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toContain('MIME');
    expect(accepted).toBe(false);
  });
});
