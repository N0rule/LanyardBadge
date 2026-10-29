#pragma once
namespace reset_test { inline bool files=true,failFiles=false; }
struct FakeFS { bool begin(bool,const char *,int,const char *){return true;} bool format(){if(reset_test::failFiles)return false;reset_test::files=false;return true;} };
inline FakeFS LittleFS;
