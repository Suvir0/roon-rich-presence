#include "backend.hpp"

#include <cstdint>
#include <memory>
#include <string>

namespace rrp {
namespace {

class StubBackend final : public DiscordBackend {
 public:
  explicit StubBackend(std::uint64_t application_id) : application_id_(application_id) {}
  std::string mode() const override { return "stub"; }
  bool connected() const override { return false; }
  BackendResult set_activity(const Activity&) override {
    return {true, false, "development stub accepted activity; Discord was not updated"};
  }
  BackendResult clear_activity() override {
    return {true, false, "development stub cleared activity state"};
  }
  void pump_callbacks() override {}

 private:
  [[maybe_unused]] std::uint64_t application_id_;
};

}  // namespace

std::unique_ptr<DiscordBackend> make_backend(std::uint64_t application_id) {
  return std::make_unique<StubBackend>(application_id);
}

}  // namespace rrp
