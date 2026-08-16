#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <variant>

namespace rrp {

inline constexpr std::size_t kMaximumLineBytes = 16 * 1024;

struct Activity {
  std::string details;
  std::string state;
  std::string large_image;
  std::string large_text;
  std::string small_image;
  std::string small_text;
  std::optional<std::int64_t> start_timestamp;
  std::optional<std::int64_t> end_timestamp;
};

enum class CommandKind { set_activity, clear, shutdown };

struct Command {
  CommandKind kind;
  std::string request_id;
  Activity activity;
};

struct ParseError {
  std::string code;
  std::string message;
};

using ParseResult = std::variant<Command, ParseError>;

ParseResult parse_command(std::string_view line);
std::string json_escape(std::string_view value);

}  // namespace rrp
