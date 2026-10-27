#include "Assets.h"
#include <esp_random.h>
#include <lgfx/utility/lgfx_miniz.h>
#include <memory>
#include <new>
namespace badge {
namespace {
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
    String error;
    return deckFromJson(doc.as<JsonVariantConst>(), target, error);
}
bool Assets::begin() {
    ready_ = LittleFS.begin(false, "/littlefs", 10, "assets");
    defaults(deck);
    if (!ready_) {
        Serial.println("LittleFS unavailable; not auto-formatting. Use storage setup.");
        return false;
    }
    if (!loadFile("/cards.json", deck)) {
        if (loadFile("/cards.bak", deck)) {
            Serial.println("Recovered backup card database");
            LittleFS.remove("/cards.json");
            if (!LittleFS.rename("/cards.bak", "/cards.json"))
                Serial.println("Could not restore backup filename");
        } else {
            defaults(deck);
            Serial.println("No valid card database; built-in cards loaded");
        }
    }
    // Never adopt an interrupted upload or an uncommitted manifest.
    LittleFS.remove("/upload.tmp");
    LittleFS.remove("/cards.tmp");
    return true;
}
bool Assets::provision() {
    if (ready_) {
        // An interrupted first provisioning can leave a mounted but empty filesystem.
        // Resume without formatting. Never overwrite an existing manifest here.
        if (deck.revision || LittleFS.exists("/cards.json") || LittleFS.exists("/cards.bak"))
            return false;
    } else {
        if (!LittleFS.format() || !begin())
            return false;
    }
    String err, id;
    extern const uint8_t sampleStart[] asm("_binary_assets_sample_bmp_z_start");
    extern const uint8_t sampleEnd[] asm("_binary_assets_sample_bmp_z_end");
    size_t compressedBytes = sampleEnd - sampleStart;
    if (beginUpload(err)) {
        // The convenience inflater puts an 11 KiB decoder on the stack. Keep both
        // its state and dictionary on the heap instead of overflowing Arduino's loop task.
        std::unique_ptr<lgfx_tinfl_decompressor> decoder(new (std::nothrow)
                                                             lgfx_tinfl_decompressor);
        std::unique_ptr<uint8_t[]> dictionary(new (std::nothrow) uint8_t[TINFL_LZ_DICT_SIZE]);
        bool ok = false;
        if (decoder && dictionary) {
            lgfx_tinfl_init(decoder.get());
            size_t consumed = 0, offset = 0;
            while (true) {
                size_t input = compressedBytes - consumed, output = TINFL_LZ_DICT_SIZE - offset;
                auto status = lgfx_tinfl_decompress(decoder.get(), sampleStart + consumed, &input,
                                                    dictionary.get(), dictionary.get() + offset,
                                                    &output, TINFL_FLAG_PARSE_ZLIB_HEADER);
                consumed += input;
                if (output && !append(dictionary.get() + offset, output))
                    break;
                yield();
                if (status == TINFL_STATUS_DONE) {
                    ok = consumed == compressedBytes;
                    break;
                }
                if (status != TINFL_STATUS_HAS_MORE_OUTPUT || (!input && !output))
                    break;
                offset = (offset + output) & (TINFL_LZ_DICT_SIZE - 1);
            }
        }
        if (ok && finishUpload(id, err)) {
            auto &c = deck.cards[deck.count++];
            strcpy(c.id, "00000003");
            strcpy(c.title, "Pocket illustration");
            strcpy(c.mode, "artwork");
            strlcpy(c.image, id.c_str(), sizeof(c.image));
        } else
            abortUpload();
    }
    staging = deck;
    return commit(err);
}
bool Assets::bitmapExists(const char *id) const {
    if (!ready_ || !validId(id))
        return false;
    auto f = LittleFS.open(imagePath(id), "r");
    uint8_t header[66];
    size_t n = f ? f.read(header, sizeof(header)) : 0;
    return f && validBitmap(header, n, f.size());
}
bool Assets::commit(String &error) {
    if (!ready_) {
        error = "Set up storage on the device first";
        return false;
    }
    for (unsigned i = 0; i < staging.count; ++i)
        if (staging.cards[i].image[0] && !bitmapExists(staging.cards[i].image)) {
            error = "Card refers to a missing or invalid background";
            return false;
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
bool Assets::beginUpload(String &error) {
    abortUpload();
    if (!ready_) {
        error = "Set up storage on the device first";
        return false;
    }
    if (total() - used() < bitmapBytes + 32768) {
        error = "Storage full. Delete an unused card, then retry.";
        return false;
    }
    do {
        snprintf(pending_, sizeof(pending_), "%08lx", (unsigned long)esp_random());
    } while (LittleFS.exists(imagePath(pending_)));
    upload_ = LittleFS.open("/upload.tmp", "w");
    if (!upload_) {
        error = "Cannot create upload";
        return false;
    }
    received_ = 0;
    failed_ = false;
    return true;
}
bool Assets::append(const uint8_t *data, size_t n) {
    if (!upload_ || failed_ || n > bitmapBytes - received_) {
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
    bool complete = upload_ && !failed_ && received_ == bitmapBytes;
    if (upload_) {
        upload_.flush();
        upload_.close();
    }
    auto f = LittleFS.open("/upload.tmp", "r");
    uint8_t header[66];
    size_t n = f ? f.read(header, 66) : 0;
    complete = complete && f && validBitmap(header, n, f.size());
    if (f)
        f.close();
    if (!complete || !LittleFS.rename("/upload.tmp", imagePath(pending_))) {
        abortUpload();
        error = "Incomplete or invalid RGB565 image; previous content preserved";
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
    if (!ready_)
        return 0;
    // Preserve both generations so restoring the manifest never loses its backgrounds.
    bool backup = loadFile("/cards.bak", staging);
    unsigned count = 0;
    auto root = LittleFS.open("/");
    auto f = root.openNextFile();
    while (f) {
        String name = f.name();
        if (name.startsWith("/"))
            name.remove(0, 1);
        f.close();
        if (name.startsWith("img-") && name.endsWith(".bmp") && name.length() == 16) {
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
