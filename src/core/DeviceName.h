#pragma once
#include <stddef.h>
namespace badge {
inline bool validDeviceName(const char *name) {
    if (!name || !name[0] || name[0] == ' ')
        return false;
    size_t n = 0;
    for (; name[n]; ++n)
        if (n >= 24 || name[n] < 32 || name[n] > 126)
            return false;
    return name[n - 1] != ' ';
}
} // namespace badge
