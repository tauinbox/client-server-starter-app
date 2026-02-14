import { inject, Injectable } from '@angular/core';
import { DOCUMENT } from '@angular/common';

@Injectable({
  providedIn: 'root'
})
export class LocalStorageService {
  readonly #storage = inject(DOCUMENT).defaultView?.localStorage ?? null;

  getItem<T>(key: string): T | null {
    const raw = this.#storage?.getItem(key) ?? null;

    if (raw === null) {
      return null;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as T;
    }
  }

  setItem<T>(key: string, value: T): void {
    const serialized =
      typeof value === 'string' ? value : JSON.stringify(value);
    this.#storage?.setItem(key, serialized);
  }

  removeItem(key: string): void {
    this.#storage?.removeItem(key);
  }
}
