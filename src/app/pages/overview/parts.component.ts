import { Component, input } from '@angular/core';
import { Part } from '../../words';

/**
 * One line made of pieces (words.ts, Part): the plain words as they are, a
 * commit, a hash or a command in the code font. The pieces carry their own
 * spaces; the template adds none between them. Every piece is shown as
 * text, never as HTML.
 */
@Component({
  selector: 'app-parts',
  template: `
    @for (part of parts(); track $index) {
      @if (part.code) {
        <code>{{ part.text }}</code>
      } @else {
        <span>{{ part.text }}</span>
      }
    }
  `,
})
export class PartsComponent {
  readonly parts = input.required<Part[]>();
}
