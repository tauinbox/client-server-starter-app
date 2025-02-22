import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FeatureApiService } from './feature-api.service';
import { rxResource } from '@angular/core/rxjs-interop';
import { JsonPipe } from '@angular/common';

@Component({
    selector: 'app-feature',
  imports: [
    JsonPipe
  ],
    templateUrl: './feature.component.html',
    styleUrl: './feature.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class FeatureComponent {
  private readonly featureApi = inject(FeatureApiService);

  private readonly descriptionResource = rxResource({loader:  () => this.featureApi.getFeatureDescription()});
  private readonly configResource = rxResource({loader:  () => this.featureApi.getConfig()});
  private readonly entitiesResource = rxResource({loader:  () => this.featureApi.getFeatureEntities()});

  protected description = this.descriptionResource.value;
  protected config = this.configResource.value;
  protected entities = this.entitiesResource.value;

  protected isLoading = computed(() => this.descriptionResource.isLoading() || this.configResource.isLoading() || this.entitiesResource.isLoading());
}
