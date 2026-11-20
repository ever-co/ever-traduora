import { Component, OnInit } from '@angular/core';
import { EverPlatformPages, EverPlatformService } from '../../services/ever-platform.service';

/**
 * Ever Platform: the sections the server has loaded (connection and its maintenance operations, anonymous usage
 * statistics), for the operator only.
 */
@Component({
  standalone: false,
  selector: 'app-ever-platform-page',
  templateUrl: './ever-platform-page.component.html',
})
export class EverPlatformPageComponent implements OnInit {
  pages: EverPlatformPages | null = null;
  loaded = false;

  constructor(private everPlatform: EverPlatformService) {}

  ngOnInit(): void {
    this.everPlatform.pages().subscribe(pages => {
      this.pages = pages;
      this.loaded = true;
    });
  }
}
