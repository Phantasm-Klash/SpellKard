// spk_steam — SpellKard Steamworks bridge (Windows native build).
//
// Wraps the Steamworks SDK (steam_api64) for exactly the surface the game
// needs, following the `spk_crypto` / `spk_udp` extension pattern:
//
//   window.spk_steam = {
//     version()                       -> "spellkard-steam/1.0.0"
//     init(appId)                     -> { ok, steamId, detail }
//     getSteamId()                    -> string | null
//     hasDlcInstalled(appId)          -> boolean
//     listOwnedDlc()                  -> number[]
//     subscribeWorkshopItem(id)       -> boolean      (id = decimal PublishedFileId string)
//     unsubscribeWorkshopItem(id)     -> boolean
//     getSubscribedWorkshopItems()    -> [{ publishedFileId, localPath, sizeBytes, installed }]
//     isWorkshopItemInstalled(id)     -> boolean
//     setAchievement(id)              -> boolean      (id = Steam achievement identifier)
//     getAchievements()               -> { [id]: boolean }
//     shutdown()                      -> undefined
//   }
//
// Design notes:
//   - All calls run on the JSVM main thread, which is the thread where
//     SteamAPI_Init happens — the Steamworks SDK requires exactly that.
//   - `init` is optional: the game's free tier (base content + P2P battles)
//     must never depend on this extension existing or succeeding.
//   - Workshop PublishedFileId_t is a uint64; it crosses the JSVM boundary
//     as a decimal string (JS `number` would lose precision above 2^53).
//   - Achievement ids must match the identifiers configured in the
//     Steamworks partner portal (stable forever, [A-Za-z0-9_]{3,64}).
//
// BUILD: see windows/build_windows.bat (requires the Steamworks SDK, and
// the redistributable steam_api64.dll shipped next to the game exe).
