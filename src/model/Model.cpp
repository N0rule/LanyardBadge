#include "Model.h"
namespace badge {
namespace {
bool text(JsonObjectConst o, const char *key, char *dest, size_t size, bool required, String &err) {
    if (!o[key].is<const char *>()) {
        err = String("Invalid ") + key;
        return false;
    }
    const char *s = o[key];
    size_t n = strlen(s);
    if (n >= size || (required && !n)) {
        err = String("Invalid length: ") + key;
        return false;
    }
    // Montserrat's bundled glyph set is Latin-1. Reject unsupported text rather than silently
    // rendering missing glyphs.
    for (size_t i = 0; i < n; ++i)
        if (((uint8_t)s[i] < 32 && s[i] != '\n') || (uint8_t)s[i] > 126) {
            err = String(key) + ": use printable ASCII text";
            return false;
        }
    memcpy(dest, s, n + 1);
    return true;
}
bool color(JsonObjectConst o, const char *key, uint32_t &v, String &err) {
    if (!o[key].is<uint32_t>() || o[key].as<uint32_t>() > 0xffffff) {
        err = String("Invalid color: ") + key;
        return false;
    }
    v = o[key];
    return true;
}
} // namespace
void cardToJson(const Card &c, JsonObject o) {
    o["id"] = c.id;
    o["title"] = c.title;
    o["mode"] = c.mode;
    o["image"] = c.image;
    o["background"] = c.background;
    // Empty compatibility fields keep existing artwork workspaces readable.
    o["name"] = "";
    o["description"] = "";
    o["url"] = "";
    o["foreground"] = c.foreground;
    o["accent"] = 0x3659d9;
    o["texts"].to<JsonArray>();
    o["shapes"].to<JsonArray>();
}

bool cardFromJson(JsonObjectConst o, Card &c, String &err) {
    c = Card{};
    if (!text(o, "id", c.id, sizeof(c.id), true, err) || !validId(c.id) ||
        !text(o, "title", c.title, sizeof(c.title), true, err) ||
        !text(o, "mode", c.mode, sizeof(c.mode), true, err) ||
        !text(o, "image", c.image, sizeof(c.image), false, err) ||
        !color(o, "background", c.background, err))
        return false;
    if (strcmp(c.mode, "artwork")) {
        err = "Only image and GIF artwork cards are supported";
        return false;
    }
    if (c.image[0] && !validId(c.image)) {
        err = "Invalid image ID";
        return false;
    }
    return true;
}
void deckToJson(const Deck &d, JsonDocument &doc) {
    deckToJson(d, doc.to<JsonObject>());
}
void deckToJson(const Deck &d, JsonObject doc) {
    doc["version"] = 2;
    doc["revision"] = d.revision;
    auto a = doc["cards"].to<JsonArray>();
    for (unsigned i = 0; i < d.count; ++i)
        cardToJson(d.cards[i], a.add<JsonObject>());
}
bool deckFromJson(JsonVariantConst v, Deck &d, String &err) {
    if (v["version"] != 2 || !v["revision"].is<uint32_t>() || !v["cards"].is<JsonArrayConst>()) {
        err = "Invalid card database";
        return false;
    }
    auto a = v["cards"].as<JsonArrayConst>();
    if (a.size() > maxCards) {
        err = "Keep up to ten cards";
        return false;
    }
    d.count = 0;
    d.revision = v["revision"];
    for (auto c : a) {
        if (!c.is<JsonObjectConst>() ||
            !cardFromJson(c.as<JsonObjectConst>(), d.cards[d.count], err))
            return false;
        for (unsigned j = 0; j < d.count; ++j)
            if (!strcmp(d.cards[j].id, d.cards[d.count].id)) {
                err = "Duplicate card ID";
                return false;
            }
        ++d.count;
    }
    return true;
}
void defaults(Deck &d) {
    d = Deck{};
}
} // namespace badge
