#include "protocol.hpp"

#include <charconv>
#include <cctype>
#include <cstdint>
#include <limits>
#include <map>
#include <string>
#include <utility>
#include <variant>

namespace rrp {
namespace {

using Value = std::variant<std::string, std::int64_t, bool, std::nullptr_t>;

bool append_utf8(std::uint32_t codepoint, std::string& output) {
  if (codepoint <= 0x7f) {
    output.push_back(static_cast<char>(codepoint));
  } else if (codepoint <= 0x7ff) {
    output.push_back(static_cast<char>(0xc0 | (codepoint >> 6)));
    output.push_back(static_cast<char>(0x80 | (codepoint & 0x3f)));
  } else if (codepoint <= 0xffff) {
    if (codepoint >= 0xd800 && codepoint <= 0xdfff) return false;
    output.push_back(static_cast<char>(0xe0 | (codepoint >> 12)));
    output.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3f)));
    output.push_back(static_cast<char>(0x80 | (codepoint & 0x3f)));
  } else if (codepoint <= 0x10ffff) {
    output.push_back(static_cast<char>(0xf0 | (codepoint >> 18)));
    output.push_back(static_cast<char>(0x80 | ((codepoint >> 12) & 0x3f)));
    output.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3f)));
    output.push_back(static_cast<char>(0x80 | (codepoint & 0x3f)));
  } else {
    return false;
  }
  return true;
}

bool decode_hex4(std::string_view input, std::size_t& position, std::uint32_t& value) {
  if (position + 4 > input.size()) return false;
  value = 0;
  for (int index = 0; index < 4; ++index) {
    const unsigned char character = static_cast<unsigned char>(input[position++]);
    value <<= 4;
    if (character >= '0' && character <= '9') value |= character - '0';
    else if (character >= 'a' && character <= 'f') value |= character - 'a' + 10;
    else if (character >= 'A' && character <= 'F') value |= character - 'A' + 10;
    else return false;
  }
  return true;
}

bool valid_utf8(std::string_view value) {
  std::size_t index = 0;
  while (index < value.size()) {
    const auto first = static_cast<unsigned char>(value[index++]);
    if (first <= 0x7f) continue;
    std::uint32_t codepoint{};
    std::size_t continuation_count{};
    if (first >= 0xc2 && first <= 0xdf) {
      codepoint = first & 0x1f;
      continuation_count = 1;
    } else if (first >= 0xe0 && first <= 0xef) {
      codepoint = first & 0x0f;
      continuation_count = 2;
    } else if (first >= 0xf0 && first <= 0xf4) {
      codepoint = first & 0x07;
      continuation_count = 3;
    } else {
      return false;
    }
    if (index + continuation_count > value.size()) return false;
    for (std::size_t count = 0; count < continuation_count; ++count) {
      const auto next = static_cast<unsigned char>(value[index++]);
      if ((next & 0xc0) != 0x80) return false;
      codepoint = (codepoint << 6) | (next & 0x3f);
    }
    if ((continuation_count == 1 && codepoint < 0x80) ||
        (continuation_count == 2 && codepoint < 0x800) ||
        (continuation_count == 3 && codepoint < 0x10000) || codepoint > 0x10ffff ||
        (codepoint >= 0xd800 && codepoint <= 0xdfff)) {
      return false;
    }
  }
  return true;
}

class Parser {
 public:
  explicit Parser(std::string_view input) : input_(input) {}

  std::variant<std::map<std::string, Value>, ParseError> parse() {
    skip_space();
    if (!take('{')) return error("invalid_json", "command must be a JSON object");
    std::map<std::string, Value> object;
    skip_space();
    if (take('}')) return finish(std::move(object));

    while (true) {
      auto key = parse_string(64);
      if (std::holds_alternative<ParseError>(key)) return std::get<ParseError>(key);
      skip_space();
      if (!take(':')) return error("invalid_json", "expected ':' after object key");
      skip_space();
      auto value = parse_value();
      if (std::holds_alternative<ParseError>(value)) return std::get<ParseError>(value);
      const auto key_string = std::get<std::string>(std::move(key));
      if (!object.emplace(key_string, std::get<Value>(std::move(value))).second) {
        return error("duplicate_key", "duplicate object key");
      }
      skip_space();
      if (take('}')) return finish(std::move(object));
      if (!take(',')) return error("invalid_json", "expected ',' or '}'");
      skip_space();
    }
  }

