#pragma once
#include <Arduino.h>
namespace badge {
// The journal has its own namespace so erasing application settings cannot erase it.
bool requestFactoryReset();
void resumeFactoryReset();
} // namespace badge
