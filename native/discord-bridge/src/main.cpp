#include "backend.hpp"
#include "protocol.hpp"

#include <algorithm>
#include <charconv>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <iostream>
#include <memory>
#include <string>
#include <string_view>
#include <thread>

#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#else
#include <cerrno>
#include <poll.h>
#include <unistd.h>
#endif

namespace {

void emit_error(std::string_view code, std::string_view message, std::string_view request_id = {}) {
  std::cout << "{\"event\":\"error\",\"code\":\"" << rrp::json_escape(code)
            << "\",\"message\":\"" << rrp::json_escape(message) << '"';
  if (!request_id.empty()) std::cout << ",\"request_id\":\"" << rrp::json_escape(request_id) << '"';
  std::cout << "}\n" << std::flush;
}

void emit_status(std::string_view operation, const rrp::BackendResult& result,
                 std::string_view request_id) {
  std::cout << "{\"event\":\"status\",\"operation\":\"" << rrp::json_escape(operation)
            << "\",\"ok\":" << (result.ok ? "true" : "false")
            << ",\"connected\":" << (result.connected ? "true" : "false");
  if (!request_id.empty()) std::cout << ",\"request_id\":\"" << rrp::json_escape(request_id) << '"';
  if (!result.message.empty()) std::cout << ",\"message\":\"" << rrp::json_escape(result.message) << '"';
  std::cout << "}\n" << std::flush;
}

void emit_connection(bool connected) {
  std::cout << "{\"event\":\"" << (connected ? "connected" : "disconnected")
            << "\",\"connected\":" << (connected ? "true" : "false") << "}\n"
            << std::flush;
}

bool parse_application_id(int argc, char** argv, std::uint64_t& application_id) {
  if (argc != 3 || std::string_view(argv[1]) != "--application-id") return false;
  const std::string_view value(argv[2]);
  const auto parsed = std::from_chars(value.data(), value.data() + value.size(), application_id);
  return parsed.ec == std::errc{} && parsed.ptr == value.data() + value.size() && application_id != 0;
}

enum class InputState { idle, line, too_long, end_of_stream, error };

struct InputEvent {
  InputState state{InputState::idle};
  std::string line;
};

class InputReader {
 public:
  InputEvent next(std::chrono::milliseconds timeout) {
    if (!pending_.empty()) return pop_pending();

    char bytes[4096];
    const auto count = read_available(bytes, sizeof(bytes), timeout);
    if (count > 0) {
      consume(bytes, static_cast<std::size_t>(count));
      return pending_.empty() ? InputEvent{} : pop_pending();
    }
    if (count == kEndOfStream) {
      if (discarding_) pending_.push_back({InputState::too_long, {}});
      else if (!buffer_.empty()) pending_.push_back({InputState::line, std::move(buffer_)});
      pending_.push_back({InputState::end_of_stream, {}});
      buffer_.clear();
      discarding_ = false;
      return pop_pending();
    }
    if (count == kReadError) return {InputState::error, {}};
    return {};
  }

 private:
  static constexpr std::ptrdiff_t kNoData = 0;
  static constexpr std::ptrdiff_t kEndOfStream = -1;
  static constexpr std::ptrdiff_t kReadError = -2;

