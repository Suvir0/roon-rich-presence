#include "protocol.hpp"

#include <cassert>
#include <string>
#include <variant>

int main() {
  const auto valid = rrp::parse_command(
      R"({"command":"set_activity","request_id":"42","details":"Song","state":"Artist","start_timestamp":100,"end_timestamp":200})");
  assert(std::holds_alternative<rrp::Command>(valid));
  const auto& command = std::get<rrp::Command>(valid);
  assert(command.kind == rrp::CommandKind::set_activity);
  assert(command.activity.details == "Song");
  assert(command.activity.start_timestamp == 100);

  assert(std::holds_alternative<rrp::Command>(rrp::parse_command(R"({"command":"clear"})")));
  assert(std::holds_alternative<rrp::Command>(rrp::parse_command(R"({"command":"shutdown"})")));
  assert(std::holds_alternative<rrp::ParseError>(rrp::parse_command(R"({"command":"wat"})")));
  assert(std::holds_alternative<rrp::ParseError>(
      rrp::parse_command(R"({"command":"set_activity","details":"Song","unknown":true})")));
  assert(std::holds_alternative<rrp::ParseError>(
      rrp::parse_command(R"({"command":"set_activity","details":"Song","start_timestamp":2,"end_timestamp":1})")));
  assert(std::holds_alternative<rrp::ParseError>(rrp::parse_command(
      R"({"command":"set_activity","details":"Song","start_timestamp":9223372036854775807})")));
  assert(std::holds_alternative<rrp::ParseError>(
      rrp::parse_command(R"({"command":"clear","command":"shutdown"})")));
  const auto unicode = rrp::parse_command(
      R"({"command":"set_activity","details":"Beyonc\u00e9 \ud83c\udfb5"})");
  assert(std::holds_alternative<rrp::Command>(unicode));
  assert(std::get<rrp::Command>(unicode).activity.details == "Beyoncé 🎵");
  const std::string invalid_utf8 =
      std::string("{\"command\":\"set_activity\",\"details\":\"") + static_cast<char>(0xff) + "\"}";
  assert(std::holds_alternative<rrp::ParseError>(rrp::parse_command(invalid_utf8)));

  const std::string too_long(rrp::kMaximumLineBytes + 1, 'x');
  assert(std::holds_alternative<rrp::ParseError>(rrp::parse_command(too_long)));
  assert(rrp::json_escape("a\n\"b") == "a\\n\\\"b");
  return 0;
}
