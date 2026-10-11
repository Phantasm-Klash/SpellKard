/**
 * The settings section contract.
 *
 * The panel is a tab bar plus one *section* per tab. A section is a self-
 * contained block of rows that reads from and writes to the shared
 * `SettingsStore`; it knows nothing about the tab bar, the scrim or the other
 * sections. That seam is what lets each section be written and reviewed on its
 * own.
 *
 * `BaseSettingsSection` implements the boring half (row stacking, sizing, text
 * collection for the screenshot harness) so a section only has to declare its
 * title and return its rows.
 *
 * NOTE: `platform/laya/` only.
 */

import type { SettingsStore } from '../../../../core/settings';
import { ROW_GAP, type RowHandle } from './widgets';

export interface SettingsSection {
  /** Tab label. */
  readonly title: string;
  /** One-line description shown under the tab bar. */
  readonly subtitle: string;
  readonly root: Laya.Sprite;
  /** Height the rows need at the last laid-out width. */
  readonly contentHeight: number;
  /** Re-lays out for a new content width and rebuilds the rows. */
  layout(width: number): void;
  /** Rebuilds the rows from the current settings (open / reset / tab switch). */
  refresh(): void;
  /** Every string currently painted, for the local screenshot harness. */
  debugLabels(): string[];
}

export abstract class BaseSettingsSection implements SettingsSection {
  readonly root = new Laya.Sprite();

  protected readonly store: SettingsStore;
  protected width = 0;
  protected rows: RowHandle[] = [];

  private lastHeight = 0;

  constructor(store: SettingsStore) {
    this.store = store;
  }

  abstract readonly title: string;
  abstract readonly subtitle: string;

  get contentHeight(): number {
    return this.lastHeight;
  }

  layout(width: number): void {
    this.width = Math.max(0, width);
    this.rebuild();
  }

  refresh(): void {
    this.rebuild();
  }

  /** Returns the rows in display order. Called on every rebuild. */
  protected abstract build(width: number): RowHandle[];

  /**
   * Drops the current rows and rebuilds them from the store.
   *
   * Rebuilding (rather than mutating in place) is what keeps a section honest:
   * a row can never show a value the store does not hold. It also means a row
   * callback must NOT trigger a rebuild — a text field would lose focus
   * mid-keystroke. Rows update their own visuals and write to the store; the
   * panel calls `refresh()` only when it deliberately wants a full redraw.
   */
  protected rebuild(): void {
    this.root.removeChildren();
    this.rows = this.build(this.width);

    let y = 0;
    for (const row of this.rows) {
      row.sprite.y = y;
      this.root.addChild(row.sprite);
      y += row.height + ROW_GAP;
    }
    this.lastHeight = this.rows.length === 0 ? 0 : Math.max(0, y - ROW_GAP);
    this.root.size(this.width, this.lastHeight);
  }

  debugLabels(): string[] {
    const out: string[] = [];
    const walk = (node: Laya.Sprite): void => {
      for (let index = 0; index < node.numChildren; index += 1) {
        const child = node.getChildAt(index);
        const text = (child as unknown as { text?: unknown }).text;
        if (typeof text === 'string' && text !== '') {
          out.push(text);
        }
        if (child.numChildren > 0) {
          walk(child);
        }
      }
    };
    walk(this.root);
    return out;
  }
}
