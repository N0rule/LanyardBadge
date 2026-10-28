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
    CloseSetup,
    Rotate,
    Restart,
    Storage,
    Select,
    Timeout,
    RevokePairing,
    Theme,
    Back,
    CancelBluetoothPairing
};
enum class Page {
    Badge,
    Menu,
    Gallery,
    Info,
    Calibration,
    Storage,
    Pairing,
    Slideshow,
    Display,
    Settings,
    Advanced,
    RePair,
    BluetoothPairing
};
class Ui {
    Display &display_;
    Touch &touch_;
    Assets &assets_;
    SettingsStore &settings_;
    lv_display_t *lvDisplay_ = nullptr;
    lv_fs_drv_t fs_{};
    Page page_ = Page::Badge, renderedPage_ = Page::Storage;
    bool dirty_ = true, busy_ = false, ignore_ = true;
    Gestures gestures_;
    unsigned selected_ = 0;
    lv_obj_t *touchDot_ = nullptr;
    lv_obj_t *calibrationHint_ = nullptr;
    lv_obj_t *progress_ = nullptr;
    lv_obj_t *progressTitle_ = nullptr, *progressValue_ = nullptr;
    lv_obj_t *progressDetail_ = nullptr, *progressFill_ = nullptr;
    int calibrationStep_ = 0, samples_ = 0;
    int32_t sampleX_ = 0, sampleY_ = 0;
    bool waitingRelease_ = true;
    uint32_t calibrationStarted_ = 0;
    Point rawSamples_[3]{};
    Calibration candidate_;
    ScreenActivity activity_;
    uint32_t flushUs_ = 0, flushMax_ = 0, flushPixels_ = 0, flushCount_ = 0;
    uint32_t handlerMax_ = 0, frameUs_ = 0, framePixels_ = 0, frames_ = 0, frameStart_ = 0;
    uint32_t artworkUs_ = 0;
    UploadPhase uploadPhase_ = UploadPhase::Idle;
    int uploadPercent_ = 0;
    uint32_t uploadChangedAt_ = 0;
    bool streaming_ = true, direct_ = false;
    File animationFile_;
    AnimationDecoder animationDecoder_;
    uint32_t animationDue_ = 0, animationFrames_ = 0, animationMaxUs_ = 0;
    uint32_t animationLastUs_ = 0, animationIoUs_ = 0, animationSpiUs_ = 0;
    uint16_t animationPlays_ = 0;
    bool animationError_ = false;
    bool animationFrame();
    void animate();
    bool pairedOnce_ = false;
    uint32_t nativePasskey_ = UINT32_MAX;
    Page pairingReturn_ = Page::Badge;
    uint32_t renderedTheme_ = 2;
    void render();
    bool streamArtwork();
    void updateControls();
    void renderBadge(lv_obj_t *);
    void calibrationTick();
    lv_obj_t *label(lv_obj_t *, const char *, int, int, int, int, const lv_font_t *, uint32_t);
    lv_obj_t *button(lv_obj_t *, const char *, int action);
    void header(const char *);
    void back();
    uint32_t ink() const { return settings_.value.darkMode ? 0xf2f5f9 : 0x23324d; }
    uint32_t surface() const { return settings_.value.darkMode ? 0x26313e : 0xffffff; }
    uint32_t frost() const { return settings_.value.darkMode ? 0x18212b : 0xf8fafc; }
    uint32_t selectedColor() const { return settings_.value.darkMode ? 0x354d71 : 0xdce8ff; }
    static void event(lv_event_t *);

  public:
    std::function<void(Command, int)> command;
    std::function<String()> info;
    std::function<String()> pairingUrl;
    Ui(Display &d, Touch &t, Assets &a, SettingsStore &s)
        : display_(d), touch_(t), assets_(a), settings_(s) {}
    bool begin();
    void tick();
    void pump();
    void page(Page p);
    void nativePairing(uint32_t passkey);
    void goBack() { back(); }
    void paired() {
        pairedOnce_ = true;
        if (page_ == Page::BluetoothPairing)
            pairingReturn_ = Page::Badge;
        else if (page_ == Page::Pairing)
            page(Page::Badge);
    }
    Page currentPage() const { return page_; }
    void invalidate() { dirty_ = true; }
    void select(unsigned index);
    unsigned selected() const { return selected_; }
    bool badgeVisible() const {
        return page_ == Page::Badge && !busy_ && !touch_.down() && !activity_.asleep();
    }
    bool asleep() const { return activity_.asleep(); }
    void wake() {
        activity_.wake(millis(), touch_.down());
        display_.brightness(settings_.value.brightness);
    }
    void sleep() {
        activity_.sleep();
        display_.brightness(0);
    }
#if defined(BADGE_DIAGNOSTICS) && BADGE_DIAGNOSTICS
    void benchmarkMode(bool streaming) {
        streaming_ = streaming;
        invalidate();
    }
#endif
    void diagnostics(JsonDocument &) const;
#if defined(BADGE_DIAGNOSTICS) && BADGE_DIAGNOSTICS
    void benchmark(bool streaming);
    void benchmarkMenu();
#endif
    void orientation();
    void uploadProgress(UploadPhase phase, int percent = 0);
};
} // namespace badge
