import { inject, Injectable } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { readStorageValue, writeStorageValue } from './web-storage';
import type { StorageValueGuard } from './web-storage';

@Injectable({
  providedIn: 'root'
})
export class LocalStorageService {
  readonly #storage = inject(DOCUMENT).defaultView?.localStorage ?? null;

  getItem<T>(key: string, isValid?: StorageValueGuard<T>): T | null {
    return readStorageValue(this.#storage, key, isValid);
  }

  setItem<T>(key: string, value: T): void {
    writeStorageValue(this.#storage, key, value);
  }

  removeItem(key: string): void {
    this.#storage?.removeItem(key);
  }
}
