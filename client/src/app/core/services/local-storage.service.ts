import { inject, Injectable } from '@angular/core';
import { DOCUMENT } from '@angular/common';

@Injectable({
  providedIn: 'root'
})
export class LocalStorageService {
  readonly #storage = inject(DOCUMENT).defaultView?.localStorage ?? null;

  getItem<T>(key: string): T | null {
    const item = this.#storage?.getItem(key) ?? null;

    if (!item) {
      return null;
    }

    try {
      return JSON.parse(item);
    } catch {
      return item as T;
    }
  }

  setItem<T>(key: string, value: T): void {
    this.#storage?.setItem(key, JSON.stringify(value));
  }

  removeItem(key: string): void {
    this.#storage?.removeItem(key);
  }
}
