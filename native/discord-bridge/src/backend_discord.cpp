#include "backend.hpp"

#define DISCORDPP_IMPLEMENTATION
#include "discordpp.h"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <utility>

namespace rrp {
namespace {

using Clock = std::chrono::steady_clock;
constexpr auto kRefreshInterval = std::chrono::seconds(20);
constexpr auto kMaximumRetryDelay = std::chrono::seconds(60);

std::string discord_text(std::string value) {
  // SDK 1.10.18687 requires textual presence fields to contain at least two
  // characters. Preserve legitimate one-character ASCII titles and artists.
  if (value.size() == 1) value += "\xE2\x80\x8B";  // zero-width space
  return value;
}

// Keep every vendor API call in this translation unit. When Discord changes a
// generated C++ binding, no protocol or Electron-facing code needs to change.
class SocialSdkBackend final : public DiscordBackend {
 public:
  explicit SocialSdkBackend(std::uint64_t application_id)
      : client_(std::make_shared<discordpp::Client>()) {
    // Direct Rich Presence intentionally does not call Connect(). The SDK's
    // desktop Rich Presence path only needs the public Application ID and a
    // running Discord desktop client, so no Discord OAuth is introduced.
    client_->SetApplicationId(application_id);
  }

  std::string mode() const override { return "discord-social-sdk"; }
  bool connected() const override { return connected_; }

  BackendResult set_activity(const Activity& source) override {
    desired_ = source;
    ++desired_generation_;
    retry_attempt_ = 0;
    next_attempt_ = Clock::now();
    last_result_.reset();
    submit_desired();
    discordpp::RunCallbacks();

    if (last_result_ == false) return {false, false, "Discord rejected the activity"};
    if (last_result_ == true) return {true, true, ""};
    return {true, connected_, "activity queued; awaiting Discord callback"};
  }

  BackendResult clear_activity() override {
    desired_.reset();
    ++desired_generation_;
    retry_attempt_ = 0;
    client_->ClearRichPresence();
    discordpp::RunCallbacks();
    return {true, connected_, ""};
  }

  void pump_callbacks() override {
    discordpp::RunCallbacks();
    if (desired_ && !update_in_flight_ && Clock::now() >= next_attempt_) submit_desired();
  }

 private:
  discordpp::Activity make_sdk_activity(const Activity& source) const {
    discordpp::Activity activity;
    activity.SetType(discordpp::ActivityTypes::Listening);
    activity.SetDetails(discord_text(source.details));
    if (!source.state.empty()) activity.SetState(discord_text(source.state));

    discordpp::ActivityAssets assets;
    bool has_assets = false;
    if (!source.large_image.empty()) {
      assets.SetLargeImage(source.large_image);
      has_assets = true;
    }
    if (!source.large_text.empty()) {
      assets.SetLargeText(discord_text(source.large_text));
      has_assets = true;
    }
    if (!source.small_image.empty()) {
      assets.SetSmallImage(source.small_image);
      has_assets = true;
    }
    if (!source.small_text.empty()) {
      assets.SetSmallText(discord_text(source.small_text));
      has_assets = true;
    }
    if (has_assets) activity.SetAssets(std::move(assets));

    if (source.start_timestamp || source.end_timestamp) {
      discordpp::ActivityTimestamps timestamps;
      // The bridge protocol uses Unix seconds. SDK 1.10.18687 documents
      // milliseconds, so convert explicitly instead of using its legacy
      // "small-ish value" conversion heuristic.
      if (source.start_timestamp) {
        timestamps.SetStart(static_cast<std::uint64_t>(*source.start_timestamp) * 1000U);
      }
      if (source.end_timestamp) {
        timestamps.SetEnd(static_cast<std::uint64_t>(*source.end_timestamp) * 1000U);
      }
      activity.SetTimestamps(std::move(timestamps));
    }
    return activity;
  }

  void submit_desired() {
    if (!desired_ || update_in_flight_) return;
    update_in_flight_ = true;
    last_result_.reset();
    const auto submitted_generation = desired_generation_;
    client_->UpdateRichPresence(make_sdk_activity(*desired_),
                                [this, submitted_generation](discordpp::ClientResult result) {
                                  update_in_flight_ = false;
                                  const auto now = Clock::now();
                                  if (!desired_ || submitted_generation != desired_generation_) {
                                    next_attempt_ = now;
                                    return;
                                  }
                                  connected_ = result.Successful();
                                  last_result_ = connected_;
                                  if (connected_) {
                                    retry_attempt_ = 0;
                                    next_attempt_ = now + kRefreshInterval;
                                  } else {
                                    retry_attempt_ = std::min(retry_attempt_ + 1U, 6U);
                                    const auto delay = std::min(
                                        std::chrono::seconds(1U << retry_attempt_),
                                        kMaximumRetryDelay);
                                    next_attempt_ = now + delay;
                                  }
                                });
  }

  std::shared_ptr<discordpp::Client> client_;
  std::optional<Activity> desired_;
  std::optional<bool> last_result_;
  Clock::time_point next_attempt_{Clock::now()};
  unsigned int retry_attempt_{0};
  std::uint64_t desired_generation_{0};
  bool update_in_flight_{false};
  bool connected_{false};
};

}  // namespace

std::unique_ptr<DiscordBackend> make_backend(std::uint64_t application_id) {
  return std::make_unique<SocialSdkBackend>(application_id);
}

}  // namespace rrp
