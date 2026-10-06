// Portable non-blocking UDP socket used by the SpellKard LayaNative extension.
//
// This file has no dependency on LayaNative or the JSVM API so it can be built
// and unit-tested on any platform (MSVC on Windows, gcc/clang on Linux/macOS).
// The JSVM glue in main.cpp only wraps this class.
#ifndef SPELLKARD_UDP_SOCKET_H
#define SPELLKARD_UDP_SOCKET_H

#include <cstddef>
#include <cstdint>
#include <string>

namespace spellkard {

// Result codes shared with the JS layer.
enum UdpResult {
  UDP_OK = 0,
  UDP_ERROR = -1,
};

class UdpSocket {
 public:
  UdpSocket();
  ~UdpSocket();

  UdpSocket(const UdpSocket&) = delete;
  UdpSocket& operator=(const UdpSocket&) = delete;

  // Creates the underlying socket. Returns false on failure.
  bool create();

  // Binds to a local address. Use "0.0.0.0" (or "") to bind every interface and
  // port 0 to let the OS pick an ephemeral port.
  bool bind(const std::string& address, uint16_t port);

  // Toggles non-blocking mode. recvFrom() returns 0 immediately when nothing is
  // pending once non-blocking is enabled.
  bool setNonBlocking(bool nonBlocking);

  // Sends a datagram to host:port (host may be a name, resolved with getaddrinfo).
  // Returns the number of bytes sent, or UDP_ERROR.
  int sendTo(const std::string& address, uint16_t port, const uint8_t* data, size_t length);

  // Receives one datagram into `buffer` (up to `capacity` bytes).
  // Returns the byte count, 0 when nothing is pending, or UDP_ERROR on failure.
  // On success `outAddress`/`outPort` hold the sender address.
  int recvFrom(uint8_t* buffer, size_t capacity, std::string& outAddress, uint16_t& outPort);

  // Closes the socket. Safe to call multiple times.
  void close();

  bool valid() const;

  // Local port after bind() (0 when unknown).
  uint16_t localPort() const;

 private:
  // Opaque platform handle; -1 when closed.
  intptr_t handle_ = -1;
  uint16_t localPort_ = 0;
  bool bound_ = false;
};

}  // namespace spellkard

#endif  // SPELLKARD_UDP_SOCKET_H
