#pragma once
#include <stdint.h>
#include <string.h>
namespace badge {
class EditorCode {
    uint32_t value_ = UINT32_MAX, started_ = 0, blockedAt_ = 0;
    unsigned failures_ = 0;
    bool blocked_ = false;

  public:
    static constexpr uint32_t combinations = 26 * 26 * 26 * 26;
    void begin(uint32_t value, uint32_t now) {
        value_ = value % combinations;
        started_ = now;
    }
    void close() { value_ = UINT32_MAX; }
    bool blocked(uint32_t now) {
        if (blocked_ && uint32_t(now - blockedAt_) >= 30000) {
            blocked_ = false;
            failures_ = 0;
        }
        return blocked_;
    }
    uint32_t display(uint32_t now) const {
        return uint32_t(now - started_) < 120000 ? value_ : UINT32_MAX;
    }
    static void letters(uint32_t value, char out[5]) {
        for (int i = 3; i >= 0; --i) {
            out[i] = 'A' + value % 26;
            value /= 26;
        }
        out[4] = 0;
    }
    int check(const char *input, uint32_t now) {
        if (blocked(now))
            return 429;
        if (display(now) == UINT32_MAX)
            return 403;
        char expected[5];
        letters(value_, expected);
        bool match = input && strlen(input) == 4;
        for (unsigned i = 0; match && i < 4; ++i) {
            char c = input[i];
            if (c >= 'a' && c <= 'z')
                c -= 'a' - 'A';
            match = c == expected[i];
        }
        if (match) {
            close();
            failures_ = 0;
            return 200;
        }
        if (++failures_ >= 5) {
            blocked_ = true;
            blockedAt_ = now;
            close();
            return 429;
        }
        return 401;
    }
};
} // namespace badge
