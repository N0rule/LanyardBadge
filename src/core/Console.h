#pragma once
#include <Arduino.h>
namespace badge {
// Release diagnostics must never interleave a framed USB response.
inline bool serialEditing = false;
struct Console {
    template <class... Args> static void print(Args... args) {
        if (!serialEditing)
            Serial.print(args...);
    }
    template <class... Args> static void println(Args... args) {
        if (!serialEditing)
            Serial.println(args...);
    }
    template <class... Args> static void printf(Args... args) {
        if (!serialEditing)
            Serial.printf(args...);
    }
};
} // namespace badge
