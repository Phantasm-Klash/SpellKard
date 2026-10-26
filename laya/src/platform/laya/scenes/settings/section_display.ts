/**
 * "Display" settings tab — resolution, effects, frame rate, FPS counter.
 *
 * A section is pure data: it returns rows in display order and the base class
 * stacks and sizes them. Every row reads its initial value from the shared
 * store and writes straight back on change; the store is the single source of
 * truth, so a row never has to be reconciled by hand.
 *
 * NOTE: `platform/laya/` only.
 */

import {
  type EffectLevel,
  type FrameCap,
  type RenderScale,
  type WindowScale,
} from '../../../../core/settings';
import {
  UpscalerRegistry,
  upscalerSummary,
  type UpscalerBackendId,
} from '../../../../core/render/upscaler';
import { BaseSettingsSection } from './section';
import {
  createGroupHeading,
  createInfoRow,
  createNoteRow,
  createOptionRow,
  createSliderRow,
  createToggleRow,
  type OptionChoice,
  type RowHandle,
} from './widgets';
import { t } from '../../../../core/game/i18n';

// Choice lists are module-level so a rebuild (tab switch, window resize, reset)
// reuses the same arrays instead of allocating new ones on every `build()`.
// The numeric labels are language-neutral; only the named ones go through `t()`,
// which is why this is a function rather than a constant — a rebuild after a
// language switch has to re-read the table.
function renderScaleChoices(): readonly OptionChoice<RenderScale>[] {
  return [
    { id: 0.5, label: '0.5×' },
    { id: 0.75, label: '0.75×' },
    { id: 1, label: '1×' },
    { id: 1.5, label: '1.5×' },
  ];
}

/**
 * Window-size choices. `1×` / `2×` / `4×` are integer multiples of the design
 * stage; `auto` is resolved against the monitor at apply time, so its label
 * cannot say a number here.
 */
function windowScaleChoices(): readonly OptionChoice<WindowScale>[] {
  return [
    { id: 1, label: '1×' },
    { id: 2, label: '2×' },
    { id: 4, label: '4×' },
    { id: 'auto', label: t('settings.display.windowScale.auto') },
  ];
}

function effectChoices(): readonly OptionChoice<EffectLevel>[] {
  return [
    { id: 'low', label: t('settings.display.effect.low') },
    { id: 'medium', label: t('settings.display.effect.medium') },
    { id: 'high', label: t('settings.display.effect.high') },
  ];
}

function frameCapChoices(): readonly OptionChoice<FrameCap>[] {
  return [
    { id: 30, label: '30 FPS' },
    { id: 60, label: '60 FPS' },
    { id: 120, label: '120 FPS' },
    { id: 0, label: t('settings.display.frameCap.uncapped') },
  ];
}

export class DisplaySection extends BaseSettingsSection {
  get title(): string {
    return t('settings.tab.display');
  }
  get subtitle(): string {
    return t('settings.subtitle.display');
  }

  protected build(width: number): RowHandle[] {
    const display = this.store.get().display;

    // The upscaler menu is data, not a hard-coded list: the registry is the same
    // one the renderer reads, so a backend a module registers later shows up here
    // without a code change. Unavailable descriptors cannot be selected, so they
    // are rendered as their own (unselectable) info rows instead.
    const registry = new UpscalerRegistry();
    const descriptors = registry.list();
    const selected = registry.get(display.upscaler);
    const availableChoices: readonly OptionChoice<UpscalerBackendId>[] = descriptors
      .filter((descriptor) => descriptor.available)
      .map((descriptor) => ({ id: descriptor.id, label: descriptor.shortLabel }));
    const unavailable = descriptors.filter((descriptor) => !descriptor.available);

    // Sharpening only exists for the software backend, so it is built before the
    // option row that gates it and toggled in place from that row's callback —
    // never by rebuilding, which would tear the row down under the pointer.
    const sharpnessRow = createSliderRow({
      width,
      label: t('settings.display.sharpening'),
      description: t('settings.display.sharpening.desc'),
      value: display.upscalerSharpness,
      step: 0.05,
      onChange: (upscalerSharpness) => {
        this.store.update({ display: { upscalerSharpness } });
      },
    });
    sharpnessRow.setEnabled(display.upscaler === 'software');

    const upscalerRow = createOptionRow<UpscalerBackendId>({
      width,
      label: t('settings.display.upscaler'),
      description: t('settings.display.upscaler.desc'),
      choices: availableChoices,
      value: display.upscaler,
      onChange: (upscaler) => {
        this.store.update({ display: { upscaler } });
        sharpnessRow.setEnabled(upscaler === 'software');
      },
    });

    const rows: RowHandle[] = [
      createGroupHeading(t('settings.tab.display'), width),
      createOptionRow<RenderScale>({
        width,
        label: t('settings.display.resolutionScale'),
        description: t('settings.display.resolutionScale.desc'),
        choices: renderScaleChoices(),
        value: display.renderScale,
        onChange: (renderScale) => {
          this.store.update({ display: { renderScale } });
        },
      }),
      createOptionRow<WindowScale>({
        width,
        label: t('settings.display.windowScale'),
        description: t('settings.display.windowScale.desc'),
        choices: windowScaleChoices(),
        value: display.windowScale,
        onChange: (windowScale) => {
          this.store.update({ display: { windowScale } });
        },
      }),
      createOptionRow<EffectLevel>({
        width,
        label: t('settings.display.effects'),
        description: t('settings.display.effects.desc'),
        choices: effectChoices(),
        value: display.effectLevel,
        onChange: (effectLevel) => {
          this.store.update({ display: { effectLevel } });
        },
      }),
      createOptionRow<FrameCap>({
        width,
        label: t('settings.display.frameRate'),
        description: t('settings.display.frameRate.desc'),
        choices: frameCapChoices(),
        value: display.frameCap,
        onChange: (frameCap) => {
          this.store.update({ display: { frameCap } });
        },
      }),
      createToggleRow({
        width,
        label: t('settings.display.showFps'),
        description: t('settings.display.showFps.desc'),
        value: display.showFps,
        onChange: (showFps) => {
          this.store.update({ display: { showFps } });
        },
      }),
      // The two controls differ in when they take effect, and that is not
      // obvious from the rows above, so say it plainly.
      createNoteRow(width, t('settings.display.note')),
      createGroupHeading(t('settings.display.upscaling'), width),
      upscalerRow,
    ];

    // Unavailable backends are shown so the player can see what exists and why it
    // cannot run here, but they are not part of the selectable option row.
    for (const descriptor of unavailable) {
      rows.push(
        createInfoRow(width, t('settings.display.unavailable', { label: descriptor.shortLabel }), ''),
      );
    }

    rows.push(sharpnessRow);
    // Printed verbatim from the descriptor: the honesty is the point, so the
    // note is never paraphrased here.
    rows.push(createNoteRow(width, upscalerSummary(selected)));
    if (selected.id === 'software') {
      rows.push(createNoteRow(width, t('settings.display.softwareNote')));
    }
    if (unavailable.length > 0) {
      rows.push(
        createNoteRow(
          width,
          t('settings.display.unavailableNote', {
            details: unavailable
              .map((descriptor) => `${descriptor.shortLabel}: ${descriptor.unavailableReason}`)
              .join(' '),
          }),
        ),
      );
    }

    return rows;
  }
}