  std::ptrdiff_t read_available(char* bytes, std::size_t capacity,
                                std::chrono::milliseconds timeout) {
#ifdef _WIN32
    const HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
    if (input == nullptr || input == INVALID_HANDLE_VALUE) return kReadError;
    DWORD available{};
    if (!PeekNamedPipe(input, nullptr, 0, nullptr, &available, nullptr)) {
      return GetLastError() == ERROR_BROKEN_PIPE ? kEndOfStream : kReadError;
    }
    if (available == 0) {
      std::this_thread::sleep_for(timeout);
      return kNoData;
    }
    DWORD read{};
    const auto requested = static_cast<DWORD>(std::min<std::size_t>(capacity, available));
    if (!ReadFile(input, bytes, requested, &read, nullptr)) {
      return GetLastError() == ERROR_BROKEN_PIPE ? kEndOfStream : kReadError;
    }
    return read == 0 ? kEndOfStream : static_cast<std::ptrdiff_t>(read);
#else
    pollfd descriptor{STDIN_FILENO, static_cast<short>(POLLIN | POLLHUP), 0};
    const int ready = poll(&descriptor, 1, static_cast<int>(timeout.count()));
    if (ready == 0) return kNoData;
    if (ready < 0) return errno == EINTR ? kNoData : kReadError;
    if ((descriptor.revents & (POLLERR | POLLNVAL)) != 0) return kReadError;
    const auto read_count = read(STDIN_FILENO, bytes, capacity);
    if (read_count > 0) return read_count;
    if (read_count == 0) return kEndOfStream;
    return errno == EINTR || errno == EAGAIN ? kNoData : kReadError;
#endif
  }

  void consume(const char* bytes, std::size_t count) {
    for (std::size_t index = 0; index < count; ++index) {
      if (bytes[index] == '\n') {
        pending_.push_back(discarding_ ? InputEvent{InputState::too_long, {}}
                                      : InputEvent{InputState::line, std::move(buffer_)});
        buffer_.clear();
        discarding_ = false;
      } else if (!discarding_ && buffer_.size() < rrp::kMaximumLineBytes) {
        buffer_.push_back(bytes[index]);
      } else {
        discarding_ = true;
      }
    }
  }

  InputEvent pop_pending() {
    auto event = std::move(pending_.front());
    pending_.pop_front();
    return event;
  }

  std::deque<InputEvent> pending_;
  std::string buffer_;
  bool discarding_{false};
};

}  // namespace

int main(int argc, char** argv) {
  std::ios::sync_with_stdio(false);
  std::uint64_t application_id{};
  if (!parse_application_id(argc, argv, application_id)) {
    emit_error("invalid_arguments", "usage: roon-discord-bridge --application-id <positive uint64>");
    return 64;
  }

  std::unique_ptr<rrp::DiscordBackend> backend;
  try {
    backend = rrp::make_backend(application_id);
  } catch (const std::exception& error) {
    emit_error("backend_initialization_failed", error.what());
    return 70;
  }
  std::cout << "{\"event\":\"ready\",\"mode\":\"" << rrp::json_escape(backend->mode())
            << "\",\"connected\":" << (backend->connected() ? "true" : "false") << "}\n"
            << std::flush;

  InputReader input;
  bool last_connected = backend->connected();
  while (true) {
    const auto event = input.next(std::chrono::milliseconds(16));
    backend->pump_callbacks();
    if (backend->connected() != last_connected) {
      last_connected = backend->connected();
      emit_connection(last_connected);
    }
    if (event.state == InputState::idle) continue;
    if (event.state == InputState::end_of_stream) break;
    if (event.state == InputState::error) {
      emit_error("stdin_error", "failed to read command stream");
      break;
    }
    if (event.state == InputState::too_long) {
      emit_error("line_too_long", "command exceeds 16384 bytes");
      continue;
    }
    auto parsed = rrp::parse_command(event.line);
    if (std::holds_alternative<rrp::ParseError>(parsed)) {
      const auto& error = std::get<rrp::ParseError>(parsed);
      emit_error(error.code, error.message);
      continue;
    }
    const auto& command = std::get<rrp::Command>(parsed);
    backend->pump_callbacks();
    switch (command.kind) {
      case rrp::CommandKind::set_activity:
        emit_status("set_activity", backend->set_activity(command.activity), command.request_id);
        break;
      case rrp::CommandKind::clear:
        emit_status("clear", backend->clear_activity(), command.request_id);
        break;
      case rrp::CommandKind::shutdown:
        emit_status("shutdown", backend->clear_activity(), command.request_id);
        return 0;
    }
    backend->pump_callbacks();
    last_connected = backend->connected();
  }

  backend->clear_activity();
  return 0;
}
