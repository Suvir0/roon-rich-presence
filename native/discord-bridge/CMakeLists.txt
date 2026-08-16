cmake_minimum_required(VERSION 3.22)

project(roon_discord_bridge VERSION 0.1.2 LANGUAGES CXX)

option(RRP_DISCORD_STUB "Build without the Discord Social SDK (development and CI only)" ON)
option(RRP_BUILD_TESTS "Build bridge protocol tests" ON)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

include(GNUInstallDirs)

add_library(rrp_protocol STATIC
  src/protocol.cpp
)
target_include_directories(rrp_protocol PUBLIC include)
target_compile_features(rrp_protocol PUBLIC cxx_std_20)

add_executable(roon-discord-bridge
  src/main.cpp
)
set_target_properties(roon-discord-bridge PROPERTIES OUTPUT_NAME "discord-bridge")
target_include_directories(roon-discord-bridge PRIVATE include)
target_link_libraries(roon-discord-bridge PRIVATE rrp_protocol)

if(RRP_DISCORD_STUB)
  target_sources(roon-discord-bridge PRIVATE src/backend_stub.cpp)
  target_compile_definitions(roon-discord-bridge PRIVATE RRP_DISCORD_STUB=1)
else()
  if(NOT DEFINED DISCORD_SOCIAL_SDK_ROOT)
    message(FATAL_ERROR "Set DISCORD_SOCIAL_SDK_ROOT to the extracted official Discord Social SDK")
  endif()

  set(RRP_DISCORD_SDK_ROOT "${DISCORD_SOCIAL_SDK_ROOT}")
  if(EXISTS "${DISCORD_SOCIAL_SDK_ROOT}/discord_social_sdk/include/discordpp.h")
    set(RRP_DISCORD_SDK_ROOT "${DISCORD_SOCIAL_SDK_ROOT}/discord_social_sdk")
  endif()

  find_path(DISCORD_SOCIAL_SDK_INCLUDE_DIR
    NAMES discordpp.h
    PATHS "${RRP_DISCORD_SDK_ROOT}"
    PATH_SUFFIXES include include/cpp
    NO_DEFAULT_PATH
    REQUIRED
  )
  if(APPLE AND EXISTS "${RRP_DISCORD_SDK_ROOT}/lib/release/libdiscord_partner_sdk.dylib")
    set(DISCORD_SOCIAL_SDK_LIBRARY
      "${RRP_DISCORD_SDK_ROOT}/lib/release/libdiscord_partner_sdk.dylib")
    set(DISCORD_SOCIAL_SDK_RUNTIME "${DISCORD_SOCIAL_SDK_LIBRARY}")
  else()
    find_library(DISCORD_SOCIAL_SDK_LIBRARY
      NAMES discord_partner_sdk discord_social_sdk
      PATHS "${RRP_DISCORD_SDK_ROOT}"
      PATH_SUFFIXES
        lib
        lib/release
        lib/x86_64
        lib/x86_64/release
        lib/arm64
        lib/arm64/release
        lib/release/x86_64
        lib/release/arm64
      NO_DEFAULT_PATH
      REQUIRED
    )
    if(WIN32)
      find_file(DISCORD_SOCIAL_SDK_RUNTIME
        NAMES discord_partner_sdk.dll
        PATHS "${RRP_DISCORD_SDK_ROOT}"
        PATH_SUFFIXES bin/release bin/release/arm64
        NO_DEFAULT_PATH
        REQUIRED
      )
    elseif(UNIX)
      find_file(DISCORD_SOCIAL_SDK_RUNTIME
        NAMES libdiscord_partner_sdk.so
        PATHS "${RRP_DISCORD_SDK_ROOT}"
        PATH_SUFFIXES lib/release
        NO_DEFAULT_PATH
        REQUIRED
      )
    endif()
  endif()

  target_sources(roon-discord-bridge PRIVATE src/backend_discord.cpp)
  target_include_directories(roon-discord-bridge PRIVATE "${DISCORD_SOCIAL_SDK_INCLUDE_DIR}")
  target_link_libraries(roon-discord-bridge PRIVATE "${DISCORD_SOCIAL_SDK_LIBRARY}")
  target_compile_definitions(roon-discord-bridge PRIVATE RRP_DISCORD_STUB=0)

  if(APPLE)
    set_target_properties(roon-discord-bridge PROPERTIES
      BUILD_RPATH "@loader_path"
      INSTALL_RPATH "@loader_path"
    )
  elseif(UNIX)
    set_target_properties(roon-discord-bridge PROPERTIES
      BUILD_RPATH "$ORIGIN"
      INSTALL_RPATH "$ORIGIN"
    )
  endif()

  install(FILES "${DISCORD_SOCIAL_SDK_RUNTIME}" DESTINATION "${CMAKE_INSTALL_BINDIR}")
  if(EXISTS "${RRP_DISCORD_SDK_ROOT}/License-Notices.txt")
    install(FILES "${RRP_DISCORD_SDK_ROOT}/License-Notices.txt"
      DESTINATION "${CMAKE_INSTALL_BINDIR}"
      RENAME "DiscordSocialSdk-License-Notices.txt")
  endif()
endif()

if(MSVC)
  target_compile_options(rrp_protocol PRIVATE /W4 /WX /permissive-)
  target_compile_options(roon-discord-bridge PRIVATE /W4 /WX /permissive-)
else()
  target_compile_options(rrp_protocol PRIVATE -Wall -Wextra -Wpedantic -Werror)
  target_compile_options(roon-discord-bridge PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()

install(TARGETS roon-discord-bridge RUNTIME DESTINATION "${CMAKE_INSTALL_BINDIR}")

if(RRP_BUILD_TESTS)
  enable_testing()
  add_executable(protocol-tests tests/protocol_test.cpp)
  target_link_libraries(protocol-tests PRIVATE rrp_protocol)
  if(MSVC)
    target_compile_options(protocol-tests PRIVATE /W4 /WX /permissive-)
  else()
    target_compile_options(protocol-tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
  add_test(NAME protocol-tests COMMAND protocol-tests)
endif()
