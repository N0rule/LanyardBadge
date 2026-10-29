#pragma once
#include <string>
namespace reset_test { inline bool pending=false, settings=true, failSettings=false, failJournal=false; }
struct Preferences {
 std::string ns;
 bool begin(const char *name,bool) { ns=name;return !(ns=="badge-reset" && reset_test::failJournal); }
 bool getBool(const char *,bool) { return reset_test::pending; }
 int putBool(const char *,bool v) { reset_test::pending=v;return 1; }
 bool clear() { if(reset_test::failSettings)return false;reset_test::settings=false;return true; }
 bool remove(const char *) { reset_test::pending=false;return true; }
 void end() {}
};
