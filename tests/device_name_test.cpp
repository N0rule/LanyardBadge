#include "../src/core/DeviceName.h"
#include <cassert>
int main() {
    using badge::validDeviceName;
    assert(validDeviceName("My Badge"));
    assert(validDeviceName("123456789012345678901234"));
    assert(!validDeviceName("1234567890123456789012345"));
    assert(!validDeviceName(""));
    assert(!validDeviceName(nullptr));
    assert(!validDeviceName(" Leading"));
    assert(!validDeviceName("Trailing "));
    assert(!validDeviceName("Line\nbreak"));
    assert(!validDeviceName("\xff"));
}
