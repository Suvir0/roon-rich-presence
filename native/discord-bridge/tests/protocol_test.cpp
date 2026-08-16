#include "protocol.hpp"

#include <iostream>
#include <string>
#include <variant>

int main() {
  int failures = 0;
  const auto expect = [&failures](const bool condition, const char* message) {
    if (!condition) {
      std::cerr << "FAILED: " << message << '\n';
      ++failures;
    }
  };

  const auto valid = rrp::parse_command(
      R"({"command":"set_activity","request_id":"42","details":"Song","state":"Artist","start_timestamp":100,"end_timestamp":200})");
  expect(std::holds_alternative<rrp::Command>(valid), "set_activity command parses");
  if (const auto* command = std::get_if<rrp::Command>(&valid)) {
    expect(command->kind == rrp::CommandKind::set_activity, "command kind is set_activity");
    expect(command->activity.details == "Song", "activity details are preserved");
    expect(command->activity.start_timestamp == 100, "start timestamp is preserved");
  }

  expect(std::holds_alternative<rrp::Command>(rrp::parse_command(R"({"command":"clear"})")),
         "clear command parses");
  expect(std::holds_alternative<rrp::Command>(rrp::parse_command(R"({"command":"shutdown"})")),
         "shutdown command parses");
  expect(std::holds_alternative<rrp::ParseError>(rrp::parse_command(R"({"command":"wat"})")),
         "unknown commands are rejected");
  expect(std::holds_alternative<rrp::ParseError>(
             rrp::parse_command(R"({"command":"set_activity","details":"Song","unknown":true})")),
         "unknown fields are rejected");
  expect(std::holds_alternative<rrp::ParseError>(rrp::parse_command(
             R"({"command":"set_activity","details":"Song","start_timestamp":2,"end_timestamp":1})")),
         "backward timestamps are rejected");
  expect(std::holds_alternative<rrp::ParseError>(rrp::parse_command(
             R"({"command":"set_activity","details":"Song","start_timestamp":9223372036854775807})")),
         "unsafe timestamps are rejected");
  expect(std::holds_alternative<rrp::ParseError>(
             rrp::parse_command(R"({"command":"clear","command":"shutdown"})")),
         "duplicate command keys are rejected");
  const auto unicode = rrp::parse_command(
      R"({"command":"set_activity","details":"Beyonc\u00e9 \ud83c\udfb5"})");
  expect(std::holds_alternative<rrp::Command>(unicode), "unicode command parses");
  if (const auto* command = std::get_if<rrp::Command>(&unicode)) {
    expect(command->activity.details == "Beyoncé 🎵", "unicode escapes are decoded");
  }
  const std::string invalid_utf8 =
      std::string("{\"command\":\"set_activity\",\"details\":\"") + static_cast<char>(0xff) + "\"}";
  expect(std::holds_alternative<rrp::ParseError>(rrp::parse_command(invalid_utf8)),
         "invalid UTF-8 is rejected");

  const std::string too_long(rrp::kMaximumLineBytes + 1, 'x');
  expect(std::holds_alternative<rrp::ParseError>(rrp::parse_command(too_long)),
         "oversized commands are rejected");
  expect(rrp::json_escape("a\n\"b") == "a\\n\\\"b", "JSON output is escaped");
  return failures == 0 ? 0 : 1;
}
