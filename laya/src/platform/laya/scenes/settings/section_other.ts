/**
 * "Other" settings tab — connection mode and mods.
 *
 * Two groups. Network picks which lobby / battle endpoints the client dials:
 * the pair compiled into this build, a Gensoulkyo on the LAN, or a third-party
 * deployment entered field by field. Mods holds the reserved workshop / custom
 * folder preferences.
 *
 * The mode and the custom-mods toggle gate their dependent fields: the fields
 * stay on screen so the player can see what exists, but are greyed and inert
 * until their mode is active. Gating is applied by mutating the row handles in
 * place — never by rebuilding the section, which would destroy the row under
 * the player's finger and drop focus from a text field mid-keystroke.
 *
 * NOTE: `platform/laya/` only.
 */

import { BaseSettingsSection } from './section';
import {
  createGroupHeading,
  createNoteRow,
  createOptionRow,
  createTextRow,
  createToggleRow,
  type OptionChoice,
  type RowHandle,
} from './widgets';
import type { NetworkMode } from '../../../../core/settings';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  isLanguageCode,
  t,
  type LanguageCode,
} from '../../../../core/game/i18n';

/**
 * Rebuilt per `build()` rather than kept at module level: the labels come from
 * `t()`, so a cached array would keep the language it was created in.
 */
function networkChoices(): readonly OptionChoice<NetworkMode>[] {
  return [
    { id: 'official', label: t('settings.network.official') },
    { id: 'lan', label: t('settings.network.lan') },
    { id: 'custom', label: t('settings.network.thirdParty') },
  ];
}

/**
 * Splits the typed URL list on whitespace and applies the same rule
 * `normalizeSettings` uses for stored arrays: trim, drop blanks, de-duplicate
 * while preserving order. The store re-runs it (plus the loadable-URL filter)
 * on write, so a rejected entry leaves the state even though it stays visible in
 * the field until the next rebuild.
 */
