/**
 * Tiny UI kit for the LayaAir scenes.
 *
 * The prototype screens are built from clickable `Laya.Sprite` panels and
 * `Laya.Text` labels so the client has no dependency on the LayaAir UI package
 * or any imported scene/atlas yet. Replacing these with `laya.ui` widgets later
 * only touches this file plus the scene layout code.
 */

export interface ButtonHandle {
  readonly sprite: Laya.Sprite;
  readonly label: Laya.Text;
  setEnabled(enabled: boolean): void;
  setText(text: string): void;
}

const COLOR_PANEL = '#1d1430';
const COLOR_PANEL_BORDER = '#5c4a86';
const COLOR_BUTTON = '#2f2150';
const COLOR_BUTTON_DISABLED = '#2a2340';
const COLOR_TEXT = '#f0ecff';
const COLOR_TEXT_DISABLED = '#8a83a8';
const COLOR_TITLE = '#ffe36e';

export function createTitle(text: string, width: number): Laya.Text {
  const label = new Laya.Text();
  label.text = text;
  label.fontSize = 26;
  label.color = COLOR_TITLE;
  label.bold = true;
  label.align = 'center';
  label.width = width;
  label.pos(0, 24);
  return label;
}

export function createLabel(text: string, width: number, y: number, fontSize = 16): Laya.Text {
  const label = new Laya.Text();
  label.text = text;
  label.fontSize = fontSize;
  label.color = COLOR_TEXT;
  label.width = width;
  label.wordWrap = true;
  label.leading = 5;
  label.pos(16, y);
  return label;
}

export function createButton(
  text: string,
  x: number,
  y: number,
  width: number,
  onClick: () => void,
): ButtonHandle {
  const sprite = new Laya.Sprite();
  sprite.pos(x, y);
  sprite.mouseEnabled = true;
  const height = 44;

  const label = new Laya.Text();
  label.text = text;
  label.fontSize = 17;
  label.color = COLOR_TEXT;
  label.align = 'center';
  label.valign = 'middle';
  label.width = width;
  label.height = height;
  label.pos(0, 0);

  let enabled = true;
  const redraw = (): void => {
    sprite.graphics.clear();
    sprite.graphics.drawRect(
      0,
      0,
      width,
      height,
      enabled ? COLOR_BUTTON : COLOR_BUTTON_DISABLED,
      COLOR_PANEL_BORDER,
      2,
    );
    label.color = enabled ? COLOR_TEXT : COLOR_TEXT_DISABLED;
  };
  redraw();

  sprite.on(Laya.Event.CLICK, undefined, () => {
    if (enabled) {
      onClick();
    }
  });

  sprite.addChild(label);

  return {
    sprite,
    label,
    setEnabled(value: boolean): void {
      enabled = value;
      sprite.mouseEnabled = value;
      redraw();
    },
    setText(value: string): void {
      label.text = value;
    },
  };
}

export function createPanel(x: number, y: number, width: number, height: number): Laya.Sprite {
  const panel = new Laya.Sprite();
  panel.pos(x, y);
  panel.graphics.drawRect(0, 0, width, height, COLOR_PANEL, COLOR_PANEL_BORDER, 2);
  return panel;
}
