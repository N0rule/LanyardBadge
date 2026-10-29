#pragma once
namespace reset_test { inline bool bonds=true,failBonds=false; }
struct NimBLEDevice { static void init(const char *){} static bool deleteAllBonds(){if(reset_test::failBonds)return false;reset_test::bonds=false;return true;} };
