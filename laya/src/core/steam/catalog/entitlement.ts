// Entitlement gate (client side, layer 1).
//
// Free tier (must never be gated on Steam or any DLC):
//   - base game content
//   - self-hosted / P2P battles (no Nakama DLC server involved)
//
// Paid tier:
//   - DLC-bundled server levels & servers  -> require Steam connected AND the
//     matching DLC appid owned (Steam-side ownership is the source of truth;
//     the Nakama reference service re-checks it server-side, layer 2).

export interface EntitlementState {
  /** Steam client is connected and init succeeded. */
  steamConnected: boolean;
  /** 64-bit Steam ID as string, when connected. */
  steamId: string | null;
  /** DLC appids Steam reports as installed for this account. */
  ownedDlcAppIds: readonly number[];
}

export type AccessTarget =
  | { kind: 'base' }
  | { kind: 'p2p' }
  | { kind: 'dlc-server'; dlcAppId: number; serverId: string }
  | { kind: 'dlc-content'; dlcAppId: number };

export type AccessCode =
  | 'allowed'
  | 'steam_not_connected'
  | 'dlc_not_owned';

export interface AccessDecision {
  allowed: boolean;
  code: AccessCode;
  reason: string;
}

export function ownsDlc(state: EntitlementState, dlcAppId: number): boolean {
  return state.steamConnected && state.ownedDlcAppIds.includes(dlcAppId);
}

export function decideAccess(state: EntitlementState, target: AccessTarget): AccessDecision {
  switch (target.kind) {
    case 'base':
      return {
        allowed: true,
        code: 'allowed',
        reason: 'base game content is free',
      };
    case 'p2p':
      return {
        allowed: true,
        code: 'allowed',
        reason: 'self-hosted P2P battles are free and never depend on DLC or Steam',
      };
    case 'dlc-server':
    case 'dlc-content': {
      if (!state.steamConnected) {
        return {
          allowed: false,
          code: 'steam_not_connected',
          reason:
            target.kind === 'dlc-server'
              ? `DLC server ${target.serverId} requires Steam authorization`
              : 'DLC content requires Steam authorization',
        };
      }
      if (!ownsDlc(state, target.dlcAppId)) {
        return {
          allowed: false,
          code: 'dlc_not_owned',
          reason:
            target.kind === 'dlc-server'
              ? `DLC server ${target.serverId} is bundled with DLC ${target.dlcAppId}, which is not owned`
              : `DLC ${target.dlcAppId} is not owned`,
        };
      }
      return {
        allowed: true,
        code: 'allowed',
        reason: target.kind === 'dlc-server' ? `DLC ${target.dlcAppId} owned` : `DLC ${target.dlcAppId} owned`,
      };
    }
  }
}

/** Entitlement state when the game runs without Steam (e.g. web build). */
export function offlineEntitlementState(): EntitlementState {
  return { steamConnected: false, steamId: null, ownedDlcAppIds: [] };
}
