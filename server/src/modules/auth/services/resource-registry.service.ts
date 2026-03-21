import { Injectable } from '@nestjs/common';

/**
 * In-memory registry of resource names currently discovered via @RegisterResource.
 * Populated by ResourceSyncService on startup; read by ResourceService to expose
 * `isRegistered` on ResourceResponse and to guard the restore endpoint.
 */
@Injectable()
export class ResourceRegistryService {
  private readonly registeredNames = new Set<string>();

  register(names: string[]): void {
    this.registeredNames.clear();
    names.forEach((n) => this.registeredNames.add(n));
  }

  isRegistered(name: string): boolean {
    return this.registeredNames.has(name);
  }
}
