// Standalone smoke test for the portable UDP core (no LayaNative/JSVM needed).
//
// Binds two loopback sockets, sends a datagram from A to B, receives it on B,
// replies, and verifies both the payload and the sender addresses. Exits 0 on
// success so CI can run it with `./spk_udp_selftest`.

#include <cstdio>
#include <cstring>
#include <string>

#include "udp_socket.h"

namespace {

int failures = 0;

void check(bool condition, const char* message) {
  if (condition) {
    std::printf("  ok   %s\n", message);
  } else {
    std::printf("  FAIL %s\n", message);
    failures += 1;
  }
}

}  // namespace

int main() {
  spellkard::UdpSocket server;
  spellkard::UdpSocket client;
  check(server.bind("127.0.0.1", 0), "server binds to an ephemeral port");
  check(client.bind("127.0.0.1", 0), "client binds to an ephemeral port");
  check(server.setNonBlocking(true), "server set to non-blocking");
  check(client.setNonBlocking(true), "client set to non-blocking");
  check(server.localPort() != 0, "server reports its local port");

  const char* request = "ping";
  const int sent = client.sendTo("127.0.0.1", server.localPort(),
                                 reinterpret_cast<const uint8_t*>(request), std::strlen(request));
  check(sent == static_cast<int>(std::strlen(request)), "client sends the request");

  uint8_t buffer[64];
  std::string address;
  uint16_t port = 0;
  int received = 0;
  for (int attempt = 0; attempt < 100 && received == 0; ++attempt) {
    received = server.recvFrom(buffer, sizeof(buffer), address, port);
  }
  check(received == 4, "server receives 4 bytes");
  check(std::memcmp(buffer, request, 4) == 0, "payload matches");
  check(address == "127.0.0.1", "sender address is loopback");
  check(port == client.localPort(), "sender port matches the client");

  // Non-blocking recv with an empty queue returns 0, not an error.
  check(server.recvFrom(buffer, sizeof(buffer), address, port) == 0, "empty queue returns 0");

  const char* reply = "pong";
  const int replySent = server.sendTo("127.0.0.1", port, reinterpret_cast<const uint8_t*>(reply),
                                      std::strlen(reply));
  check(replySent == 4, "server replies");
  int replyReceived = 0;
  for (int attempt = 0; attempt < 100 && replyReceived == 0; ++attempt) {
    replyReceived = client.recvFrom(buffer, sizeof(buffer), address, port);
  }
  check(replyReceived == 4 && std::memcmp(buffer, reply, 4) == 0, "client receives the reply");

  server.close();
  client.close();
  check(!server.valid(), "server socket is closed");

  std::printf("%s\n", failures == 0 ? "udp core: all checks passed" : "udp core: FAILURES");
  return failures == 0 ? 0 : 1;
}
