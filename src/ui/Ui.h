#pragma once
#include "../hardware/Display.h"
#include "../hardware/Touch.h"
#include "../storage/Assets.h"
#include "../storage/Settings.h"
#include <functional>
#include <lvgl.h>
namespace badge {
enum class Command {
    Next,
    Previous,
    Brightness,
    Autoplay,
    Interval,
    DefaultCard,
    Setup,
    WifiSetup,
    CloseSetup,
    Rotate,
    Restart,
    Storage,
    Select
};
enum class Page { Badge, Menu, Gallery, Info, Diagnostics, Calibration, Setup, Storage, Pairing };
class Ui {
    Display &display_;
    Touch &touch_;
    Assets &assets_;
    SettingsStore &settings_;
    lv_display_t *lvDisplay_ = nullptr;
    lv_fs_drv_t fs_{};
    Page page_ = Page::Badge;
    bool dirty_ = true, busy_ = false, ignore_ = true;
    Gestures gestures_;
    unsigned selected_ = 0;
    lv_obj_t *touchDot_ = nullptr;
    lv_obj_t *calibrationHint_ = nullptr;
    lv_obj_t *progress_ = nullptr;
    int calibrationStep_ = 0, samples_ = 0;
    int32_t sampleX_ = 0, sampleY_ = 0;
    bool waitingRelease_ = true;
    uint32_t calibrationStarted_ = 0;
    Point rawSamples_[3]{};
    Calibration candidate_;
    void render();
    void renderBadge(lv_obj_t *);
    void calibrationTick();
    lv_obj_t *label(lv_obj_t *, const char *, int, int, int, int, const lv_font_t *, uint32_t);
    lv_obj_t *button(lv_obj_t *, const char *, int action);
    void header(const char *);
    static void event(lv_event_t *);

  public:
    std::function<void(Command, int)> command;
    std::function<String()> info;
    std::function<String()> editorUrl;
    std::function<String()> connectionHint;
    std::function<String()> pairingUrl;
    std::function<String()> bluetoothName;
    Ui(Display &d, Touch &t, Assets &a, SettingsStore &s)
        : display_(d), touch_(t), assets_(a), settings_(s) {}
    bool begin();
    void tick();
    void pump();
    void page(Page p);
    Page currentPage() const { return page_; }
    void invalidate() { dirty_ = true; }
    void select(unsigned index);
    unsigned selected() const { return selected_; }
    bool badgeVisible() const { return page_ == Page::Badge && !busy_ && !touch_.down(); }
    void orientation();
    void uploadProgress(int percent);
};
} // namespace badge
