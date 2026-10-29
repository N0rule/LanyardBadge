#include "../src/storage/FactoryReset.cpp"
#include <cassert>
int main() {
    using namespace reset_test;
    badge::resumeFactoryReset();
    assert(files && settings && bonds && !pending);
    failJournal = true;
    assert(!badge::requestFactoryReset());
    try {
        badge::resumeFactoryReset();
        assert(false);
    } catch (Reboot &) {}
    assert(files && settings && bonds);
    failJournal = false;
    for (int failure = 0; failure < 3; ++failure) {
        files = settings = bonds = true;
        assert(badge::requestFactoryReset());
        failFiles = failure == 0;
        failSettings = failure == 1;
        failBonds = failure == 2;
        try {
            badge::resumeFactoryReset();
            assert(false);
        } catch (Reboot &) {
        }
        assert(pending);
        failFiles = failSettings = failBonds = false;
        try {
            badge::resumeFactoryReset();
            assert(false);
        } catch (Reboot &) {
        }
        assert(!pending && !files && !settings && !bonds);
        badge::resumeFactoryReset();
    }
}
