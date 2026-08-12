import type { OnDestroy } from '@angular/core';
import {
  Directive,
  effect,
  ElementRef,
  inject,
  input,
  output
} from '@angular/core';

/**
 * The project standard for every list page: put this on a sentinel element
 * placed after the rows, and it emits `loadMore` whenever the sentinel becomes
 * visible while another page exists.
 *
 * It re-checks after each load rather than waiting for the next scroll event —
 * a short first page (or a tall viewport) can leave the sentinel on screen with
 * nothing to trigger a second `IntersectionObserver` callback, which would
 * strand the list mid-way with no way to continue except resizing the window.
 */
@Directive({
  selector: '[nxsInfiniteScroll]'
})
export class InfiniteScrollDirective implements OnDestroy {
  readonly #host = inject(ElementRef<HTMLElement>);

  /** Whether the server reported another page after the current one. */
  readonly hasMore = input.required<boolean>();
  /** Any load in flight — first page or subsequent, both block a new request. */
  readonly busy = input.required<boolean>();

  readonly loadMore = output<void>();

  #observer: IntersectionObserver | null = null;

  constructor() {
    const element = this.#host.nativeElement as HTMLElement;

    this.#observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) this.#emitIfReady();
      },
      { threshold: 0 }
    );
    this.#observer.observe(element);

    // Re-arm once a load settles: reading both signals registers the effect on
    // them, so finishing a page immediately reconsiders a still-visible
    // sentinel instead of waiting for a scroll that may never come.
    effect(() => {
      this.hasMore();
      this.busy();
      this.#emitIfReady();
    });
  }

  ngOnDestroy(): void {
    this.#observer?.disconnect();
    this.#observer = null;
  }

  #emitIfReady(): void {
    if (!this.hasMore() || this.busy()) return;
    const element = this.#host.nativeElement as HTMLElement;
    // getBoundingClientRect is the source of truth here: the observer callback
    // reports the state at its last sampling, which is stale right after rows
    // were appended.
    if (element.getBoundingClientRect().top <= window.innerHeight) {
      this.loadMore.emit();
    }
  }
}
