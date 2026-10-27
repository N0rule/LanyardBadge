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
bool number(JsonObjectConst o, const char *key, int lo, int hi, int &n, String &err) {
    if (!o[key].is<int>()) {
        err = String("Invalid number: ") + key;
        return false;
    }
    n = o[key];
    if (n < lo || n > hi) {
        err = String("Out of range: ") + key;
        return false;
    }
    return true;
}
} // namespace
void cardToJson(const Card &c, JsonObject o) {
    o["id"] = c.id;
    o["title"] = c.title;
    o["mode"] = c.mode;
    o["image"] = c.image;
    o["name"] = c.name;
    o["description"] = c.description;
    o["url"] = c.url;
    o["background"] = c.background;
    o["foreground"] = c.foreground;
    o["accent"] = c.accent;
    auto texts = o["texts"].to<JsonArray>();
    for (unsigned i = 0; i < c.textCount; ++i) {
        auto t = texts.add<JsonObject>();
        auto &e = c.texts[i];
        t["text"] = e.text;
        t["x"] = e.x;
        t["y"] = e.y;
        t["size"] = e.size;
        t["color"] = e.color;
    }
    auto shapes = o["shapes"].to<JsonArray>();
    for (unsigned i = 0; i < c.shapeCount; ++i) {
        auto t = shapes.add<JsonObject>();
        auto &e = c.shapes[i];
        t["x"] = e.x;
        t["y"] = e.y;
        t["w"] = e.w;
        t["h"] = e.h;
        t["radius"] = e.radius;
        t["color"] = e.color;
    }
}
bool cardFromJson(JsonObjectConst o, Card &c, String &err) {
    c = Card{};
    if (!text(o, "id", c.id, sizeof(c.id), true, err) || !validId(c.id) ||
        !text(o, "title", c.title, sizeof(c.title), true, err) ||
        !text(o, "mode", c.mode, sizeof(c.mode), true, err) ||
        !text(o, "image", c.image, sizeof(c.image), false, err) ||
        !text(o, "name", c.name, sizeof(c.name), false, err) ||
        !text(o, "description", c.description, sizeof(c.description), false, err) ||
        !text(o, "url", c.url, sizeof(c.url), false, err) ||
        !color(o, "background", c.background, err) || !color(o, "foreground", c.foreground, err) ||
        !color(o, "accent", c.accent, err))
        return false;
    if (strcmp(c.mode, "profile") && strcmp(c.mode, "artwork") && strcmp(c.mode, "custom")) {
        err = "Unknown card mode";
        return false;
    }
    if (c.image[0] && !validId(c.image)) {
        err = "Invalid image ID";
        return false;
    }
    if (c.url[0] && strncmp(c.url, "https://", 8) && strncmp(c.url, "http://", 7)) {
        err = "QR link must begin with https:// or http://";
        return false;
    }
    if (c.url[0]) {
        unsigned start = !strncmp(c.url, "https://", 8) ? 8 : 7;
        if (strlen(c.url) <= start || c.url[start] == '/') {
            err = "QR link needs a host name";
            return false;
        }
        for (const char *p = c.url; *p; ++p)
            if (*p < 33 || *p > 126) {
                err = "QR links cannot contain whitespace";
                return false;
            }
    }
    auto texts = o["texts"].as<JsonArrayConst>();
    auto shapes = o["shapes"].as<JsonArrayConst>();
    if (!o["texts"].is<JsonArrayConst>() || !o["shapes"].is<JsonArrayConst>() ||
        texts.size() > maxElements || shapes.size() > maxElements) {
        err = "Use at most four text and four shape elements";
        return false;
    }
    for (auto t : texts) {
        if (!t.is<JsonObjectConst>()) {
            err = "Invalid text element";
            return false;
        }
        auto v = t.as<JsonObjectConst>();
        auto &e = c.texts[c.textCount++];
        int x, y, size;
        if (!text(v, "text", e.text, sizeof(e.text), true, err) ||
            !number(v, "x", 0, 220, x, err) || !number(v, "y", 0, 300, y, err) ||
            !number(v, "size", 14, 28, size, err) || !color(v, "color", e.color, err))
            return false;
        if (size != 14 && size != 20 && size != 28) {
            err = "Text size must be 14, 20 or 28";
            return false;
        }
        e.x = x;
        e.y = y;
        e.size = size;
    }
    for (auto t : shapes) {
        if (!t.is<JsonObjectConst>()) {
            err = "Invalid shape element";
            return false;
        }
        auto v = t.as<JsonObjectConst>();
        auto &e = c.shapes[c.shapeCount++];
        int x, y, w, h, r;
        if (!number(v, "x", 0, 239, x, err) || !number(v, "y", 0, 319, y, err) ||
            !number(v, "w", 1, 240, w, err) || !number(v, "h", 1, 320, h, err) ||
            !number(v, "radius", 0, 120, r, err) || !color(v, "color", e.color, err))
            return false;
        if (x + w > 240 || y + h > 320) {
            err = "Shape extends beyond badge";
            return false;
        }
        e.x = x;
        e.y = y;
        e.w = w;
        e.h = h;
        e.radius = r;
    }
    return true;
}
void deckToJson(const Deck &d, JsonDocument &doc) {
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
    if (a.size() < 1 || a.size() > maxCards) {
        err = "Keep between one and ten cards";
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
    d.count = 2;
    auto &c = d.cards[0];
    strcpy(c.id, "00000001");
    strcpy(c.title, "Hello, I'm N0rule");
    strcpy(c.name, "N0rule");
    strcpy(c.description, "IT enthusiast. Code, art and curious ideas.");
    strcpy(c.url, "https://n0rule.is-a.dev");
    auto &a = d.cards[1];
    strcpy(a.id, "00000002");
    strcpy(a.title, "Make something");
    strcpy(a.mode, "custom");
    a.background = 0x3659d9;
    a.shapeCount = 2;
    a.shapes[0] = {-0, 190, 240, 130, 0, 0xd9ceff};
    a.shapes[1] = {160, 24, 56, 56, 28, 0xb6e8d5};
    a.textCount = 3;
    strcpy(a.texts[0].text, "Make");
    a.texts[0].x = 20;
    a.texts[0].y = 82;
    a.texts[0].size = 28;
    a.texts[0].color = 0xffffff;
    strcpy(a.texts[1].text, "something.");
    a.texts[1].x = 20;
    a.texts[1].y = 118;
    a.texts[1].size = 28;
    a.texts[1].color = 0xffffff;
    strcpy(a.texts[2].text, "Take your ideas\nwith you.");
    a.texts[2].x = 20;
    a.texts[2].y = 230;
    a.texts[2].size = 20;
}
} // namespace badge
