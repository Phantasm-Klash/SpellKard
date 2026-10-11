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

// Choice lists are module-level so a rebuild (tab switch, window resize, reset)
// reuses the same arrays instead of allocating new ones on every `build()`.
const RENDER_SCALE_CHOICES: readonly OptionChoice<RenderScale>[] = [
  { id: 0.5, label: '0.5×' },
  { id: 0.75, label: '0.75×' },
  { id: 1, label: '1×' },
  { id: 1.5, label: '1.5×' },
];

const EFFECT_CHOICES: readonly OptionChoice<EffectLevel>[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

const FRAME_CAP_CHOICES: readonly OptionChoice<FrameCap>[] = [
  { id: 30, label: '30 FPS' },
  { id: 60, label: '60 FPS' },
  { id: 120, label: '120 FPS' },
  { id: 0, label: 'Uncapped' },
];

export class DisplaySection extends BaseSettingsSection {
  readonly title = 'Display';
  readonly subtitle = '画面与性能 · Resolution, effects, frame rate';

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
      label: 'Sharpening',
      description:
        'Contrast-adaptive sharpening applied after the software upscale. 0% is a plain bilinear upscale.',
      value: display.upscalerSharpness,
      step: 0.05,
      onChange: (upscalerSharpness) => {
        this.store.update({ display: { upscalerSharpness } });
      },
    });
    sharpnessRow.setEnabled(display.upscaler === 'software');

    const upscalerRow = createOptionRow<UpscalerBackendId>({
      width,
      label: 'Upscaler',
      description:
        'Post-process upscaling backend. Only backends this build can actually run are selectable; the rest are listed below.',
      choices: availableChoices,
      value: display.upscaler,
      onChange: (upscaler) => {
        this.store.update({ display: { upscaler } });
        sharpnessRow.setEnabled(upscaler === 'software');
      },
    });

    const rows: RowHandle[] = [
      createGroupHeading('Display', width),
      createOptionRow<RenderScale>({
        width,
        label: 'Resolution scale',
        description:
          'Render resolution multiplier. Lower values render fewer pixels and are cheaper on weak GPUs.',
        choices: RENDER_SCALE_CHOICES,
        value: display.renderScale,
        onChange: (renderScale) => {
          this.store.update({ display: { renderScale } });
        },
      }),
      createOptionRow<EffectLevel>({
        width,
        label: 'Effects',
        description: 'Bullet trails, glow and impact effects.',
        choices: EFFECT_CHOICES,
        value: display.effectLevel,
        onChange: (effectLevel) => {
          this.store.update({ display: { effectLevel } });
        },
      }),
      createOptionRow<FrameCap>({
        width,
        label: 'Frame rate limit',
        description:
          'Caps how often the game redraws. Gameplay stays server-authoritative, so this never changes the simulation.',
        choices: FRAME_CAP_CHOICES,
        value: display.frameCap,
        onChange: (frameCap) => {
          this.store.update({ display: { frameCap } });
        },
      }),
      createToggleRow({
        width,
        label: 'Show frame rate',
        description: 'Draws a frame-rate counter in the corner of the battle screen.',
        value: display.showFps,
        onChange: (showFps) => {
          this.store.update({ display: { showFps } });
        },
      }),
      // The two controls differ in when they take effect, and that is not
      // obvious from the rows above, so say it plainly.
      createNoteRow(
        width,
        'The frame-rate limit applies immediately by gating the engine render loop. The resolution ' +
          'scale is applied to the canvas backing store, so it only takes visible effect after the ' +
          'next window resize or a restart.',
      ),
      createGroupHeading('Upscaling', width),
      upscalerRow,
    ];

    // Unavailable backends are shown so the player can see what exists and why it
    // cannot run here, but they are not part of the selectable option row.
    for (const descriptor of unavailable) {
      rows.push(createInfoRow(width, `${descriptor.shortLabel} (unavailable)`, ''));
    }

    rows.push(sharpnessRow);
    // Printed verbatim from the descriptor: the honesty is the point, so the
    // note is never paraphrased here.
    rows.push(createNoteRow(width, upscalerSummary(selected)));
    if (selected.id === 'software') {
      rows.push(
        createNoteRow(
          width,
          'This is a spatial approximation implemented in the browser. It is not DLSS and not FSR — see the notes above.',
        ),
      );
    }
    if (unavailable.length > 0) {
      rows.push(
        createNoteRow(
          width,
          `Not available in this build — ${unavailable
            .map((descriptor) => `${descriptor.shortLabel}: ${descriptor.unavailableReason}`)
            .join(' ')}`,
        ),
      );
    }

    return rows;
  }
}
