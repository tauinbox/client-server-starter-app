import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { HeaderComponent } from '@core/components/header/header.component';
import { SidenavComponent } from '@core/components/sidenav/sidenav.component';
import { AuthStore } from '@features/auth/store/auth.store';
import { SidenavStateService } from '@core/services/sidenav-state.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, HeaderComponent, SidenavComponent, MatSidenavModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  protected readonly authStore = inject(AuthStore);
  protected readonly sidenavState = inject(SidenavStateService);
}