 private:
  std::variant<Value, ParseError> parse_value() {
    if (peek() == '"') {
      auto string = parse_string(4096);
      if (std::holds_alternative<ParseError>(string)) return std::get<ParseError>(string);
      return Value{std::get<std::string>(std::move(string))};
    }
    if (consume_literal("true")) return Value{true};
    if (consume_literal("false")) return Value{false};
    if (consume_literal("null")) return Value{nullptr};

    const auto number_start = pos_;
    if (peek() == '-') ++pos_;
    while (std::isdigit(static_cast<unsigned char>(peek()))) ++pos_;
    if (pos_ == number_start || (pos_ == number_start + 1 && input_[number_start] == '-')) {
      return error("invalid_json", "only string, integer, boolean, and null values are allowed");
    }
    std::int64_t number{};
    const auto* begin = input_.data() + number_start;
    const auto* end = input_.data() + pos_;
    const auto parsed = std::from_chars(begin, end, number);
    if (parsed.ec != std::errc{} || parsed.ptr != end) {
      return error("invalid_json", "integer is out of range");
    }
    return Value{number};
  }

  std::variant<std::string, ParseError> parse_string(std::size_t maximum) {
    if (!take('"')) return error("invalid_json", "expected a JSON string");
    std::string output;
    while (pos_ < input_.size()) {
      const unsigned char character = static_cast<unsigned char>(input_[pos_++]);
      if (character == '"') return output;
      if (character < 0x20) return error("invalid_json", "control character in string");
      if (character == '\\') {
        if (pos_ >= input_.size()) return error("invalid_json", "truncated escape sequence");
        const char escaped = input_[pos_++];
        switch (escaped) {
          case '"': output.push_back('"'); break;
          case '\\': output.push_back('\\'); break;
          case '/': output.push_back('/'); break;
          case 'b': output.push_back('\b'); break;
          case 'f': output.push_back('\f'); break;
          case 'n': output.push_back('\n'); break;
          case 'r': output.push_back('\r'); break;
          case 't': output.push_back('\t'); break;
          case 'u': {
            std::uint32_t codepoint{};
            if (!decode_hex4(input_, pos_, codepoint)) {
              return error("invalid_json", "invalid Unicode escape sequence");
            }
            if (codepoint >= 0xd800 && codepoint <= 0xdbff) {
              if (pos_ + 2 > input_.size() || input_[pos_] != '\\' || input_[pos_ + 1] != 'u') {
                return error("invalid_json", "high surrogate is missing a low surrogate");
              }
              pos_ += 2;
              std::uint32_t low{};
              if (!decode_hex4(input_, pos_, low) || low < 0xdc00 || low > 0xdfff) {
                return error("invalid_json", "invalid low surrogate");
              }
              codepoint = 0x10000 + ((codepoint - 0xd800) << 10) + (low - 0xdc00);
            }
            if (!append_utf8(codepoint, output)) {
              return error("invalid_json", "invalid Unicode codepoint");
            }
            break;
          }
          default: return error("invalid_json", "unsupported escape sequence");
        }
      } else {
        output.push_back(static_cast<char>(character));
      }
      if (output.size() > maximum) return error("value_too_long", "string value exceeds its limit");
    }
    return error("invalid_json", "unterminated string");
  }

  std::variant<std::map<std::string, Value>, ParseError> finish(std::map<std::string, Value> object) {
    skip_space();
    if (pos_ != input_.size()) return error("invalid_json", "trailing data after command");
    return object;
  }

  bool consume_literal(std::string_view literal) {
    if (input_.substr(pos_, literal.size()) != literal) return false;
    pos_ += literal.size();
    return true;
  }
  char peek() const { return pos_ < input_.size() ? input_[pos_] : '\0'; }
  bool take(char expected) {
    if (peek() != expected) return false;
    ++pos_;
    return true;
  }
  void skip_space() {
    while (pos_ < input_.size() && std::isspace(static_cast<unsigned char>(input_[pos_]))) ++pos_;
  }
  ParseError error(std::string code, std::string message) const {
    return ParseError{std::move(code), std::move(message)};
  }

  std::string_view input_;
  std::size_t pos_{0};
};

}  // namespace

