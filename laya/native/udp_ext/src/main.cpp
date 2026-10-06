// SpellKard LayaNative UDP extension.
//
// Exposes a non-blocking UDP socket to JS as the global object `spk_udp`
// (the `extension.name` in spk_udp.layaext.json). The JS layer wraps it in
// `src/platform/native/native_udp_datagram.ts`, which implements the core
// `DatagramLike` contract so KCP can run over raw UDP on native builds.
//
// JS API (all methods are on the `spk_udp` global):
//
//   spk_udp.version(): string
//   spk_udp.create(): number                       // handle, or -1
//   spk_udp.bind(handle, address, port): number    // 1 ok, 0 fail
//   spk_udp.setNonBlocking(handle, flag): number   // 1 ok, 0 fail
//   spk_udp.sendTo(handle, address, port, data): number  // bytes, or -1
//   spk_udp.recvFrom(handle, buffer): number       // bytes, 0 none, -1 error
//   spk_udp.lastRecvAddress(handle): string        // "ip:port" of last datagram
//   spk_udp.localPort(handle): number
//   spk_udp.close(handle): number
//
// `buffer`/`data` are ArrayBuffers. `recvFrom` writes into the caller's buffer
// and returns the byte count; the sender address is read back with
// `lastRecvAddress`. This keeps the JSVM surface small (no object/array
// construction) and is safe because JS is single-threaded and polls each tick.

#include <extension/LayaExtension.h>

#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <string>

#include "udp_socket.h"

