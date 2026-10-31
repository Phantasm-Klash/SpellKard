// Steamworks implementation of the spk_steam bridge (Windows).
//
// Includes the real Steamworks SDK headers — the SDK is not vendored here;
// the build passes <Steamworks>/public on the include path (see
// windows/build_windows.bat, SPK_STEAMWORKS).

#include "steam_bridge.h"

#if !defined(_WIN32)
// Steam native builds are Windows-only for this project; other platforms get
// a compile-time answer so the JS layer can report a clean "unavailable".
namespace spk_steam {
int Init(uint32_t, char* out, size_t cap, char* detail, size_t dcap) {
  (void)out;
  (void)cap;
  if (dcap > 0) {
    const char* msg = "steam unavailable on this platform";
    for (size_t i = 0; i < dcap - 1 && msg[i] != '\0'; i++) detail[i] = msg[i];
    detail[dcap - 1] = '\0';
  }
  return kUnsupportedPlatform;
}
int GetSteamId64(char* out, size_t cap) {
  (void)out;
  (void)cap;
  return kNotInitialized;
}
int HasDlc(uint32_t, int* out) { *out = 0; return kNotInitialized; }
int DlcCount(int* out) { *out = 0; return kNotInitialized; }
int DlcAppId(int, uint32_t* out) { *out = 0; return kNotInitialized; }
int SubscribeWorkshopItem(const char*, int* out) { *out = 0; return kNotInitialized; }
int UnsubscribeWorkshopItem(const char*, int* out) { *out = 0; return kNotInitialized; }
int SubscribedCount(int* out) { *out = 0; return kNotInitialized; }
int SubscribedId(int, char*, size_t) { return kNotInitialized; }
int WorkshopInstallInfo(const char*, char*, size_t, int64_t*, int*) { return kItemNotFound; }
int SetAchievement(const char*, int* out) { *out = 0; return kNotInitialized; }
int AchievementCount(int* out) { *out = 0; return kNotInitialized; }
int AchievementId(int, char*, size_t) { return kNotInitialized; }
int AchievementUnlocked(int, int* out) { *out = 0; return kNotInitialized; }
int Shutdown() { return kOk; }
const char* Version() { return "spellkard-steam/1.0.0 (disabled)"; }
}  // namespace spk_steam

#else  // _WIN32

#include <cerrno>
#include <cstdlib>
#include <cstring>

#include "steam_api.h"

