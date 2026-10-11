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

/**
 * Module-level so every `build()` reuses the same choice objects instead of
 * allocating three fresh ones per rebuild.
 */
const NETWORK_CHOICES: readonly OptionChoice<NetworkMode>[] = [
  { id: 'official', label: 'Official' },
  { id: 'lan', label: 'LAN' },
  { id: 'custom', label: 'Third-party' },
];

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
  readonly title = 'Other';
  readonly subtitle = '其他设置 · Connection mode and mods';

  protected build(width: number): RowHandle[] {
    const { network, mods, plugins } = this.store.get();

    // The endpoint fields are built before the mode row so the mode handler can
    // grey them without a forward reference.
    const lanRow = createTextRow({
      width,
      label: 'LAN host',
      description:
        'Host or host:port of a Gensoulkyo server on your local network. The lobby WebSocket and battle relay paths are derived from it.',
      placeholder: '192.168.1.10:7350',
      value: network.lanHost,
      onChange: (lanHost) => {
        this.store.update({ network: { lanHost } });
      },
    });

    const httpRow = createTextRow({
      width,
      label: 'Lobby HTTP base',
      description: 'REST base of the third-party deployment.',
      placeholder: 'https://lobby.example',
      value: network.customHttpBase,
      onChange: (customHttpBase) => {
        this.store.update({ network: { customHttpBase } });
      },
    });

    const wsRow = createTextRow({
      width,
      label: 'Lobby WebSocket URL',
      placeholder: 'wss://lobby.example/ws',
      value: network.customWsUrl,
      onChange: (customWsUrl) => {
        this.store.update({ network: { customWsUrl } });
      },
    });

    const relayRow = createTextRow({
      width,
      label: 'Battle relay URL',
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
      label: 'Connection',
      description:
        'Which lobby server the client talks to. The choice is stored immediately and used the next time the client connects.',
      choices: NETWORK_CHOICES,
      value: network.mode,
      onChange: (mode) => {
        this.store.update({ network: { mode } });
        applyNetworkEnabled(mode);
      },
    });

    const workshopRow = createToggleRow({
      width,
      label: 'Creative workshop',
      description: 'Browse and install community mods. Reserved — no loader ships yet.',
      value: mods.workshopEnabled,
      onChange: (workshopEnabled) => {
        this.store.update({ mods: { workshopEnabled } });
      },
    });

    const modFolderRow = createTextRow({
      width,
      label: 'Mod folder',
      placeholder: './mods',
      value: mods.customModPath,
      onChange: (customModPath) => {
        this.store.update({ mods: { customModPath } });
      },
    });

    const customModsRow = createToggleRow({
      width,
      label: 'Custom mods',
      description: 'Load mods from a folder you choose.',
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
      label: 'Auto-load external modules',
      description:
        'Load every module URL below as soon as the client starts, without asking per module.',
      value: plugins.autoLoad,
      onChange: (autoLoad) => {
        this.store.update({ plugins: { autoLoad } });
      },
    });

    const moduleUrlsRow = createTextRow({
      width,
      label: 'Module URLs',
      description: 'One or more ES module URLs, separated by spaces. Nothing is fetched until you add one here.',
      placeholder: 'https://example.com/upscaler.js /dlc/backend.js',
      value: plugins.moduleUrls.join(' '),
      maxChars: 512,
      onChange: (text) => {
        this.store.update({ plugins: { moduleUrls: parseModuleUrls(text) } });
      },
    });

    return [
      createGroupHeading('Network', width),
      modeRow,
      lanRow,
      httpRow,
      wsRow,
      relayRow,
      createNoteRow(
        width,
        'Official uses the lobby and battle relay endpoints compiled into this build. LAN derives http://<host>, ws://<host>/ws and ws://<host>/relay from the host you enter, so only the host is needed.',
      ),
      createGroupHeading('Mods', width),
      workshopRow,
      customModsRow,
      modFolderRow,
      createNoteRow(
        width,
        'No mod loader is implemented yet. These preferences are stored so a future loader can honour them; nothing is loaded today.',
      ),
      createGroupHeading('External modules (DLC)', width),
      autoLoadRow,
      moduleUrlsRow,
      createNoteRow(
        width,
        'Nothing is downloaded unless a URL is entered here. Each URL must serve an ES module that ' +
          'exports createUpscaler() (or upscaler / descriptor / register(registry)). A module loaded ' +
          'this way can only ever register an external upscaler backend, and it cannot make DLSS or ' +
          'FSR possible on this renderer — it can only supply a real backend for a platform that ' +
          'already has one.',
      ),
      createNoteRow(
        width,
        'Only http(s):// URLs and root-relative /path URLs are accepted. Anything else — file:, ' +
          'data:, a bare hostname — is rejected before it is stored or imported.',
      ),
    ];
  }
}
