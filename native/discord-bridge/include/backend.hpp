#pragma once

#include "protocol.hpp"

#include <cstdint>
#include <memory>
#include <string>

namespace rrp {

struct BackendResult {
  bool ok{false};
  bool connected{false};
  std::string message;
};

class DiscordBackend {
 public:
  virtual ~DiscordBackend() = default;
  virtual std::string mode() const = 0;
  virtual bool connected() const = 0;
  virtual BackendResult set_activity(const Activity& activity) = 0;
  virtual BackendResult clear_activity() = 0;
  virtual void pump_callbacks() = 0;
};

std::unique_ptr<DiscordBackend> make_backend(std::uint64_t application_id);

}  // namespace rrp