namespace spk_steam {

namespace {

bool g_inited = false;

const char* kDetailInitFailed = "steam_api_init_failed";
const char* kDetailRestartPending = "steam_api_restart_pending";
const char* kDetailNotInit = "steam not initialized";
const char* kDetailBadArg = "bad argument";
const char* kDetailBadId = "published file id out of range";
const char* kDetailItemNotFound = "workshop item not found";

void copyChar(char* dst, size_t cap, const char* src) {
  if (dst == nullptr || cap == 0 || src == nullptr) return;
  size_t i = 0;
  while (i < cap - 1 && src[i] != '\0') {
    dst[i] = src[i];
    i++;
  }
  dst[i] = '\0';
}

void setDetail(char* detail, size_t cap, const char* msg) {
  copyChar(detail, cap, msg);
}

// PublishedFileId_t is uint64; parse a strict decimal string.
bool parsePublishedFileId(const char* text, uint64* out) {
  if (text == nullptr || *text == '\0') return false;
  errno = 0;
  char* end = nullptr;
  const unsigned long long v = std::strtoull(text, &end, 10);
  if (errno != 0 || end == text || *end != '\0') return false;
  *out = static_cast<uint64>(v);
  return true;
}

// Write a uint64 as a decimal string (PublishedFileId_t -> JS string).
void formatPublishedFileId(uint64 v, char* out, size_t cap) {
  if (out == nullptr || cap == 0) return;
  std::snprintf(out, cap, "%llu", static_cast<unsigned long long>(v));
}

// Workshop file type for our custom items. The item type is configured in
// the partner portal; community types map to k_WorkshopFileType_Community_N.
// PHK items use custom type 1 -> keep in sync with the portal setting.
constexpr EWorkshopFileType kWorkshopFileType = k_WorkshopFileType_Community_1;

}  // namespace

int Init(uint32_t appId, char* steamIdOut, size_t steamIdCap,
         char* detailOut, size_t detailCap) {
  copyChar(steamIdOut, steamIdCap, "");
  setDetail(detailOut, detailCap, "");
  if (g_inited) {
    // Re-init: report the existing session (init must be idempotent for the
    // client, which retries after a Steam client launch race).
    CSteamID id = SteamUser()->GetSteamID()->ConvertToSteamID();
    copyChar(steamIdOut, steamIdCap, id.Render());
    setDetail(detailOut, detailCap, "already initialized");
    return kOk;
  }
  // If the user launched the game from a non-Steam shortcut the SDK will
  // re-exec us under the Steam client; the restarted process continues here.
  if (SteamAPI_RestartAppIfNecessary(appId)) {
    setDetail(detailOut, detailCap, kDetailRestartPending);
    return kSteamRestartPending;
  }
  if (!SteamAPI_Init(appId)) {
    setDetail(detailOut, detailCap, kDetailInitFailed);
    return kSteamInitFailed;
  }
  g_inited = true;
  CSteamID id = SteamUser()->GetSteamID()->ConvertToSteamID();
  copyChar(steamIdOut, steamIdCap, id.Render());
  return kOk;
}

int GetSteamId64(char* out, size_t cap) {
  copyChar(out, cap, "");
  if (!g_inited) return kNotInitialized;
  CSteamID id = SteamUser()->GetSteamID()->ConvertToSteamID();
  copyChar(out, cap, id.Render());
  return kOk;
}

int HasDlc(uint32_t appId, int* out) {
  *out = 0;
  if (!g_inited) return kNotInitialized;
  *out = SteamApps()->BHasDlcInstalled(static_cast<AppId_t>(appId)) ? 1 : 0;
  return kOk;
}

int DlcCount(int* out) {
  *out = 0;
  if (!g_inited) return kNotInitialized;
  *out = SteamApps()->GetDLCCount();
  return kOk;
}

int DlcAppId(int index, uint32_t* out) {
  *out = 0;
  if (!g_inited) return kNotInitialized;
  if (index < 0) return kBadArgument;
  char name[128];
  bool installed = false;
  if (!SteamApps()->GetDLCDataByIndex(index, out, name, sizeof(name), &installed)) {
    return kBadArgument;
  }
  return kOk;
}

int SubscribeWorkshopItem(const char* publishedFileId, int* out) {
  *out = 0;
  if (!g_inited) return kNotInitialized;
  uint64 id = 0;
  if (!parsePublishedFileId(publishedFileId, &id)) return kIdParseFailed;
  SteamUGC()->SubscribeToItem(static_cast<PublishedFileId_t>(id), kWorkshopFileType);
  *out = 1;
  return kOk;
}

int UnsubscribeWorkshopItem(const char* publishedFileId, int* out) {
  *out = 0;
  if (!g_inited) return kNotInitialized;
  uint64 id = 0;
  if (!parsePublishedFileId(publishedFileId, &id)) return kIdParseFailed;
  *out = SteamUGC()->UnsubscribeItem(static_cast<PublishedFileId_t>(id)) ? 1 : 0;
  return kOk;
}

int SubscribedCount(int* out) {
  *out = 0;
  if (!g_inited) return kNotInitialized;
  *out = SteamUGC()->GetNumSubscribedItems();
  return kOk;
}

int SubscribedId(int index, char* out, size_t cap) {
  copyChar(out, cap, "");
  if (!g_inited) return kNotInitialized;
  if (index < 0) return kBadArgument;
  PublishedFileId_t id = 0;
  if (!SteamUGC()->GetSubscribedItems(&id, static_cast<unsigned int>(index) + 1)) {
    return kBadArgument;
  }
  // GetSubscribedItems fills [0..index]; the requested one is the last slot.
  formatPublishedFileId(static_cast<uint64>(id), out, cap);
  return kOk;
}

int WorkshopInstallInfo(const char* publishedFileId, char* localPath,
                        size_t localPathCap, int64_t* sizeOut, int* installedOut) {
  copyChar(localPath, localPathCap, "");
  if (sizeOut != nullptr) *sizeOut = 0;
  if (installedOut != nullptr) *installedOut = 0;
  if (!g_inited) return kNotInitialized;
  uint64 id = 0;
  if (!parsePublishedFileId(publishedFileId, &id)) return kIdParseFailed;
  int64_t bytesNeeded = 0;
  int64_t bytesDownloaded = 0;
  char folder[512] = {0};
  uint32_t flags = 0;
  if (!SteamUGC()->GetItemInstallInfo(static_cast<PublishedFileId_t>(id),
                                      &bytesNeeded, &bytesDownloaded, folder,
                                      sizeof(folder), &flags)) {
    return kItemNotFound;
  }
  copyChar(localPath, localPathCap, folder);
  if (sizeOut != nullptr) *sizeOut = bytesDownloaded;
  if (installedOut != nullptr) {
    *installedOut = (flags & k_WorkshopItemFileInstalled) ? 1 : 0;
  }
  return kOk;
}

int SetAchievement(const char* achievementId, int* out) {
  *out = 0;
  if (!g_inited) return kNotInitialized;
  if (achievementId == nullptr || *achievementId == '\0') return kBadArgument;
  if (!SteamUserStats()->SetAchievement(achievementId)) {
    return kBadArgument;  // unknown id in the portal: report, do not crash
  }
  // Persist immediately so a crash before the next StoreStats cannot eat the
  // unlock (Steam also stores on app exit, but not on crash).
  SteamUserStats()->StoreStats();
  *out = 1;
  return kOk;
}

int AchievementCount(int* out) {
  *out = 0;
  if (!g_inited) return kNotInitialized;
  *out = static_cast<int>(SteamUserStats()->NumAchievements());
  return kOk;
}

int AchievementId(int index, char* out, size_t cap) {
  copyChar(out, cap, "");
  if (!g_inited) return kNotInitialized;
  if (index < 0 || index >= SteamUserStats()->NumAchievements()) return kBadArgument;
  int32_t realIndex = -1;
  if (!SteamUserStats()->GetAchievementIndex(static_cast<uint32>(index), &realIndex)) {
    return kBadArgument;
  }
  AchievementData_t data;
  if (!SteamUserStats()->GetAchievement(realIndex, &data)) return kBadArgument;
  copyChar(out, cap, data.m_rgchAchievementName);
  return kOk;
}

int AchievementUnlocked(int index, int* out) {
  *out = 0;
  if (!g_inited) return kNotInitialized;
  if (index < 0 || index >= SteamUserStats()->NumAchievements()) return kBadArgument;
  int32_t realIndex = -1;
  if (!SteamUserStats()->GetAchievementIndex(static_cast<uint32>(index), &realIndex)) {
    return kBadArgument;
  }
  AchievementData_t data;
  if (!SteamUserStats()->GetAchievement(realIndex, &data)) return kBadArgument;
  *out = data.m_bAchieved ? 1 : 0;
  return kOk;
}

int Shutdown() {
  if (!g_inited) return kOk;
  g_inited = false;
  SteamAPI_Shutdown();
  return kOk;
}

const char* Version() { return "spellkard-steam/1.0.0"; }

}  // namespace spk_steam

#endif  // _WIN32
