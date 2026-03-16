import { Reflector } from '@nestjs/core';
import {
  RegisterResource,
  RESOURCE_METADATA_KEY,
  ResourceMetadata
} from './register-resource.decorator';

@RegisterResource({ name: 'users', subject: 'User', displayName: 'Users' })
class DecoratedController {}

class UndecoratedController {}

describe('RegisterResource decorator', () => {
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
  });

  it('should set metadata on decorated class', () => {
    const meta = reflector.get<ResourceMetadata>(
      RESOURCE_METADATA_KEY,
      DecoratedController
    );

    expect(meta).toEqual({
      name: 'users',
      subject: 'User',
      displayName: 'Users'
    });
  });

  it('should return undefined for undecorated class', () => {
    const meta = reflector.get<ResourceMetadata>(
      RESOURCE_METADATA_KEY,
      UndecoratedController
    );

    expect(meta).toBeUndefined();
  });

  it('should use RESOURCE_METADATA_KEY as metadata key', () => {
    expect(RESOURCE_METADATA_KEY).toBe('resource_metadata');
  });

  it('should preserve all metadata fields', () => {
    @RegisterResource({
      name: 'permissions',
      subject: 'Permission',
      displayName: 'Permissions'
    })
    class AnotherController {}

    const meta = reflector.get<ResourceMetadata>(
      RESOURCE_METADATA_KEY,
      AnotherController
    );

    expect(meta.name).toBe('permissions');
    expect(meta.subject).toBe('Permission');
    expect(meta.displayName).toBe('Permissions');
  });
});
