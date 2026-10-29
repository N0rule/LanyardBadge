#pragma once
struct Reboot {};
struct FakeEsp { void restart() { throw Reboot{}; } };
inline FakeEsp ESP;
inline void delay(int) {}
