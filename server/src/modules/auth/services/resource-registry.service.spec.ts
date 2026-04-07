import { ResourceRegistryService } from './resource-registry.service';

describe('ResourceRegistryService', () => {
  let service: ResourceRegistryService;

  beforeEach(() => {
    service = new ResourceRegistryService();
  });

  it('returns false for unknown names before register() is called', () => {
    expect(service.isRegistered('User')).toBe(false);
  });

  it('registers names and reports them as registered', () => {
    service.register(['User', 'Role']);
    expect(service.isRegistered('User')).toBe(true);
    expect(service.isRegistered('Role')).toBe(true);
    expect(service.isRegistered('Unknown')).toBe(false);
  });

  it('clears previously registered names on re-register', () => {
    service.register(['User']);
    service.register(['Role']);
    expect(service.isRegistered('User')).toBe(false);
    expect(service.isRegistered('Role')).toBe(true);
  });

  it('handles empty list', () => {
    service.register(['User']);
    service.register([]);
    expect(service.isRegistered('User')).toBe(false);
  });
});
