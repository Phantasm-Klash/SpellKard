/**
 * 千夜追忆（TNA）弹幕系统的客户端镜像入口。
 *
 * 本目录只依赖 `core/`（无 LayaAir / 平台代码），可被单元测试直接引用。
 * 服务端权威，客户端仅做镜像 + 插值表现。
 */

export * from './bullet_kind';
export * from './bullet_motion_table';
export * from './bullet_motion';
export * from './spawn_command';
export * from './player_loadout';
export * from './pattern_timeline';