function parseModuleUrls(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of text.split(/\s+/)) {
    const trimmed = token.trim();
    if (trimmed === '' || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export class OtherSection extends BaseSettingsSection {
  get title(): string {
    return t('settings.tab.other');
  }
  get subtitle(): string {
    return t('settings.subtitle.other');
  }

  protected build(width: number): RowHandle[] {
    const { network, mods, plugins } = this.store.get();

    // The endpoint fields are built before the mode row so the mode handler can
    // grey them without a forward reference.
    const lanRow = createTextRow({
      width,
      label: t('settings.network.lanHost'),
      description: t('settings.network.lanHost.desc'),
      placeholder: '192.168.1.10:7350',
      value: network.lanHost,
      onChange: (lanHost) => {
        this.store.update({ network: { lanHost } });
      },
    });

    const httpRow = createTextRow({
      width,
      label: t('settings.network.httpBase'),
      description: t('settings.network.httpBase.desc'),
      placeholder: 'https://lobby.example',
      value: network.customHttpBase,
      onChange: (customHttpBase) => {
        this.store.update({ network: { customHttpBase } });
      },
    });

    const wsRow = createTextRow({
      width,
      label: t('settings.network.wsUrl'),
      placeholder: 'wss://lobby.example/ws',
      value: network.customWsUrl,
      onChange: (customWsUrl) => {
        this.store.update({ network: { customWsUrl } });
      },
    });

    const relayRow = createTextRow({
      width,
      label: t('settings.network.relayUrl'),
      placeholder: 'wss://lobby.example/relay',
      value: network.customRelayUrl,
      onChange: (customRelayUrl) => {
        this.store.update({ network: { customRelayUrl } });
      },
    });

    /**
     * Greys out whichever endpoints the selected mode does not use. Official
     * has no editable endpoints, so all four fields are disabled; LAN needs
     * only the host; a third-party deployment needs all three explicit URLs.
     */
    const applyNetworkEnabled = (mode: NetworkMode): void => {
      lanRow.setEnabled(mode === 'lan');
      httpRow.setEnabled(mode === 'custom');
      wsRow.setEnabled(mode === 'custom');
      relayRow.setEnabled(mode === 'custom');
    };

    const modeRow = createOptionRow<NetworkMode>({
      width,
      label: t('settings.network.connection'),
      description: t('settings.network.connection.desc'),
      choices: networkChoices(),
      value: network.mode,
      onChange: (mode) => {
        this.store.update({ network: { mode } });
        applyNetworkEnabled(mode);
      },
    });

    const workshopRow = createToggleRow({
      width,
      label: t('settings.mods.workshop'),
      description: t('settings.mods.workshop.desc'),
      value: mods.workshopEnabled,
      onChange: (workshopEnabled) => {
        this.store.update({ mods: { workshopEnabled } });
      },
    });

    const modFolderRow = createTextRow({
      width,
      label: t('settings.mods.folder'),
      placeholder: './mods',
      value: mods.customModPath,
      onChange: (customModPath) => {
        this.store.update({ mods: { customModPath } });
      },
    });

    const customModsRow = createToggleRow({
      width,
      label: t('settings.mods.custom'),
      description: t('settings.mods.custom.desc'),
      value: mods.customModsEnabled,
      onChange: (customModsEnabled) => {
        this.store.update({ mods: { customModsEnabled } });
        modFolderRow.setEnabled(customModsEnabled);
      },
    });

    // Apply the initial gate once every dependent handle exists.
    applyNetworkEnabled(network.mode);
    modFolderRow.setEnabled(mods.customModsEnabled);

    // External backend modules ("DLC"). The stock build ships none, so this group
    // is inert until the player pastes a URL.
    const autoLoadRow = createToggleRow({
      width,
      label: t('settings.plugins.autoLoad'),
      description: t('settings.plugins.autoLoad.desc'),
      value: plugins.autoLoad,
      onChange: (autoLoad) => {
        this.store.update({ plugins: { autoLoad } });
      },
    });

    const moduleUrlsRow = createTextRow({
      width,
      label: t('settings.plugins.moduleUrls'),
      description: t('settings.plugins.moduleUrls.desc'),
      placeholder: 'https://example.com/upscaler.js /dlc/backend.js',
      value: plugins.moduleUrls.join(' '),
      maxChars: 512,
      onChange: (text) => {
        this.store.update({ plugins: { moduleUrls: parseModuleUrls(text) } });
      },
    });

    // The language picker lives here rather than in a tab of its own: the
    // panel had seven tabs, and the language is one line among the other
    // preferences rather than a section worth a tab.
    const storedLanguage = this.store.get().language;
    const currentLanguage: LanguageCode = isLanguageCode(storedLanguage)
      ? storedLanguage
      : DEFAULT_LANGUAGE;
    const languageRow = createOptionRow<LanguageCode>({
      width,
      label: t('settings.language'),
      description: t('settings.language.hint'),
      choices: LANGUAGES.map((info) => ({ id: info.code, label: info.label })),
      value: currentLanguage,
      onChange: (language) => {
        this.store.update({ language });
      },
    });

    return [
      createGroupHeading(t('settings.language.heading'), width),
      languageRow,
      createNoteRow(width, t('settings.language.hint')),
      createGroupHeading(t('settings.network.heading'), width),
      modeRow,
      lanRow,
      httpRow,
      wsRow,
      relayRow,
      createNoteRow(width, t('settings.network.officialNote')),
      // The address is fixed when the client builds its transport at startup,
      // so an edit here does not take effect in this session. Say so, or the
      // player edits the field and nothing happens.
      createNoteRow(width, t('settings.network.restartNote')),
      createGroupHeading(t('settings.mods.heading'), width),
      workshopRow,
      customModsRow,
      modFolderRow,
      createNoteRow(width, t('settings.mods.note')),
      createGroupHeading(t('settings.plugins.heading'), width),
      autoLoadRow,
      moduleUrlsRow,
      createNoteRow(width, t('settings.plugins.note1')),
      createNoteRow(width, t('settings.plugins.note2')),
    ];
  }
}
