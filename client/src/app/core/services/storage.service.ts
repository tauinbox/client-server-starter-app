import { inject, Injectable } from '@angular/core';
import { DOCUMENT } from '@angular/common';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  readonly #storage = inject(DOCUMENT).defaultView?.localStorage ?? null;

  getItem(key: string): string | null {
    return this.#storage?.getItem(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#storage?.setItem(key, value);
  }

  removeItem(key: string): void {
    this.#storage?.removeItem(key);
  }
}
