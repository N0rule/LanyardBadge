#include "Ui.h"
#include "../core/CachedReader.h"
#include "Board.h"
#include <algorithm>
#include <esp_heap_caps.h>
#include <new>
static void *graphicsPool = nullptr;
extern "C" void *badge_lv_pool(size_t) {
    return graphicsPool;
}
namespace badge {
namespace {
alignas(4) uint8_t buffer[board::width * 32 * 2];
struct ImageFile {
    File source;
    CachedReader<4096> reader;
};
constexpr uint32_t ink = 0x23324d, blue = 0x3659d9, frost = 0xf3f6fc;
constexpr Point targets[] = {{24, 24}, {215, 24}, {24, 295}, {215, 295}};
const lv_font_t *font(unsigned n) {
    return n == 28   ? &lv_font_montserrat_28
           : n == 20 ? &lv_font_montserrat_20
                     : &lv_font_montserrat_14;
}
void plain(lv_obj_t *o) {
    lv_obj_remove_style_all(o);
    lv_obj_remove_flag(o, LV_OBJ_FLAG_SCROLLABLE);
}
} // namespace
bool Ui::begin() {
    graphicsPool = heap_caps_malloc(LV_MEM_SIZE, MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL);
    if (!graphicsPool)
        return false;
    lv_init();
    lv_tick_set_cb([] { return millis(); });
    lv_log_register_print_cb([](lv_log_level_t, const char *msg) { Serial.print(msg); });
    lvDisplay_ = lv_display_create(board::width, board::height);
    if (!lvDisplay_)
        return false;
    lv_display_set_user_data(lvDisplay_, this);
    lv_display_set_color_format(lvDisplay_, LV_COLOR_FORMAT_RGB565);
    lv_display_set_buffers(lvDisplay_, buffer, nullptr, sizeof(buffer),
                           LV_DISPLAY_RENDER_MODE_PARTIAL);
    lv_display_set_flush_cb(lvDisplay_, [](lv_display_t *d, const lv_area_t *a, uint8_t *p) {
        auto *u = static_cast<Ui *>(lv_display_get_user_data(d));
        uint32_t started = micros();
        if (!u->frameStart_)
            u->frameStart_ = started;
        u->display_.flushArea(a, p);
        uint32_t duration = micros() - started;
        u->flushUs_ += duration;
        u->flushMax_ = std::max(u->flushMax_, duration);
        u->flushPixels_ += lv_area_get_size(a);
        ++u->flushCount_;
        u->framePixels_ += lv_area_get_size(a);
        if (lv_display_flush_is_last(d)) {
            u->frameUs_ = micros() - u->frameStart_;
            u->frameStart_ = 0;
            ++u->frames_;
        }
        lv_display_flush_ready(d);
    });
    lv_fs_drv_init(&fs_);
    fs_.letter = 'B';
    fs_.cache_size = 0;
    fs_.open_cb = [](lv_fs_drv_t *, const char *path, lv_fs_mode_t mode) -> void * {
        if (mode != LV_FS_MODE_RD)
            return nullptr;
        auto *file = new (std::nothrow) ImageFile;
        if (!file)
            return nullptr;
        file->source = LittleFS.open(path, "r");
        if (!file->source) {
            delete file;
            return nullptr;
        }
        return file;
    };
    fs_.close_cb = [](lv_fs_drv_t *, void *pointer) {
        delete static_cast<ImageFile *>(pointer);
        return LV_FS_RES_OK;
    };
    fs_.read_cb = [](lv_fs_drv_t *, void *pointer, void *output, uint32_t length, uint32_t *read) {
        auto *file = static_cast<ImageFile *>(pointer);
        *read = file->reader.read(file->source, output, length);
        return *read == length ? LV_FS_RES_OK : LV_FS_RES_FS_ERR;
    };
    fs_.seek_cb = [](lv_fs_drv_t *, void *pointer, uint32_t n, lv_fs_whence_t whence) {
        auto *file = static_cast<ImageFile *>(pointer);
        uint64_t pos = whence == LV_FS_SEEK_SET   ? n
                       : whence == LV_FS_SEEK_CUR ? uint64_t(file->reader.position()) + n
                                                  : uint64_t(file->source.size()) + n;
        return pos <= file->source.size() && file->reader.seek(pos, file->source.size())
                   ? LV_FS_RES_OK
                   : LV_FS_RES_FS_ERR;
    };
    fs_.tell_cb = [](lv_fs_drv_t *, void *pointer, uint32_t *pos) {
        *pos = static_cast<ImageFile *>(pointer)->reader.position();
        return LV_FS_RES_OK;
    };
    lv_fs_drv_register(&fs_);
    auto *input = lv_indev_create();
    lv_indev_set_type(input, LV_INDEV_TYPE_POINTER);
    lv_indev_set_user_data(input, this);
    lv_indev_set_read_cb(input, [](lv_indev_t *i, lv_indev_data_t *data) {
        auto *u = static_cast<Ui *>(lv_indev_get_user_data(i));
        Point p = u->touch_.point();
        data->point = {p.x, p.y};
        data->state = u->touch_.down() && !u->activity_.asleep() && !u->activity_.consumed() &&
                              u->page_ != Page::Calibration && !u->ignore_
                          ? LV_INDEV_STATE_PRESSED
                          : LV_INDEV_STATE_RELEASED;
    });
    lv_indev_set_display(input, lvDisplay_);
    orientation();
    for (unsigned i = 0; i < assets_.deck.count; ++i)
        if (!strcmp(assets_.deck.cards[i].id, settings_.value.defaultCard))
            selected_ = i;
    for (unsigned i = 0; i < assets_.deck.count; ++i)
        if (!strcmp(assets_.deck.cards[i].id, settings_.value.selected))
            selected_ = i;
    activity_.wake(millis());
    if (!settings_.value.provisioned ||
        (assets_.deck.count && !strcmp(assets_.deck.cards[selected_].mode, "artwork") &&
         !assets_.bitmapExists(assets_.deck.cards[selected_].image)))
        page(Page::Pairing);
    render();
    return true;
}
void Ui::orientation() {
    display_.orientation(settings_.value.rotation);
    touch_.rotation = settings_.value.rotation;
    touch_.calibration = settings_.value.calibration;
    invalidate();
}
lv_obj_t *Ui::label(lv_obj_t *p, const char *txt, int x, int y, int w, int h, const lv_font_t *f,
                    uint32_t color) {
    auto *l = lv_label_create(p);
    lv_obj_set_pos(l, x, y);
    lv_obj_set_size(l, w, h);
    lv_label_set_text(l, txt);
    lv_label_set_long_mode(l, LV_LABEL_LONG_DOT);
    lv_obj_set_style_text_font(l, f, 0);
    lv_obj_set_style_text_color(l, lv_color_hex(color), 0);
    return l;
}
lv_obj_t *Ui::button(lv_obj_t *p, const char *txt, int action) {
    auto *b = lv_button_create(p);
    lv_obj_set_size(b, 208, 44);
    lv_obj_set_style_radius(b, 10, 0);
    lv_obj_set_style_bg_color(b, lv_color_white(), 0);
    lv_obj_set_style_bg_opa(b, LV_OPA_COVER, 0);
    lv_obj_set_style_shadow_width(b, 0, 0);
    lv_obj_set_style_text_color(b, lv_color_hex(ink), 0);
    lv_obj_set_style_bg_color(b, lv_color_hex(0xd9ceff), LV_STATE_PRESSED);
    auto *l = lv_label_create(b);
    lv_label_set_text(l, txt);
    lv_obj_set_width(l, 184);
    lv_label_set_long_mode(l, LV_LABEL_LONG_DOT);
    lv_obj_center(l);
    lv_obj_set_user_data(b, reinterpret_cast<void *>(static_cast<intptr_t>(action)));
    lv_obj_add_event_cb(b, event, LV_EVENT_CLICKED, this);
    return b;
}
void Ui::event(lv_event_t *e) {
    auto *u = static_cast<Ui *>(lv_event_get_user_data(e));
    int a = static_cast<int>(
        reinterpret_cast<intptr_t>(lv_obj_get_user_data(lv_event_get_target_obj(e))));
    if (a >= 1000) {
        if (u->command)
            u->command(Command::Select, a - 1000);
        u->page(Page::Badge);
        return;
    }
    if (a < 0) {
        u->page(static_cast<Page>(-a - 1));
        return;
    }
    if (u->command)
        u->command(static_cast<Command>(a), 0);
}
void Ui::header(const char *title) {
    auto *root = lv_screen_active();
    label(root, title, 16, 14, 172, 28, font(20), ink);
    auto *b = button(root, LV_SYMBOL_CLOSE, -1 - int(Page::Badge));
    lv_obj_set_pos(b, 192, 4);
    lv_obj_set_size(b, 44, 44);
    auto *l = lv_obj_get_child(b, 0);
    lv_obj_set_width(l, 24);
    lv_obj_center(l);
}
void Ui::renderBadge(lv_obj_t *root) {
    if (selected_ >= assets_.deck.count)
        selected_ = 0;
    auto &c = assets_.deck.cards[selected_];
    lv_obj_set_style_bg_color(root, lv_color_hex(c.background), 0);
    bool image = c.image[0] && assets_.bitmapExists(c.image);
    if (image) {
        auto *im = lv_image_create(root);
        String path = "B:" + assets_.imagePath(c.image);
        lv_image_set_src(im, path.c_str());
        lv_obj_set_pos(im, 0, 0);
        lv_obj_remove_flag(im, LV_OBJ_FLAG_CLICKABLE);
    }
    if (!strcmp(c.mode, "profile")) {
        if (!image) {
            auto *top = lv_obj_create(root);
            plain(top);
            lv_obj_set_size(top, 240, 112);
            lv_obj_set_style_bg_opa(top, LV_OPA_COVER, 0);
            lv_obj_set_style_bg_color(top, lv_color_hex(c.accent), 0);
            auto *av = lv_obj_create(root);
            plain(av);
            lv_obj_set_pos(av, 20, 20);
            lv_obj_set_size(av, 72, 72);
            lv_obj_set_style_radius(av, 36, 0);
            lv_obj_set_style_bg_color(av, lv_color_hex(c.background), 0);
            lv_obj_set_style_bg_opa(av, LV_OPA_COVER, 0);
            char initial[2] = {c.name[0] ? c.name[0] : '?', 0};
            auto *l = label(av, initial, 0, 0, 72, 36, font(28), c.foreground);
            lv_obj_center(l);
            lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, 0);
        }
        label(root, "Say hello.", 110, 44, 118, 32, font(20), 0xffffff);
        auto *lower = lv_obj_create(root);
        plain(lower);
        lv_obj_set_pos(lower, 0, 112);
        lv_obj_set_size(lower, 240, 208);
        lv_obj_set_style_bg_opa(lower, LV_OPA_COVER, 0);
        lv_obj_set_style_bg_color(lower, lv_color_hex(c.background), 0);
        label(root, c.name, 20, 128, 200, 38, font(28), c.foreground);
        label(root, c.description, 20, 174, 200, 40, font(14), c.foreground);
        if (c.url[0]) {
            // 106px white square, 86px QR, >=8px quiet zone; URL cap keeps >=2px modules.
            auto *quiet = lv_obj_create(root);
            plain(quiet);
            lv_obj_set_pos(quiet, 20, 218);
            lv_obj_set_size(quiet, 106, 102);
            lv_obj_set_style_bg_color(quiet, lv_color_white(), 0);
            lv_obj_set_style_bg_opa(quiet, LV_OPA_COVER, 0);
            auto *qr = lv_qrcode_create(quiet);
            lv_qrcode_set_size(qr, 86);
            lv_obj_set_pos(qr, 10, 8);
            lv_qrcode_set_dark_color(qr, lv_color_black());
            lv_qrcode_set_light_color(qr, lv_color_white());
            if (lv_qrcode_update(qr, c.url, strlen(c.url)) != LV_RESULT_OK)
                Serial.println("QR encode failed");
            label(root, "Let's\nconnect", 140, 238, 86, 54, font(20), c.foreground);
        } else
            label(root, "Made to be\ncarried with you.", 20, 244, 200, 54, font(20), c.foreground);
    }
    if (!strcmp(c.mode, "custom")) {
        for (unsigned i = 0; i < c.shapeCount; ++i) {
            auto &s = c.shapes[i];
            auto *o = lv_obj_create(root);
            plain(o);
            lv_obj_set_pos(o, s.x, s.y);
            lv_obj_set_size(o, s.w, s.h);
            lv_obj_set_style_bg_color(o, lv_color_hex(s.color), 0);
            lv_obj_set_style_bg_opa(o, LV_OPA_COVER, 0);
            lv_obj_set_style_radius(o, s.radius, 0);
        }
        for (unsigned i = 0; i < c.textCount; ++i) {
            auto &t = c.texts[i];
            label(root, t.text, t.x, t.y, 240 - t.x, 320 - t.y, font(t.size), t.color);
        }
        if (c.url[0]) {
            auto *quiet = lv_obj_create(root);
            plain(quiet);
            lv_obj_set_pos(quiet, 126, 214);
            lv_obj_set_size(quiet, 106, 106);
            lv_obj_set_style_bg_color(quiet, lv_color_white(), 0);
            lv_obj_set_style_bg_opa(quiet, LV_OPA_COVER, 0);
            auto *qr = lv_qrcode_create(quiet);
            lv_qrcode_set_size(qr, 86);
            lv_obj_set_pos(qr, 10, 10);
            lv_qrcode_set_dark_color(qr, lv_color_black());
            lv_qrcode_set_light_color(qr, lv_color_white());
            lv_qrcode_update(qr, c.url, strlen(c.url));
        }
    }
    if (c.image[0] && !image)
        label(root, "Background unavailable", 8, 300, 224, 20, font(14), c.foreground);
}
bool Ui::streamArtwork() {
    auto &c = assets_.deck.cards[selected_];
    if (strcmp(c.mode, "artwork") || !assets_.bitmapExists(c.image))
        return false;
    auto file = LittleFS.open(assets_.imagePath(c.image), "r");
    uint8_t header[66];
    if (!file || file.read(header, 66) != 66 || !validBitmap(header, 66, file.size()))
        return false;
    uint32_t started = micros();
    for (int y = 0; y < 320; y += 32) {
        if (!file.seek(66 + (320 - y - 32) * 480) ||
            file.read(buffer, sizeof(buffer)) != sizeof(buffer))
            return false;
        // BMP rows are bottom-up. Reverse in place, retaining native RGB565 bytes.
        for (int row = 0; row < 16; ++row)
            for (int x = 0; x < 480; ++x)
                std::swap(buffer[row * 480 + x], buffer[(31 - row) * 480 + x]);
        lv_area_t area{0, y, 239, y + 31};
        display_.flushArea(&area, buffer);
        touch_.poll();
        yield();
    }
    artworkUs_ = micros() - started;
    return true;
}
void Ui::benchmark(bool streaming) {
    if (!assets_.deck.count) {
        Serial.println("BENCH requires saved artwork");
        return;
    }
    bool old = streaming_;
    unsigned saved = selected_;
    uint32_t sum = 0, maximum = 0, flushStart = flushUs_, heap = ESP.getFreeHeap();
    streaming_ = streaming;
    for (unsigned i = 0; i < 10; ++i) {
        selected_ = i % assets_.deck.count;
        page(Page::Badge);
        uint32_t started = micros();
        render();
        if (!direct_)
            lv_refr_now(lvDisplay_);
        uint32_t elapsed = micros() - started;
        sum += elapsed;
        maximum = std::max(maximum, elapsed);
        yield();
    }
    Serial.printf(
        "BENCH mode=%s frames=10 meanUs=%lu maxUs=%lu flushUs=%lu heapBefore=%u heapAfter=%u\n",
        streaming ? "stream" : "lvgl", (unsigned long)(sum / 10), (unsigned long)maximum,
        (unsigned long)(flushUs_ - flushStart), unsigned(heap), unsigned(ESP.getFreeHeap()));
    selected_ = saved;
    streaming_ = old;
    page(Page::Badge);
}
void Ui::benchmarkMenu() {
    Page previous = page_;
    uint8_t brightness = settings_.value.brightness;
    page(Page::Display);
    uint32_t start = micros();
    render();
    lv_refr_now(lvDisplay_);
    uint32_t full = micros() - start, total = 0, maximum = 0;
    for (unsigned i = 0; i < 10; ++i) {
        settings_.value.brightness = i % 2 ? 65 : 75;
        start = micros();
        updateControls();
        lv_refr_now(lvDisplay_);
        uint32_t elapsed = micros() - start;
        total += elapsed;
        maximum = std::max(maximum, elapsed);
    }
    settings_.value.brightness = brightness;
    Serial.printf("BENCH mode=menu fullUs=%lu partialMeanUs=%lu partialMaxUs=%lu\n",
                  (unsigned long)full, (unsigned long)(total / 10), (unsigned long)maximum);
    page(previous);
}
void Ui::diagnostics(JsonDocument &d) const {
    d["screenAsleep"] = activity_.asleep();
    d["wakeConsumed"] = activity_.consumed();
    d["flushCount"] = flushCount_;
    d["flushTotalUs"] = flushUs_;
    d["flushMaxUs"] = flushMax_;
    d["flushedPixels"] = flushPixels_;
    d["lvHandlerMaxUs"] = handlerMax_;
    d["lastFrameUs"] = frameUs_;
    d["frames"] = frames_;
    d["artworkLoadUs"] = artworkUs_;
    d["streamArtwork"] = streaming_;
    auto &c = settings_.value.calibration;
    auto a = d["calibration"].to<JsonArray>();
    a.add(c.a);
    a.add(c.b);
    a.add(c.c);
    a.add(c.d);
    a.add(c.e);
    a.add(c.f);
}
void Ui::updateControls() {
    auto *root = lv_screen_active();
    // Update only command button labels; do not delete the tree or reset scroll/press state.
    auto *list = lv_obj_get_child(root, -1);
    if (!list)
        return;
    char text[64];
    for (uint32_t i = 0; i < lv_obj_get_child_count(list); ++i) {
        auto *b = lv_obj_get_child(list, i);
        if (!lv_obj_check_type(b, &lv_button_class))
            continue;
        auto cmd = static_cast<Command>(reinterpret_cast<intptr_t>(lv_obj_get_user_data(b)));
        if (cmd == Command::Brightness)
            snprintf(text, sizeof(text), "Brightness: %u%%", settings_.value.brightness);
        else if (cmd == Command::Timeout) {
            if (settings_.value.screenTimeout)
                snprintf(text, sizeof(text), "Screen off: %lus",
                         (unsigned long)settings_.value.screenTimeout);
            else
                strcpy(text, "Screen off: never");
        } else if (cmd == Command::Autoplay)
            snprintf(text, sizeof(text), "Slideshow: %s", settings_.value.autoplay ? "on" : "off");
        else if (cmd == Command::Interval)
            snprintf(text, sizeof(text), "Interval: %lus", (unsigned long)settings_.value.interval);
        else
            continue;
        lv_label_set_text(lv_obj_get_child(b, 0), text);
    }
}
void Ui::render() {
    dirty_ = false;
    direct_ = false;
    renderedPage_ = page_;
    lv_display_enable_invalidation(lvDisplay_, true);
    ignore_ = true;
    gestures_.reset();
    touchDot_ = nullptr;
    calibrationHint_ = nullptr;
    auto *root = lv_screen_active();
    lv_obj_clean(root);
    lv_obj_remove_flag(root, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_bg_color(root, lv_color_hex(frost), 0);
    lv_obj_set_style_bg_opa(root, LV_OPA_COVER, 0);
    lv_obj_set_style_text_font(root, font(14), 0);
    if (page_ == Page::Badge) {
        if (streaming_ && !busy_ && streamArtwork()) {
            direct_ = true;
            lv_display_enable_invalidation(lvDisplay_, false);
            return;
        }
        renderBadge(root);
        if (false) {
            auto *hint = label(root, "Tap to set up touch", 0, 292, 240, 28, font(14), 0xffffff);
            lv_obj_set_style_bg_color(hint, lv_color_hex(ink), 0);
            lv_obj_set_style_bg_opa(hint, LV_OPA_COVER, 0);
            lv_obj_set_style_text_align(hint, LV_TEXT_ALIGN_CENTER, 0);
        }
        return;
    }
    if (page_ == Page::Calibration) {
        lv_obj_set_style_bg_color(root, lv_color_hex(ink), 0);
        char hint[96];
        snprintf(hint, sizeof(hint), "Touch setup %d / 4\nPress + briefly,\nthen lift your finger",
                 calibrationStep_ + 1);
        calibrationHint_ = label(root, hint, 24, 110, 192, 108, font(20), 0xffffff);
        lv_obj_set_style_text_align(calibrationHint_, LV_TEXT_ALIGN_CENTER, 0);
        touchDot_ = lv_label_create(root);
        lv_label_set_text(touchDot_, "+");
        lv_obj_set_style_text_font(touchDot_, font(28), 0);
        lv_obj_set_style_text_color(touchDot_, lv_color_hex(0xb6e8d5), 0);
        lv_obj_set_pos(touchDot_, targets[calibrationStep_].x - 10,
                       targets[calibrationStep_].y - 17);
        return;
    }
    if (page_ == Page::Diagnostics) {
        header("Portrait test");
        label(root, "Top: this edge is UP", 16, 60, 208, 24, font(14), ink);
        const char *names[] = {"Red", "Green", "Blue", "White"};
        const uint32_t colors[] = {0xff0000, 0x00ff00, 0x0000ff, 0xffffff};
        for (unsigned i = 0; i < 4; ++i) {
            auto *o = lv_obj_create(root);
            plain(o);
            lv_obj_set_pos(o, 12 + i * 56, 98);
            lv_obj_set_size(o, 48, 62);
            lv_obj_set_style_bg_color(o, lv_color_hex(colors[i]), 0);
            lv_obj_set_style_bg_opa(o, LV_OPA_COVER, 0);
            label(root, names[i], 12 + i * 56, 166, 54, 20, font(14), ink);
        }
        label(root, "USB connectors below\nTap each corner to test touch", 12, 200, 220, 48,
              font(14), ink);
        auto *b = button(root, "Flip portrait 180 degrees", int(Command::Rotate));
        lv_obj_set_pos(b, 16, 264);
        touchDot_ = lv_obj_create(root);
        plain(touchDot_);
        lv_obj_set_size(touchDot_, 10, 10);
        lv_obj_set_style_radius(touchDot_, 5, 0);
        lv_obj_set_style_bg_color(touchDot_, lv_color_hex(blue), 0);
        lv_obj_set_style_bg_opa(touchDot_, LV_OPA_COVER, 0);
        lv_obj_add_flag(touchDot_, LV_OBJ_FLAG_HIDDEN);
        return;
    }
    if (page_ == Page::Storage) {
        header("Storage setup");
        label(root,
              "Initialize blank storage?\n\nOnly an entirely erased partition can be initialized. "
              "Existing or damaged files are never erased.",
              16, 70, 208, 150, font(14), ink);
        auto *b = button(root, "Initialize storage", int(Command::Storage));
        lv_obj_set_pos(b, 16, 258);
        return;
    }
    if (page_ == Page::Pairing) {
        label(root, settings_.value.provisioned ? "Connect to editor" : "Welcome to\nLanyardBadge",
              16, 12, 208, 52, font(20), ink);
        auto *hint = label(root, "Scan to connect\nand customize.", 12, 62, 216, 34, font(14), ink);
        lv_obj_set_style_text_align(hint, LV_TEXT_ALIGN_CENTER, 0);
        lv_label_set_long_mode(hint, LV_LABEL_LONG_WRAP);
        String url = pairingUrl ? pairingUrl() : String("");
        auto *quiet = lv_obj_create(root);
        plain(quiet);
        lv_obj_set_pos(quiet, 22, 96);
        lv_obj_set_size(quiet, 196, 196);
        lv_obj_set_style_bg_color(quiet, lv_color_white(), 0);
        lv_obj_set_style_bg_opa(quiet, LV_OPA_COVER, 0);
        auto *qr = lv_qrcode_create(quiet);
        lv_qrcode_set_size(qr, 164);
        lv_obj_set_pos(qr, 16, 16);
        lv_qrcode_set_dark_color(qr, lv_color_black());
        lv_qrcode_set_light_color(qr, lv_color_white());
        lv_qrcode_update(qr, url.c_str(), url.length());
        String manualKey = String("Code: ") + settings_.pairingCode();
        auto *key = label(root, manualKey.c_str(), 8, 294, 224, 26, font(20), ink);
        lv_obj_set_style_text_align(key, LV_TEXT_ALIGN_CENTER, 0);
        return;
    }
    header(page_ == Page::Menu        ? "Your badge"
           : page_ == Page::Gallery   ? "Gallery"
           : page_ == Page::Display   ? "Display"
           : page_ == Page::Slideshow ? "Slideshow"
           : page_ == Page::Settings  ? "Settings"
           : page_ == Page::Advanced  ? "Advanced"
                                      : "Device information");
    auto *list = lv_obj_create(root);
    plain(list);
    lv_obj_set_pos(list, 0, 54);
    lv_obj_set_size(list, 240, 266);
    lv_obj_add_flag(list, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_pad_left(list, 16, 0);
    lv_obj_set_style_pad_right(list, 16, 0);
    lv_obj_set_style_pad_row(list, 8, 0);
    lv_obj_set_style_pad_bottom(list, 12, 0);
    lv_obj_set_flex_flow(list, LV_FLEX_FLOW_COLUMN);
    if (page_ == Page::Gallery) {
        for (unsigned i = 0; i < assets_.deck.count; ++i) {
            auto *b = button(list, assets_.deck.cards[i].title, 1000 + i);
            if (i == selected_)
                lv_obj_set_style_bg_color(b, lv_color_hex(0xd9ceff), 0);
        }
        return;
    }
    if (page_ == Page::Info) {
        String text = info ? info() : String("Starting...");
        auto *l = lv_label_create(list);
        lv_obj_set_width(l, 208);
        lv_label_set_text(l, text.c_str());
        lv_obj_set_style_text_color(l, lv_color_hex(ink), 0);
        return;
    }
    if (page_ == Page::Advanced) {
        button(list, "Diagnostics", -1 - int(Page::Diagnostics));
        button(list, "Calibrate touch", -1 - int(Page::Calibration));
        button(list, "Revoke editor access", -1 - int(Page::RePair));
        if (assets_.canProvision())
            button(list, "Set up storage", -1 - int(Page::Storage));
        button(list, "Restart badge", int(Command::Restart));
        return;
    }
    if (page_ == Page::RePair) {
        label(list, "Disconnect all editors and replace the QR key? Scan again to reconnect.", 0, 0,
              208, 90, font(14), ink);
        button(list, "Revoke and show new QR", int(Command::RevokePairing));
        return;
    }
    if (page_ == Page::Settings) {
        button(list, "Device information", -1 - int(Page::Info));
        button(list, "Advanced", -1 - int(Page::Advanced));
        return;
    }
    if (page_ == Page::Display) {
        button(list, "", int(Command::Brightness));
        button(list, "", int(Command::Timeout));
        updateControls();
        return;
    }
    if (page_ == Page::Slideshow) {
        button(list, "", int(Command::Autoplay));
        button(list, "", int(Command::Interval));
        updateControls();
        return;
    }
    button(list, "Gallery", -1 - int(Page::Gallery));
    button(list, "Slideshow", -1 - int(Page::Slideshow));
    button(list, "Display", -1 - int(Page::Display));
    button(list, "Connect to editor", int(Command::Setup));
    button(list, "Settings", -1 - int(Page::Settings));
}
void Ui::page(Page p) {
    wake();
    if (p == Page::Badge && (!assets_.deck.count || !settings_.value.provisioned))
        p = Page::Pairing;
    page_ = p;
    dirty_ = true;
    gestures_.reset();
    ignore_ = true;
    if (p == Page::Calibration) {
        calibrationStep_ = 0;
        samples_ = 0;
        sampleX_ = sampleY_ = 0;
        waitingRelease_ = true;
        calibrationStarted_ = millis();
    }
}
void Ui::select(unsigned i) {
    if (i < assets_.deck.count && (i != selected_ || dirty_)) {
        selected_ = i;
        invalidate();
    }
}
void Ui::calibrationTick() {
    if (millis() - calibrationStarted_ > 120000) {
        Serial.println("Calibration timed out; previous mapping retained");
        page(settings_.value.calibration.valid ? Page::Menu : Page::Badge);
        return;
    }
    if (waitingRelease_) {
        if (!touch_.down())
            waitingRelease_ = false;
        return;
    }
    if (!touch_.down()) {
        samples_ = 0;
        sampleX_ = sampleY_ = 0;
        return;
    }
    static uint32_t last = 0;
    if (millis() - last < 12)
        return;
    last = millis();
    sampleX_ += touch_.raw().x;
    sampleY_ += touch_.raw().y;
    if (++samples_ < 12)
        return;
    Point raw = {int16_t(sampleX_ / samples_), int16_t(sampleY_ / samples_)};
    samples_ = 0;
    sampleX_ = sampleY_ = 0;
    waitingRelease_ = true;
    if (calibrationStep_ < 3)
        rawSamples_[calibrationStep_] = raw;
    if (calibrationStep_ == 2) {
        Point canonical[3];
        for (int i = 0; i < 3; ++i)
            canonical[i] = settings_.value.rotation == 2
                               ? Point{int16_t(239 - targets[i].x), int16_t(319 - targets[i].y)}
                               : targets[i];
        if (!calibrate(rawSamples_, canonical, candidate_)) {
            Serial.println("Calibration points invalid; retry");
            page(Page::Calibration);
            return;
        }
    }
    if (calibrationStep_ == 3) {
        Point p = candidate_.map(raw.x, raw.y, settings_.value.rotation);
        if (abs(p.x - targets[3].x) > 18 || abs(p.y - targets[3].y) > 18) {
            Serial.println("Fourth-corner calibration check failed; retry");
            page(Page::Calibration);
            return;
        }
        settings_.value.calibration = candidate_;
        bool saved = settings_.save();
        touch_.calibration = candidate_;
        Serial.println(saved ? "Four-corner calibration validated and saved"
                             : "Calibration active; NVS save failed");
        page(Page::Badge);
        return;
    }
    ++calibrationStep_;
    dirty_ = true;
}
void Ui::tick() {
    touch_.poll();
    if (ignore_ && !touch_.down())
        ignore_ = false;
    if (page_ == Page::Calibration)
        calibrationTick();
    if (page_ == Page::Diagnostics && touchDot_ && !dirty_) {
        if (touch_.down()) {
            auto p = touch_.point();
            lv_obj_set_pos(touchDot_, p.x - 5, p.y - 5);
            lv_obj_remove_flag(touchDot_, LV_OBJ_FLAG_HIDDEN);
        } else
            lv_obj_add_flag(touchDot_, LV_OBJ_FLAG_HIDDEN);
    }
    bool wasAsleep = activity_.asleep();
    activity_.update(millis(), settings_.value.screenTimeout, touch_.down(),
                     busy_ || page_ == Page::Calibration);
    if (wasAsleep != activity_.asleep())
        display_.brightness(activity_.asleep() ? 0 : settings_.value.brightness);
    if (activity_.asleep() || activity_.consumed()) {
        gestures_.reset();
        ignore_ = true;
        return;
    }
    if (page_ == Page::Badge && !ignore_ && !busy_) {
        auto g = gestures_.update(touch_.down(), touch_.point(), millis());
        if (g == Gesture::Hold)
            page(Page::Menu);
        else if (command && g == Gesture::Left)
            command(Command::Next, 0);
        else if (command && g == Gesture::Right)
            command(Command::Previous, 0);
        else if (command && g == Gesture::Tap)
            command(touch_.point().x < 120 ? Command::Previous : Command::Next, 0);
    }
    if (dirty_) {
        if ((page_ == Page::Display || page_ == Page::Slideshow) && renderedPage_ == page_) {
            dirty_ = false;
            updateControls();
        } else
            render();
    }
}
void Ui::pump() {
    tick();
    if (!activity_.asleep()) {
        // LVGL must not overwrite direct artwork. It resumes on menu/upload entry.
        if (!(page_ == Page::Badge && direct_ && !busy_)) {
            uint32_t start = micros();
            lv_timer_handler();
            handlerMax_ = std::max(handlerMax_, uint32_t(micros() - start));
        }
    }
}
void Ui::uploadProgress(int percent) {
    if (percent == lastProgress_)
        return;
    lastProgress_ = percent;
    if (percent < 0) {
        if (!busy_)
            return;
        busy_ = false;
        if (progress_) {
            lv_obj_delete(progress_);
            progress_ = nullptr;
        }
        invalidate();
        return;
    }
    if (!busy_) {
        busy_ = true;
        wake();
        invalidate();
    }
    if (!progress_) {
        progress_ = label(lv_layer_top(), "", 0, 294, 240, 26, font(14), 0xffffff);
        lv_obj_set_style_bg_color(progress_, lv_color_hex(ink), 0);
        lv_obj_set_style_bg_opa(progress_, LV_OPA_COVER, 0);
        lv_obj_set_style_text_align(progress_, LV_TEXT_ALIGN_CENTER, 0);
    }
    if (page_ == Page::Calibration)
        lv_obj_add_flag(progress_, LV_OBJ_FLAG_HIDDEN);
    else
        lv_obj_remove_flag(progress_, LV_OBJ_FLAG_HIDDEN);
    char text[40];
    snprintf(text, sizeof(text), "Uploading card... %d%%", percent);
    lv_label_set_text(progress_, text);
    pump();
}
} // namespace badge
