/**
 * "About" settings tab.
 *
 * A read-only facts page: product name, version, licences, source link and
 * credits. It reads no store state — every value comes from the canonical
 * `game_identity` data module, so the About tab can never drift from the title
 * screen or the lobby header.
 *
 * NOTE: `platform/laya/` only.
 */

import {
  ASSET_LICENSE,
  BUILD_LABEL,
  CODE_LICENSE,
  COPYRIGHT_LINE,
  CREDITS,
  GAME_VERSION,
  PROJECT_URL,
  gameNameLine,
} from '../../../../core/game/game_identity';
import { BaseSettingsSection } from './section';
import {
  createActionRow,
  createGroupHeading,
  createInfoRow,
  createNoteRow,
  type RowHandle,
} from './widgets';
import { t } from '../../../../core/game/i18n';

/** Opens `url` in a new tab, or does nothing when there is no URL yet. */
function openExternal(url: string): void {
  if (url === '') {
    return;
  }
  // The hand-written engine shim types `Laya.Browser.window` as `unknown`, so
  // narrow it here rather than casting at the call site.
  const win = Laya.Browser.window as { open?: (url: string, target?: string) => unknown } | null;
  win?.open?.(url, '_blank');
}

export class AboutSection extends BaseSettingsSection {
  get title(): string {
    return t('settings.tab.about');
  }
  get subtitle(): string {
    return t('settings.subtitle.about');
  }

  protected build(width: number): RowHandle[] {
    const hasRepo = PROJECT_URL !== '';
    const repositoryRow = createActionRow(
      width,
      t('settings.about.repository'),
      hasRepo ? PROJECT_URL : t('settings.about.notPublished'),
      t('settings.about.open'),
      () => openExternal(PROJECT_URL),
      'ghost',
    );
    // An empty URL would open a dead link, so grey the button out until the
    // project is published (`PROJECT_URL` is filled in then).
    if (!hasRepo) {
      repositoryRow.setEnabled(false);
    }

    return [
      createGroupHeading(t('settings.about.heading.product'), width),
      createInfoRow(width, t('settings.about.game'), gameNameLine()),
      createInfoRow(width, t('settings.about.version'), GAME_VERSION),
      createInfoRow(width, t('settings.about.build'), BUILD_LABEL),
      createGroupHeading(t('settings.about.heading.licences'), width),
      createInfoRow(width, t('settings.about.code'), CODE_LICENSE),
      createInfoRow(width, t('settings.about.assets'), ASSET_LICENSE),
      createInfoRow(width, t('settings.about.copyright'), COPYRIGHT_LINE),
      createGroupHeading(t('settings.about.heading.source'), width),
      repositoryRow,
      createGroupHeading(t('settings.about.heading.credits'), width),
      ...CREDITS.map((line) => createNoteRow(width, line)),
    ];
  }
}
