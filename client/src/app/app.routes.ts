import { Routes } from '@angular/router';
import { FeatureRouteSegment } from './feature';

export const routes: Routes = [
  {path: '', redirectTo: FeatureRouteSegment.feature, pathMatch: 'full'},
  {path: FeatureRouteSegment.feature, loadComponent: () => import('./feature/feature.component').then(c => c.FeatureComponent)}
];
