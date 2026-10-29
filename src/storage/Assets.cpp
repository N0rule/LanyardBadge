#include "Assets.h"
#include "../core/Console.h"
#include <esp_partition.h>
#include <esp_random.h>
#include <memory>
#include <new>
namespace badge {
namespace {
struct AnimationValidation {
    AnimationDecoder decoder;
    uint16_t row[240];
};
uint32_t manifestCrc(JsonDocument &doc) {
    String canonical;
    serializeJson(doc, canonical);
    return checksum(canonical.c_str(), canonical.length());
}
} // namespace
bool Assets::loadFile(const char *path, Deck &target) {
    File f = LittleFS.open(path, "r");
    if (!f || f.size() > 24576)
        return false;
    JsonDocument doc;
    auto err = deserializeJson(doc, f, DeserializationOption::NestingLimit(8));
    f.close();
    if (err || !doc["crc"].is<uint32_t>())
        return false;
    uint32_t crc = doc["crc"];
    doc.remove("crc");
    if (manifestCrc(doc) != crc)
        return false;
    for (auto card : doc["cards"].as<JsonArrayConst>()) {
        const char *mode = card["mode"] | "";
        if (!strcmp(mode, "profile") || !strcmp(mode, "custom")) {
            legacy_ = true;
            return false;
        }
    }
    String error;
    return deckFromJson(doc.as<JsonVariantConst>(), target, error);
}
bool Assets::begin() {
    ready_ = LittleFS.begin(false, "/littlefs", 10, "assets");
    defaults(deck);
    if (!ready_) {
        Console::println("LittleFS unavailable; not auto-formatting. Use storage setup.");
        return false;
    }
    if (!loadFile("/cards.json", deck)) {
        if (!legacy_ && loadFile("/cards.bak", deck)) {
            Console::println("Recovered backup card database");
            LittleFS.remove("/cards.json");
            if (!LittleFS.rename("/cards.bak", "/cards.json"))
                Console::println("Could not restore backup filename");
        } else {
            defaults(deck);
            Console::println("No saved artwork collection; starting empty");
        }
    }
    // Never adopt an interrupted upload or an uncommitted manifest.
    LittleFS.remove("/upload.tmp");
    LittleFS.remove("/cards.tmp");
    return true;
}
bool Assets::provision() {
    if (ready_)
        return true;
    // Fresh installs only: never format unrecognized/corrupt user data.
    const auto *p =
        esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_ANY, "assets");
    if (!p)
        return false;
    uint8_t bytes[256];
    for (size_t at = 0; at < p->size; at += sizeof(bytes)) {
        if (esp_partition_read(p, at, bytes, sizeof(bytes)) != ESP_OK)
            return false;
        for (uint8_t b : bytes)
            if (b != 0xff)
                return false;
        yield();
    }
    return LittleFS.format() && begin();
}
bool Assets::isAnimation(const char *id) const {
    return ready_ && validId(id) && LittleFS.exists(String("/img-") + id + ".lba");
}
String Assets::imagePath(const char *id) const {
    return String("/img-") + id + (isAnimation(id) ? ".lba" : ".bmp");
}
uint32_t Assets::imageSize(const char *id) const {
    if (!ready_ || !validId(id))
        return 0;
    auto f = LittleFS.open(imagePath(id), "r");
    return f ? f.size() : 0;
}
bool Assets::bitmapExists(const char *id) const {
    if (!ready_ || !validId(id))
        return false;
    auto f = LittleFS.open(imagePath(id), "r");
    uint8_t header[66];
    size_t n = f ? f.read(header, sizeof(header)) : 0;
    AnimationHeader animation;
    return f && (isAnimation(id) ? animationHeader(header, n, f.size(), animation)
                                 : validBitmap(header, n, f.size()));
}
bool Assets::commit(String &error) {
    if (legacy_) {
        error = "Legacy collection preserved. Factory reset requires confirmation on the badge.";
        return false;
    }
    if (!ready_) {
        error = "Set up storage on the device first";
        return false;
    }
    for (unsigned i = 0; i < staging.count; ++i) {
        if (staging.cards[i].image[0] && !bitmapExists(staging.cards[i].image)) {
            error = "Card refers to a missing or invalid background";
            return false;
        }
        if (isAnimation(staging.cards[i].image) && strcmp(staging.cards[i].mode, "artwork")) {
            error = "Animations require an artwork card";
            return false;
        }
    }
    staging.revision = deck.revision + 1;
    JsonDocument doc;
    deckToJson(staging, doc);
    uint32_t crc = manifestCrc(doc);
    doc["crc"] = crc;
    auto f = LittleFS.open("/cards.tmp", "w");
    size_t expected = measureJson(doc), written = f ? serializeJson(doc, f) : 0;
    if (f) {
        f.flush();
        f.close();
    }
    if (written != expected) {
        LittleFS.remove("/cards.tmp");
        error = "Storage full; previous cards preserved";
        return false;
    }
    // Reopen and validate before touching the current generation.
    if (!loadFile("/cards.tmp", staging)) {
        LittleFS.remove("/cards.tmp");
        error = "Could not verify saved cards";
        return false;
    }
    LittleFS.remove("/cards.bak");
    if (LittleFS.exists("/cards.json") && !LittleFS.rename("/cards.json", "/cards.bak")) {
        error = "Could not preserve previous cards";
        return false;
    }
    if (!LittleFS.rename("/cards.tmp", "/cards.json")) {
        error = "Could not install cards; backup preserved";
        return false;
    }
    deck = staging;
    return true;
}
bool Assets::beginUpload(String &error, uint32_t bytes, bool animation) {
    abortUpload();
    if (legacy_) {
        error = "Legacy collection preserved. Factory reset requires confirmation on the badge.";
        return false;
    }
    if (!ready_) {
        error = "Set up storage on the device first";
        return false;
    }
    if ((!animation && bytes != bitmapBytes) ||
        (animation && (bytes < 48 || bytes > maxAnimationBytes))) {
        error = "Invalid artwork length";
        return false;
    }
    if (total() - used() < bytes + 32768) {
        error = "Storage full. Delete an unused card, then retry.";
        return false;
    }
    do {
        snprintf(pending_, sizeof(pending_), "%08lx", (unsigned long)esp_random());
    } while (LittleFS.exists(String("/img-") + pending_ + ".bmp") ||
             LittleFS.exists(String("/img-") + pending_ + ".lba"));
    upload_ = LittleFS.open("/upload.tmp", "w");
    if (!upload_) {
        error = "Cannot create upload";
        return false;
    }
    received_ = 0;
    expected_ = bytes;
    animationUpload_ = animation;
    failed_ = false;
    return true;
}
bool Assets::append(const uint8_t *data, size_t n) {
    if (!upload_ || failed_ || n > expected_ - received_) {
        failed_ = true;
        return false;
    }
    if (upload_.write(data, n) != n) {
        failed_ = true;
        return false;
    }
    received_ += n;
    return true;
}
bool Assets::finishUpload(String &id, String &error) {
    bool complete = upload_ && !failed_ && received_ == expected_;
    if (upload_) {
        upload_.flush();
        upload_.close();
    }
    auto f = LittleFS.open("/upload.tmp", "r");
    if (complete && f && animationUpload_) {
        // BLE parsing and progress rendering share the small Arduino loop stack.
        // A checked, bounded allocation leaves stack headroom and preserves failure safety.
        std::unique_ptr<AnimationValidation> validation(new (std::nothrow) AnimationValidation);
        AnimationFrame frame;
        complete = validation && validation->decoder.begin(f);
        while (complete && !validation->decoder.finished())
            complete =
                validation->decoder.next(f, validation->row, 240, frame,
                                         [](unsigned, unsigned, unsigned, unsigned, uint16_t *) {
                                             yield();
                                             return true;
                                         });
    } else {
        uint8_t header[66];
        size_t n = f ? f.read(header, 66) : 0;
        complete = complete && f && validBitmap(header, n, f.size());
    }
    if (f)
        f.close();
    if (!complete || !LittleFS.rename("/upload.tmp", String("/img-") + pending_ +
                                                         (animationUpload_ ? ".lba" : ".bmp"))) {
        abortUpload();
        error = "Incomplete or invalid artwork; previous content preserved";
        return false;
    }
    id = pending_;
    pending_[0] = 0;
    return true;
}
void Assets::abortUpload() {
    if (upload_)
        upload_.close();
    if (ready_)
        LittleFS.remove("/upload.tmp");
    received_ = 0;
    pending_[0] = 0;
    failed_ = false;
}
bool Assets::imageUsed(const char *id, const Deck &d) const {
    for (unsigned i = 0; i < d.count; ++i)
        if (!strcmp(d.cards[i].image, id))
            return true;
    return false;
}
unsigned Assets::collectGarbage() {
    if (legacy_)
        return 0;
    if (!ready_)
        return 0;
    // Preserve both generations so restoring the manifest never loses its backgrounds.
    bool backup = loadFile("/cards.bak", staging);
    if (legacy_) {
        legacy_ = false; // Only the historical generation is legacy; preserve every asset.
        return 0;
    }
    unsigned count = 0;
    auto root = LittleFS.open("/");
    auto f = root.openNextFile();
    while (f) {
        String name = f.name();
        if (name.startsWith("/"))
            name.remove(0, 1);
        f.close();
        if (name.startsWith("img-") && (name.endsWith(".bmp") || name.endsWith(".lba")) &&
            name.length() == 16) {
            String id = name.substring(4, 12);
            if (validId(id.c_str()) && !imageUsed(id.c_str(), deck) &&
                (!backup || !imageUsed(id.c_str(), staging)) && id != pending_) {
                if (LittleFS.remove(String("/") + name))
                    ++count;
            }
        }
        f = root.openNextFile();
    }
    return count;
}
} // namespace badge
