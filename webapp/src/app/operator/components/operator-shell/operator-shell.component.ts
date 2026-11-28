import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/** The frame of the operator pages (/operator/...): the title and the tabs. */
@Component({
  selector: 'app-operator-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './operator-shell.component.html',
  styleUrls: ['./operator-shell.component.css'],
})
export class OperatorShellComponent {}
