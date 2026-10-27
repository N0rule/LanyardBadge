#pragma once
#include "../core/Core.h"
#include <ArduinoJson.h>
namespace badge {
struct TextElement {
    char text[97]{};
    int16_t x = 20, y = 20;
    uint8_t size = 20;
    uint32_t color = 0x23324d;
};
struct ShapeElement {
    int16_t x = 12, y = 12;
    uint16_t w = 60, h = 60;
    uint8_t radius = 12;
    uint32_t color = 0x3659d9;
};
struct Card {
    char id[9]{}, title[49]{}, mode[9]{"profile"}, image[9]{};
    char name[49]{}, description[97]{}, url[101]{};
    uint32_t background = 0xd9ceff, foreground = 0x23324d, accent = 0x3659d9;
    TextElement texts[maxElements]{};
    ShapeElement shapes[maxElements]{};
    uint8_t textCount = 0, shapeCount = 0;
};
struct Deck {
    Card cards[maxCards]{};
    uint8_t count = 0;
    uint32_t revision = 0;
};
void cardToJson(const Card &, JsonObject);
bool cardFromJson(JsonObjectConst, Card &, String &error);
void deckToJson(const Deck &, JsonDocument &);
bool deckFromJson(JsonVariantConst, Deck &, String &error);
void defaults(Deck &);
} // namespace badge