namespace {

struct Entry {
  spellkard::UdpSocket socket;
  std::string lastAddress;
  uint16_t lastPort = 0;
};

std::mutex& registryMutex() {
  static std::mutex mutex;
  return mutex;
}

std::map<int, std::unique_ptr<Entry>>& registry() {
  static std::map<int, std::unique_ptr<Entry>> entries;
  return entries;
}

int nextHandle = 1;

Entry* findEntry(int handle) {
  auto& entries = registry();
  const auto found = entries.find(handle);
  return found == entries.end() ? nullptr : found->second.get();
}

bool argInt(jsvm_env env, jsvm_value* argv, size_t argc, size_t index, int32_t& out) {
  if (index >= argc) {
    return false;
  }
  int32_t value = 0;
  if (jsvm_get_value_int32(env, argv[index], &value) != 0) {
    return false;
  }
  out = value;
  return true;
}

bool argString(jsvm_env env, jsvm_value* argv, size_t argc, size_t index, std::string& out) {
  if (index >= argc) {
    return false;
  }
  char buffer[512];
  std::memset(buffer, 0, sizeof(buffer));
  size_t length = 0;
  if (jsvm_get_value_string_utf8(env, argv[index], buffer, sizeof(buffer) - 1, &length) != 0) {
    return false;
  }
  if (length >= sizeof(buffer) - 1) {
    return false;
  }
  buffer[length] = '\0';
  out.assign(buffer, length);
  return true;
}

bool argBuffer(jsvm_env env, jsvm_value* argv, size_t argc, size_t index, void** data, size_t* length) {
  if (index >= argc) {
    return false;
  }
  return jsvm_get_arraybuffer_info(env, argv[index], data, length) == 0;
}

jsvm_value makeInt(jsvm_env env, int32_t value) {
  jsvm_value result;
  jsvm_create_int32(env, value, &result);
  return result;
}

jsvm_value makeString(jsvm_env env, const std::string& value) {
  jsvm_value result;
  jsvm_create_string_utf8(env, value.c_str(), value.size(), &result);
  return result;
}

// --- registered functions --------------------------------------------------

jsvm_value jsVersion(jsvm_env env, jsvm_callback_info info) {
  (void)info;
  return makeString(env, "spellkard-udp/1.0.0");
}

jsvm_value jsCreate(jsvm_env env, jsvm_callback_info info) {
  (void)info;
  auto entry = std::make_unique<Entry>();
  if (!entry->socket.create()) {
    return makeInt(env, -1);
  }
  std::lock_guard<std::mutex> lock(registryMutex());
  const int handle = nextHandle++;
  registry()[handle] = std::move(entry);
  return makeInt(env, handle);
}

jsvm_value jsBind(jsvm_env env, jsvm_callback_info info) {
  size_t argc = 3;
  jsvm_value argv[3];
  jsvm_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  int32_t handle = 0;
  int32_t port = 0;
  std::string address;
  if (!argInt(env, argv, argc, 0, handle) || !argString(env, argv, argc, 1, address) ||
      !argInt(env, argv, argc, 2, port)) {
    return makeInt(env, 0);
  }
  std::lock_guard<std::mutex> lock(registryMutex());
  Entry* entry = findEntry(handle);
  if (entry == nullptr) {
    return makeInt(env, 0);
  }
  return makeInt(env, entry->socket.bind(address, static_cast<uint16_t>(port)) ? 1 : 0);
}

jsvm_value jsSetNonBlocking(jsvm_env env, jsvm_callback_info info) {
  size_t argc = 2;
  jsvm_value argv[2];
  jsvm_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  int32_t handle = 0;
  int32_t flag = 0;
  if (!argInt(env, argv, argc, 0, handle) || !argInt(env, argv, argc, 1, flag)) {
    return makeInt(env, 0);
  }
  std::lock_guard<std::mutex> lock(registryMutex());
  Entry* entry = findEntry(handle);
  if (entry == nullptr) {
    return makeInt(env, 0);
  }
  return makeInt(env, entry->socket.setNonBlocking(flag != 0) ? 1 : 0);
}

jsvm_value jsSendTo(jsvm_env env, jsvm_callback_info info) {
  size_t argc = 4;
  jsvm_value argv[4];
  jsvm_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  int32_t handle = 0;
  int32_t port = 0;
  std::string address;
  void* data = nullptr;
  size_t length = 0;
  if (!argInt(env, argv, argc, 0, handle) || !argString(env, argv, argc, 1, address) ||
      !argInt(env, argv, argc, 2, port) || !argBuffer(env, argv, argc, 3, &data, &length)) {
    return makeInt(env, -1);
  }
  std::lock_guard<std::mutex> lock(registryMutex());
  Entry* entry = findEntry(handle);
  if (entry == nullptr) {
    return makeInt(env, -1);
  }
  return makeInt(env, entry->socket.sendTo(address, static_cast<uint16_t>(port),
                                            static_cast<const uint8_t*>(data), length));
}

jsvm_value jsRecvFrom(jsvm_env env, jsvm_callback_info info) {
  size_t argc = 2;
  jsvm_value argv[2];
  jsvm_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  int32_t handle = 0;
  void* buffer = nullptr;
  size_t capacity = 0;
  if (!argInt(env, argv, argc, 0, handle) || !argBuffer(env, argv, argc, 1, &buffer, &capacity)) {
    return makeInt(env, -1);
  }
  std::lock_guard<std::mutex> lock(registryMutex());
  Entry* entry = findEntry(handle);
  if (entry == nullptr) {
    return makeInt(env, -1);
  }
  std::string address;
  uint16_t port = 0;
  const int received = entry->socket.recvFrom(static_cast<uint8_t*>(buffer), capacity, address, port);
  if (received > 0) {
    entry->lastAddress = address;
    entry->lastPort = port;
  }
  return makeInt(env, received);
}

jsvm_value jsLastRecvAddress(jsvm_env env, jsvm_callback_info info) {
  size_t argc = 1;
  jsvm_value argv[1];
  jsvm_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  int32_t handle = 0;
  if (!argInt(env, argv, argc, 0, handle)) {
    return makeString(env, "");
  }
  std::lock_guard<std::mutex> lock(registryMutex());
  Entry* entry = findEntry(handle);
  if (entry == nullptr) {
    return makeString(env, "");
  }
  return makeString(env, entry->lastAddress + ":" + std::to_string(entry->lastPort));
}

jsvm_value jsLocalPort(jsvm_env env, jsvm_callback_info info) {
  size_t argc = 1;
  jsvm_value argv[1];
  jsvm_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  int32_t handle = 0;
  if (!argInt(env, argv, argc, 0, handle)) {
    return makeInt(env, 0);
  }
  std::lock_guard<std::mutex> lock(registryMutex());
  Entry* entry = findEntry(handle);
  return makeInt(env, entry == nullptr ? 0 : static_cast<int32_t>(entry->socket.localPort()));
}

jsvm_value jsClose(jsvm_env env, jsvm_callback_info info) {
  size_t argc = 1;
  jsvm_value argv[1];
  jsvm_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  int32_t handle = 0;
  if (!argInt(env, argv, argc, 0, handle)) {
    return makeInt(env, 0);
  }
  std::lock_guard<std::mutex> lock(registryMutex());
  auto& entries = registry();
  const auto found = entries.find(handle);
  if (found == entries.end()) {
    return makeInt(env, 0);
  }
  found->second->socket.close();
  entries.erase(found);
  return makeInt(env, 1);
}

void registerFunction(jsvm_env env, jsvm_value exports, const char* name, jsvm_callback callback) {
  jsvm_value fn;
  jsvm_create_function(env, name, JSVM_AUTO_LENGTH, callback, nullptr, &fn);
  jsvm_set_named_property(env, exports, name, fn);
}

int onEvent(LayaExtEventType event, const LayaExtensionInterface* iface, void* userData) {
  (void)userData;
  if (event == LAYA_EXT_EVENT_INIT && iface != nullptr) {
    jsvm_env env = iface->get_env();
    jsvm_value exports = iface->get_exports();
    registerFunction(env, exports, "version", jsVersion);
    registerFunction(env, exports, "create", jsCreate);
    registerFunction(env, exports, "bind", jsBind);
    registerFunction(env, exports, "setNonBlocking", jsSetNonBlocking);
    registerFunction(env, exports, "sendTo", jsSendTo);
    registerFunction(env, exports, "recvFrom", jsRecvFrom);
    registerFunction(env, exports, "lastRecvAddress", jsLastRecvAddress);
    registerFunction(env, exports, "localPort", jsLocalPort);
    registerFunction(env, exports, "close", jsClose);
  } else if (event == LAYA_EXT_EVENT_DESTROY) {
    std::lock_guard<std::mutex> lock(registryMutex());
    for (auto& item : registry()) {
      item.second->socket.close();
    }
    registry().clear();
  }
  return 0;
}

int extInit(const LayaExtensionInterface* engine, LayaExtensionInitInfo* info) {
  (void)engine;
  info->api_version = LAYA_EXTENSION_API_VERSION;
  info->name = "spk_udp";
  info->version = "1.0.0";
  info->on_event = onEvent;
  info->user_data = nullptr;
  return 0;
}

}  // namespace

LAYA_EXTENSION_ENTRY(extInit)
LAYA_EXTENSION_ENTRY_NAMED(spk_udp, extInit)
