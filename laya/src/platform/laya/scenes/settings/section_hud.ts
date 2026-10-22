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
import { t } from '../../../../core/game/i18n';

export class HudSection extends BaseSettingsSection {
  get title(): string {
    return t('settings.tab.hud');
  }
  get subtitle(): string {
    return t('settings.subtitle.hud');
  }

  protected build(width: number): RowHandle[] {
    const hud = this.store.get().hud;
    const rows: RowHandle[] = [];

    rows.push(createGroupHeading(t('settings.hud.heading'), width));

    rows.push(
      createToggleRow({
        width,
        label: t('settings.hud.opponentHud'),
        description: t('settings.hud.opponentHud.desc'),
        value: hud.showOpponentHud,
        onChange: (value) => {
          this.store.update({ hud: { showOpponentHud: value } });
        },
      }),
    );

    rows.push(
      createToggleRow({
        width,
        label: t('settings.hud.damageNumbers'),
        description: t('settings.hud.damageNumbers.desc'),
        value: hud.showDamageNumbers,
        onChange: (value) => {
          this.store.update({ hud: { showDamageNumbers: value } });
        },
      }),
    );

    rows.push(
      createToggleRow({
        width,
        label: t('settings.hud.scoreCard'),
        description: t('settings.hud.scoreCard.desc'),
        value: hud.showScoreCard,
        onChange: (value) => {
          this.store.update({ hud: { showScoreCard: value } });
        },
      }),
    );

    rows.push(
      createToggleRow({
        width,
        label: t('settings.hud.ultMeter'),
        description: t('settings.hud.ultMeter.desc'),
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
        label: t('settings.hud.statusCard'),
        description: t('settings.hud.statusCard.desc'),
        value: hud.showStatusCard,
        onChange: (value) => {
          this.store.update({ hud: { showStatusCard: value } });
          bulletRow?.setEnabled(value);
        },
      }),
    );

    const bullet = createToggleRow({
      width,
      label: t('settings.hud.bulletCount'),
      description: t('settings.hud.bulletCount.desc'),
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
        label: t('settings.hud.countdown'),
        description: t('settings.hud.countdown.desc'),
        value: hud.showCountdown,
        onChange: (value) => {
          this.store.update({ hud: { showCountdown: value } });
        },
      }),
    );

    rows.push(
      createToggleRow({
        width,
        label: t('settings.hud.networkFooter'),
        description: t('settings.hud.networkFooter.desc'),
        value: hud.showDebugFooter,
        onChange: (value) => {
          this.store.update({ hud: { showDebugFooter: value } });
        },
      }),
    );

    rows.push(
      createNoteRow(width, t('settings.hud.note')),
    );

    return rows;
  }
}