ParseResult parse_command(std::string_view line) {
  if (line.empty()) return ParseError{"empty_command", "command line is empty"};
  if (line.size() > kMaximumLineBytes) return ParseError{"line_too_long", "command exceeds 16384 bytes"};
  auto parsed = Parser(line).parse();
  if (std::holds_alternative<ParseError>(parsed)) return std::get<ParseError>(std::move(parsed));
  auto object = std::get<std::map<std::string, Value>>(std::move(parsed));

  const auto string_value = [&object](const char* key, std::size_t maximum,
                                      bool required = false) -> std::variant<std::string, ParseError> {
    const auto it = object.find(key);
    if (it == object.end()) {
      if (required) return ParseError{"missing_field", std::string("missing '") + key + "'"};
      return std::string{};
    }
    if (!std::holds_alternative<std::string>(it->second)) {
      return ParseError{"invalid_field", std::string("'") + key + "' must be a string"};
    }
    auto value = std::get<std::string>(it->second);
    if (!valid_utf8(value)) {
      return ParseError{"invalid_utf8", std::string("'") + key + "' must contain valid UTF-8"};
    }
    if (value.size() > maximum) {
      return ParseError{"value_too_long", std::string("'") + key + "' exceeds its byte limit"};
    }
    return value;
  };
  const auto integer_value = [&object](const char* key)
      -> std::variant<std::optional<std::int64_t>, ParseError> {
    const auto it = object.find(key);
    if (it == object.end() || std::holds_alternative<std::nullptr_t>(it->second)) {
      return std::optional<std::int64_t>{};
    }
    if (!std::holds_alternative<std::int64_t>(it->second)) {
      return ParseError{"invalid_field", std::string("'") + key + "' must be an integer or null"};
    }
    const auto value = std::get<std::int64_t>(it->second);
    if (value < 0) return ParseError{"invalid_field", std::string("'") + key + "' cannot be negative"};
    return std::optional<std::int64_t>{value};
  };

  auto command_value = string_value("command", 32, true);
  if (std::holds_alternative<ParseError>(command_value)) return std::get<ParseError>(command_value);
  auto request_id_value = string_value("request_id", 128);
  if (std::holds_alternative<ParseError>(request_id_value)) return std::get<ParseError>(request_id_value);
  Command command{};
  command.request_id = std::get<std::string>(std::move(request_id_value));
  const auto command_name = std::get<std::string>(std::move(command_value));
  if (command_name == "clear") command.kind = CommandKind::clear;
  else if (command_name == "shutdown") command.kind = CommandKind::shutdown;
  else if (command_name == "set_activity") command.kind = CommandKind::set_activity;
  else return ParseError{"unknown_command", "unsupported command"};

  static const std::map<std::string, bool> allowed{{"command", true}, {"request_id", true},
      {"details", true}, {"state", true}, {"large_image", true}, {"large_text", true},
      {"small_image", true}, {"small_text", true}, {"start_timestamp", true},
      {"end_timestamp", true}};
  for (const auto& [key, _] : object) {
    if (!allowed.contains(key)) return ParseError{"unknown_field", "unsupported field: " + key};
  }
  if (command.kind != CommandKind::set_activity) {
    if (object.size() > (object.contains("request_id") ? 2U : 1U)) {
      return ParseError{"invalid_field", "clear and shutdown do not accept activity fields"};
    }
    return command;
  }

  const auto assign_string = [&](const char* key, std::size_t maximum, std::string& destination,
                                 bool required = false) -> std::optional<ParseError> {
    auto value = string_value(key, maximum, required);
    if (std::holds_alternative<ParseError>(value)) return std::get<ParseError>(value);
    destination = std::get<std::string>(std::move(value));
    return std::nullopt;
  };
  if (auto error = assign_string("details", 128, command.activity.details, true)) return *error;
  if (command.activity.details.empty()) return ParseError{"invalid_field", "'details' cannot be empty"};
  if (auto error = assign_string("state", 128, command.activity.state)) return *error;
  if (auto error = assign_string("large_image", 256, command.activity.large_image)) return *error;
  if (auto error = assign_string("large_text", 128, command.activity.large_text)) return *error;
  if (auto error = assign_string("small_image", 256, command.activity.small_image)) return *error;
  if (auto error = assign_string("small_text", 128, command.activity.small_text)) return *error;
  auto start = integer_value("start_timestamp");
  if (std::holds_alternative<ParseError>(start)) return std::get<ParseError>(start);
  command.activity.start_timestamp = std::get<std::optional<std::int64_t>>(start);
  auto end = integer_value("end_timestamp");
  if (std::holds_alternative<ParseError>(end)) return std::get<ParseError>(end);
  command.activity.end_timestamp = std::get<std::optional<std::int64_t>>(end);
  constexpr auto maximum_seconds = std::numeric_limits<std::int64_t>::max() / 1000;
  if ((command.activity.start_timestamp && *command.activity.start_timestamp > maximum_seconds) ||
      (command.activity.end_timestamp && *command.activity.end_timestamp > maximum_seconds)) {
    return ParseError{"invalid_field", "timestamp is too large to convert to milliseconds"};
  }
  if (command.activity.start_timestamp && command.activity.end_timestamp &&
      *command.activity.end_timestamp < *command.activity.start_timestamp) {
    return ParseError{"invalid_field", "end_timestamp cannot precede start_timestamp"};
  }
  return command;
}

std::string json_escape(std::string_view value) {
  std::string output;
  output.reserve(value.size() + 8);
  for (const unsigned char character : value) {
    switch (character) {
      case '"': output += "\\\""; break;
      case '\\': output += "\\\\"; break;
      case '\b': output += "\\b"; break;
      case '\f': output += "\\f"; break;
      case '\n': output += "\\n"; break;
      case '\r': output += "\\r"; break;
      case '\t': output += "\\t"; break;
      default:
        if (character < 0x20) {
          static constexpr char hex[] = "0123456789abcdef";
          output += "\\u00";
          output.push_back(hex[(character >> 4) & 0x0f]);
          output.push_back(hex[character & 0x0f]);
        } else {
          output.push_back(static_cast<char>(character));
        }
    }
  }
  return output;
}

}  // namespace rrp
