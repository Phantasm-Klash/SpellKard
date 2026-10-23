/**
 * 雀魂友人场式建房/房间设置面板的绘制层。
 *
 * 这一层刻意很薄：哪几行、每行能不能点、为什么不能点，全部由 `room_setup` 里的纯
 * 函数 `setupRows` 决定（那里有测试，且不依赖 LayaAir）。这里只负责把行画出来、把
 * 点击回调接到 `onEdit`。绘制代码放进不了 node 测试，所以凡是可以挪走的判断都挪走了。
 *
 * 面板自己不判断能不能改——`roomSetupEditable` 说了算，服务端还会再判一次。这里只是
 * 别给出点了必然失败的按钮。
 */

import { ButtonHandle, createButton, createLabel, createPanel } from './ui_kit';
import * as theme from '../view/theme';
import { RoomSetupState, SetupRowsContext, roomSetupSummary, setupRows } from '../../../core/net/room_setup';

export interface RoomSetupPanelOptions {
  readonly width: number;
  readonly onEdit?: (key: string) => void;
}

export class RoomSetupPanel {
  readonly root: Laya.Sprite;

  private readonly options: RoomSetupPanelOptions;
  private readonly rows: Laya.Sprite;
  private readonly summary: Laya.Text;
  private rowButtons: ButtonHandle[] = [];

  constructor(options: RoomSetupPanelOptions) {
    this.options = options;
    this.root = createPanel(0, 0, options.width, 260);
    this.summary = createLabel('', options.width - 24, 0, theme.FONT_SIZE_CAPTION, { align: 'left' });
    this.summary.pos(12, 10);
    this.root.addChild(this.summary);
    this.rows = new Laya.Sprite();
    this.rows.pos(12, 40);
    this.root.addChild(this.rows);
  }

  /** 用一份状态重绘。 */
  render(state: RoomSetupState, ctx: SetupRowsContext): void {
    this.summary.text = roomSetupSummary(state);
    this.rows.removeChildren();
    this.rowButtons = [];

    let y = 0;
    for (const row of setupRows(state, ctx)) {
      const label = createLabel(row.label, 120, y, theme.FONT_SIZE_LABEL, { align: 'left' });
      label.pos(0, y);
      this.rows.addChild(label);

      const value = createLabel(row.valueText, 120, y, theme.FONT_SIZE_LABEL, { align: 'left' });
      value.pos(130, y);
      this.rows.addChild(value);

      if (row.editable) {
        const button = createButton('切换', 260, y, 90, () => {
          if (this.options.onEdit) {
            this.options.onEdit(row.key);
          }
        });
        this.rowButtons.push(button);
        this.rows.addChild(button.sprite);
      } else if (row.lockedReason !== '') {
        const locked = createLabel(row.lockedReason, 120, y, theme.FONT_SIZE_CAPTION, { align: 'left' });
        locked.pos(260, y);
        this.rows.addChild(locked);
      } else if (row.hostOnly) {
        const hint = createLabel('房主设置', 120, y, theme.FONT_SIZE_CAPTION, { align: 'left' });
        hint.pos(260, y);
        this.rows.addChild(hint);
      }
      y += 30;
    }
  }

  /** 开局后整体禁用，而不是重画——重画会丢焦点。 */
  setEnabled(enabled: boolean): void {
    for (const button of this.rowButtons) {
      button.setEnabled(enabled);
    }
  }
}
