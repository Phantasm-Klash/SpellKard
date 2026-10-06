#include "udp_socket.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32.lib")
typedef int socklen_type;
typedef SOCKET socket_type;
#else
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>
typedef socklen_t socklen_type;
typedef int socket_type;
#endif

namespace spellkard {
namespace {

#ifdef _WIN32
// Winsock requires a process-wide WSAStartup/WSACleanup pair; refcount so the
// extension can be loaded and unloaded safely.
int& winsockRefCount() {
  static int count = 0;
  return count;
}

bool ensureWinsock() {
  if (winsockRefCount() == 0) {
    WSADATA data;
    if (WSAStartup(MAKEWORD(2, 2), &data) != 0) {
      return false;
    }
  }
  winsockRefCount() += 1;
  return true;
}

void releaseWinsock() {
  if (winsockRefCount() > 0) {
    winsockRefCount() -= 1;
    if (winsockRefCount() == 0) {
      WSACleanup();
    }
  }
}

void closeSocket(intptr_t handle) { closesocket(static_cast<SOCKET>(handle)); }

int lastSocketError() { return WSAGetLastError(); }

bool wouldBlock(int error) { return error == WSAEWOULDBLOCK; }

#else

bool ensureWinsock() { return true; }
void releaseWinsock() {}

void closeSocket(intptr_t handle) { ::close(static_cast<int>(handle)); }

int lastSocketError() { return errno; }

bool wouldBlock(int error) { return error == EAGAIN || error == EWOULDBLOCK; }

#endif

// Builds a sockaddr from host:port. Returns false when resolution fails.
bool resolve(const std::string& address, uint16_t port, bool passive, sockaddr_storage& out,
             socklen_type& outLength, int& outFamily) {
  addrinfo hints;
  std::memset(&hints, 0, sizeof(hints));
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_DGRAM;
  hints.ai_protocol = IPPROTO_UDP;
  hints.ai_flags = passive ? AI_PASSIVE : 0;

  char portText[16];
  std::snprintf(portText, sizeof(portText), "%u", static_cast<unsigned>(port));
  const char* host = address.empty() ? nullptr : address.c_str();

  addrinfo* result = nullptr;
  if (getaddrinfo(host, portText, &hints, &result) != 0 || result == nullptr) {
    return false;
  }
  std::memcpy(&out, result->ai_addr, result->ai_addrlen);
  outLength = static_cast<socklen_type>(result->ai_addrlen);
  outFamily = result->ai_family;
  freeaddrinfo(result);
  return true;
}

}  // namespace

UdpSocket::UdpSocket() = default;

UdpSocket::~UdpSocket() { close(); }

bool UdpSocket::create() {
  if (handle_ >= 0) {
    return true;
  }
  if (!ensureWinsock()) {
    return false;
  }
  const socket_type handle = ::socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
  if (handle < 0) {
    releaseWinsock();
    return false;
  }
  handle_ = static_cast<intptr_t>(handle);
  return true;
}

bool UdpSocket::bind(const std::string& address, uint16_t port) {
  sockaddr_storage storage;
  socklen_type length = 0;
  int family = AF_INET;
  if (!resolve(address, port, true, storage, length, family)) {
    return false;
  }
  // Create the socket only once the bind family is known, so an IPv4 bind uses
  // an IPv4 socket (the battle endpoint is IPv4 today).
  if (handle_ >= 0) {
    close();
  }
  if (!ensureWinsock()) {
    return false;
  }
  const socket_type handle = ::socket(family, SOCK_DGRAM, IPPROTO_UDP);
  if (handle < 0) {
    releaseWinsock();
    return false;
  }
  handle_ = static_cast<intptr_t>(handle);
  if (::bind(handle, reinterpret_cast<sockaddr*>(&storage), length) != 0) {
    close();
    return false;
  }
  bound_ = true;

  sockaddr_storage local;
  socklen_type localLength = sizeof(local);
  if (::getsockname(handle, reinterpret_cast<sockaddr*>(&local), &localLength) == 0) {
    if (local.ss_family == AF_INET) {
      localPort_ = ntohs(reinterpret_cast<sockaddr_in*>(&local)->sin_port);
    } else if (local.ss_family == AF_INET6) {
      localPort_ = ntohs(reinterpret_cast<sockaddr_in6*>(&local)->sin6_port);
    }
  }
  return true;
}

bool UdpSocket::setNonBlocking(bool nonBlocking) {
  if (!valid()) {
    return false;
  }
#ifdef _WIN32
  u_long mode = nonBlocking ? 1UL : 0UL;
  return ioctlsocket(static_cast<SOCKET>(handle_), FIONBIO, &mode) == 0;
#else
  int flags = fcntl(static_cast<int>(handle_), F_GETFL, 0);
  if (flags < 0) {
    return false;
  }
  if (nonBlocking) {
    flags |= O_NONBLOCK;
  } else {
    flags &= ~O_NONBLOCK;
  }
  return fcntl(static_cast<int>(handle_), F_SETFL, flags) == 0;
#endif
}

int UdpSocket::sendTo(const std::string& address, uint16_t port, const uint8_t* data, size_t length) {
  if (!valid()) {
    return UDP_ERROR;
  }
  sockaddr_storage storage;
  socklen_type storageLength = 0;
  int family = AF_INET;
  if (!resolve(address, port, false, storage, storageLength, family)) {
    return UDP_ERROR;
  }
  const socket_type handle = static_cast<socket_type>(handle_);
  const int sent = static_cast<int>(::sendto(handle, reinterpret_cast<const char*>(data),
                                             static_cast<int>(length), 0,
                                             reinterpret_cast<sockaddr*>(&storage), storageLength));
  if (sent < 0) {
    return UDP_ERROR;
  }
  return sent;
}

int UdpSocket::recvFrom(uint8_t* buffer, size_t capacity, std::string& outAddress, uint16_t& outPort) {
  if (!valid() || buffer == nullptr || capacity == 0) {
    return UDP_ERROR;
  }
  sockaddr_storage storage;
  socklen_type storageLength = sizeof(storage);
  const socket_type handle = static_cast<socket_type>(handle_);
  const int received = static_cast<int>(::recvfrom(handle, reinterpret_cast<char*>(buffer),
                                                   static_cast<int>(capacity), 0,
                                                   reinterpret_cast<sockaddr*>(&storage), &storageLength));
  if (received < 0) {
    const int error = lastSocketError();
    if (wouldBlock(error)) {
      return 0;
    }
    return UDP_ERROR;
  }
  char host[NI_MAXHOST];
  char service[NI_MAXSERV];
  host[0] = '\0';
  service[0] = '\0';
  if (getnameinfo(reinterpret_cast<sockaddr*>(&storage), storageLength, host, sizeof(host), service,
                  sizeof(service), NI_NUMERICHOST | NI_NUMERICSERV) == 0) {
    outAddress = host;
    outPort = static_cast<uint16_t>(std::atoi(service));
  } else {
    outAddress.clear();
    outPort = 0;
  }
  return received;
}

void UdpSocket::close() {
  if (handle_ >= 0) {
    closeSocket(handle_);
    handle_ = -1;
    bound_ = false;
    localPort_ = 0;
    releaseWinsock();
  }
}

bool UdpSocket::valid() const { return handle_ >= 0; }

uint16_t UdpSocket::localPort() const { return localPort_; }

}  // namespace spellkard
