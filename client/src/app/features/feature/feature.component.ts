import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject
} from '@angular/core';
import { FeatureApiService } from './feature-api.service';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { JsonPipe } from '@angular/common';
import { merge } from 'rxjs';

type FileInputEvent = Event & { target: EventTarget & { files: FileList } };

@Component({
  selector: 'app-feature',
  imports: [JsonPipe],
  templateUrl: './feature.component.html',
  styleUrl: './feature.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FeatureComponent {
  readonly #featureApi = inject(FeatureApiService);
  readonly #destroyRef = inject(DestroyRef);

  readonly #descriptionResource = rxResource({
    stream: () => this.#featureApi.getFeatureDescription()
  });
  readonly #configResource = rxResource({
    stream: () => this.#featureApi.getConfig()
  });
  readonly #entitiesResource = rxResource({
    stream: () => this.#featureApi.getFeatureEntities()
  });

  protected readonly description = this.#descriptionResource.value;
  protected readonly config = this.#configResource.value;
  protected readonly entities = this.#entitiesResource.value;

  protected readonly isLoading = computed(
    () =>
      this.#descriptionResource.isLoading() ||
      this.#configResource.isLoading() ||
      this.#entitiesResource.isLoading()
  );

  onFilesSelected(event: Event, input: HTMLInputElement) {
    const files = Array.from((event as FileInputEvent).target.files);

    merge(...files.map((file) => this.#featureApi.uploadFile(file)))
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          input.value = '';
        },
        error: (err: unknown) => {
          console.error('File upload failed', err);
          input.value = '';
        }
      });
  }
}
