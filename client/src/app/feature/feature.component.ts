import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FeatureApiService } from './feature-api.service';
import { rxResource } from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-feature',
  imports: [],
    templateUrl: './feature.component.html',
    styleUrl: './feature.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class FeatureComponent {
  private readonly featureApi = inject(FeatureApiService);

  private readonly featureResource = rxResource({loader:  () => this.featureApi.getFeatureEntities()});

  protected entities = this.featureResource.value;
  protected isLoading = this.featureResource.isLoading;
}
