import {
  BadRequestException,
  UnprocessableEntityException,
  ValidationPipe,
  type ArgumentMetadata
} from '@nestjs/common';

/**
 * The validation of every route. A bad query, path or header value is
 * malformed syntax (400). A body that parsed but fails its DTO is well-formed
 * content that the server cannot process (422, RFC 9110 15.5.21). A body that
 * is not JSON never reaches this pipe: Nest answers it with 400.
 */
export class ApiValidationPipe extends ValidationPipe {
  constructor() {
    super({
      // Transform incoming payloads into DTO instances before validation.
      transform: true,
      // Strip undeclared properties, and refuse a request that sends one.
      whitelist: true,
      forbidNonWhitelisted: true
    });
  }

  override async transform(
    value: unknown,
    metadata: ArgumentMetadata
  ): Promise<unknown> {
    try {
      return (await super.transform(value, metadata)) as unknown;
    } catch (error) {
      if (metadata.type === 'body' && error instanceof BadRequestException) {
        throw new UnprocessableEntityException(error.getResponse(), {
          cause: error
        });
      }
      throw error;
    }
  }
}
