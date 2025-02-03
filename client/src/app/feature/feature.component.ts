import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FeatureApiService } from './feature-api.service';
import { AsyncPipe } from '@angular/common';

@Component({
    selector: 'app-feature',
  imports: [
    AsyncPipe
  ],
    templateUrl: './feature.component.html',
    styleUrl: './feature.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class FeatureComponent {
  private readonly featureApi = inject(FeatureApiService);

  featureEntities$ = this.featureApi.getFeatureEntities();
}
