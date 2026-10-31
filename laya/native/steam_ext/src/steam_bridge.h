// Steamworks side of `spk_steam`. Each function returns 0 on success and a
// non-zero code on failure (codes are stable, the JS layer maps them to
// detail strings). All functions are safe to call before init: they report
// "not initialized" instead of touching the SDK.
#ifndef SPK_STEAM_STEAM_BRIDGE_H_
#define SPK_STEAM_STEAM_BRIDGE_H_

#include <cstdint>
#include <cstddef>

namespace spk_steam {

// Error codes (stable; surfaced in init/result detail strings).
enum Code : int {
  kOk = 0,
  kNotInitialized = 1,
  kSteamInitFailed = 2,
  kSteamRestartPending = 3,  // SteamAPI_RestartAppIfNecessary re-execed the app
  kBadArgument = 4,
  kIdParseFailed = 5,        // PublishedFileId decimal string out of range
  kUnsupportedPlatform = 6,
  kItemNotFound = 7,
};

/**
 * Initialize the Steamworks client.
 * steamIdOut/detailOut are NUL-terminated UTF-8 (empty string on failure
 * modes where nothing useful to say).
 */
int Init(uint32_t appId, char* steamIdOut, size_t steamIdCap,
         char* detailOut, size_t detailCap);

/** Current SteamID64, or 0 when not initialized. */
int GetSteamId64(char* out, size_t cap);

/** BHasDlcInstalled for the given appid. */
int HasDlc(uint32_t appId, int* out);

int DlcCount(int* out);
int DlcAppId(int index, uint32_t* out);

/** Subscribe/unsubscribe a Workshop item by decimal PublishedFileId string. */
int SubscribeWorkshopItem(const char* publishedFileId, int* out);
int UnsubscribeWorkshopItem(const char* publishedFileId, int* out);

int SubscribedCount(int* out);
int SubscribedId(int index, char* out, size_t cap);

/**
 * Install info for a subscribed item. `localPath` is the Steam-provided
 * install folder (empty while still downloading); `sizeOut` is the total
 * bytes on disk; `installedOut` is k_WorkshopItemFileInstalled.
 */
int WorkshopInstallInfo(const char* publishedFileId, char* localPath,
                        size_t localPathCap, int64_t* sizeOut, int* installedOut);

/** Grant an achievement (SetAchievement + StoreStats). */
int SetAchievement(const char* achievementId, int* out);

int AchievementCount(int* out);
int AchievementId(int index, char* out, size_t cap);
int AchievementUnlocked(int index, int* out);

/** SteamAPI_Shutdown; idempotent. */
int Shutdown();

/** "spellkard-steam/1.0.0" */
const char* Version();

}  // namespace spk_steam

#endif  // SPK_STEAM_STEAM_BRIDGE_H_
