/**
 * "HUD" settings tab — which battle overlays the client is allowed to draw.
 *
 * One toggle per HUD block, in the order the player sees them on screen. The
 * switches are pure data: each one flips a single `HudSettings` flag in the
 * shared store, and the HUD re-flows around whatever is left enabled. Nothing
 * here paints the battle HUD itself — that is the HUD's job, this tab only
 * records the player's intent.
 *
 * NOTE: `platform/laya/` only.
 */

import { BaseSettingsSection } from './section';
import { createGroupHeading, createNoteRow, createToggleRow, type RowHandle, type ToggleRowHandle } from './widgets';

export class HudSection extends BaseSettingsSection {
  readonly title = 'HUD';
  readonly subtitle = 'HUD 显示内容 · Which battle overlays to draw';

  protected build(width: number): RowHandle[] {
    const hud = this.store.get().hud;
    const rows: RowHandle[] = [];

    rows.push(createGroupHeading('Battle HUD', width));

    rows.push(
      createToggleRow({
        width,
        label: 'Opponent HUD',
        description: "The rival's Boss HP panel.",
        value: hud.showOpponentHud,
        onChange: (value) => {
          this.store.update({ hud: { showOpponentHud: value } });
        },
      }),
    );

    rows.push(
      createToggleRow({
        width,
        label: 'Damage numbers',
        description: 'Floating damage values over the Boss.',
        value: hud.showDamageNumbers,
        onChange: (value) => {
          this.store.update({ hud: { showDamageNumbers: value } });
        },
      }),
    );

    rows.push(
      createToggleRow({
        width,
        label: 'Score card',
        description: 'Your score and combo readout.',
        value: hud.showScoreCard,
        onChange: (value) => {
          this.store.update({ hud: { showScoreCard: value } });
        },
      }),
    );

    rows.push(
      createToggleRow({
        width,
        label: 'Ultimate meter',
        description: 'Charge meter for bombs and spell cards.',
        value: hud.showUltMeter,
        onChange: (value) => {
          this.store.update({ hud: { showUltMeter: value } });
        },
      }),
    );

    // The bullet-count switch belongs to the status card, so the status-card
    // callback needs a handle to it. It is captured here and assigned below;
    // the callback only fires on a later click, by which time the assignment
    // has run. Keeping the handle (instead of rebuilding) is deliberate — a
    // rebuild from inside a toggle callback would destroy the row under the
    // player's finger.
    let bulletRow: ToggleRowHandle | null = null;

    rows.push(
      createToggleRow({
        width,
        label: 'Status card',
        description: 'The main readout strip: HP, lives and bullet count.',
        value: hud.showStatusCard,
        onChange: (value) => {
          this.store.update({ hud: { showStatusCard: value } });
          bulletRow?.setEnabled(value);
        },
      }),
    );

    const bullet = createToggleRow({
      width,
      label: 'Bullet count',
      description: 'The BULLETS row inside the status card.',
      value: hud.showBulletCount,
      onChange: (value) => {
        this.store.update({ hud: { showBulletCount: value } });
      },
    });
    bulletRow = bullet;
    // Start greyed-out when the status card is off: the sub-row has no meaning
    // while its parent block is not drawn, but the switch stays visible so the
    // setting is not silently forgotten.
    bullet.setEnabled(hud.showStatusCard);
    rows.push(bullet);

    rows.push(
      createToggleRow({
        width,
        label: 'Countdown',
        description: 'Remaining match time.',
        value: hud.showCountdown,
        onChange: (value) => {
          this.store.update({ hud: { showCountdown: value } });
        },
      }),
    );

    rows.push(
      createToggleRow({
        width,
        label: 'Network footer',
        description: 'Ping and reconciliation readout along the bottom edge.',
        value: hud.showDebugFooter,
        onChange: (value) => {
          this.store.update({ hud: { showDebugFooter: value } });
        },
      }),
    );

    rows.push(
      createNoteRow(
        width,
        'Hidden blocks are re-flowed away instead of leaving empty gaps, so the HUD stays compact. ' +
          'The damage-number and ultimate-meter overlays are still being built out: those two switches ' +
          'are stored now and take effect as each overlay lands.',
      ),
    );

    return rows;
  }
}
