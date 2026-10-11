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
  readonly title = 'About';
  readonly subtitle = '关于 · Copyright, version, credits';

  protected build(width: number): RowHandle[] {
    const hasRepo = PROJECT_URL !== '';
    const repositoryRow = createActionRow(
      width,
      'Repository',
      hasRepo ? PROJECT_URL : 'Not published yet',
      'Open',
      () => openExternal(PROJECT_URL),
      'ghost',
    );
    // An empty URL would open a dead link, so grey the button out until the
    // project is published (`PROJECT_URL` is filled in then).
    if (!hasRepo) {
      repositoryRow.setEnabled(false);
    }

    return [
      createGroupHeading('Product', width),
      createInfoRow(width, 'Game', gameNameLine()),
      createInfoRow(width, 'Version', GAME_VERSION),
      createInfoRow(width, 'Build', BUILD_LABEL),
      createGroupHeading('Licences', width),
      createInfoRow(width, 'Code', CODE_LICENSE),
      createInfoRow(width, 'Assets', ASSET_LICENSE),
      createInfoRow(width, 'Copyright', COPYRIGHT_LINE),
      createGroupHeading('Source', width),
      repositoryRow,
      createGroupHeading('Credits', width),
      ...CREDITS.map((line) => createNoteRow(width, line)),
    ];
  }
}
