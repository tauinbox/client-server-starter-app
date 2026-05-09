import type { ElementRef, OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  output,
  signal,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslocoDirective } from '@jsverse/transloco';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { from, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { CaptchaService } from '@features/auth/services/captcha.service';

@Component({
  selector: 'app-captcha-widget',
  imports: [MatProgressSpinner, TranslocoDirective],
  templateUrl: './captcha-widget.component.html',
  styleUrl: './captcha-widget.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CaptchaWidgetComponent implements OnInit {
  readonly #captchaService = inject(CaptchaService);
  readonly #destroyRef = inject(DestroyRef);

  readonly tokenChange = output<string | null>();

  protected readonly status = signal<
    'loading' | 'ready' | 'unavailable' | 'error'
  >('loading');

  protected readonly container =
    viewChild.required<ElementRef<HTMLDivElement>>('container');
  private widgetId: string | null = null;

  ngOnInit(): void {
    from(this.#captchaService.loadConfig())
      .pipe(
        switchMap((cfg) => {
          if (!cfg.enabled || !cfg.siteKey) {
            this.status.set('unavailable');
            return of(null);
          }
          return from(this.#captchaService.loadScript()).pipe(
            switchMap((api) => {
              this.widgetId = api.render(this.container().nativeElement, {
                sitekey: cfg.siteKey as string,
                callback: (token) => this.tokenChange.emit(token),
                'error-callback': () => {
                  this.status.set('error');
                  this.tokenChange.emit(null);
                },
                'expired-callback': () => this.tokenChange.emit(null),
                'timeout-callback': () => this.tokenChange.emit(null)
              });
              this.status.set('ready');
              return of(api);
            })
          );
        }),
        catchError(() => {
          this.status.set('error');
          return of(null);
        }),
        takeUntilDestroyed(this.#destroyRef)
      )
      .subscribe();
  }
}
