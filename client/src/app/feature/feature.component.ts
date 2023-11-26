import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FeatureApiService } from './feature-api.service';

@Component({
  selector: 'app-feature',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './feature.component.html',
  styleUrl: './feature.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FeatureComponent {
  private readonly featureApi = inject(FeatureApiService);

  featureEntities$ = this.featureApi.getFeatureEntities();
}
