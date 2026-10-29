#pragma once
#include "../core/Core.h"
#include <ArduinoJson.h>
namespace badge {
struct Card {
    char id[9]{}, title[49]{}, mode[9]{"artwork"}, image[9]{};
    uint32_t background = 0xd9ceff, foreground = 0x23324d;
};
struct Deck {
    Card cards[maxCards]{};
    uint8_t count = 0;
    uint32_t revision = 0;
};
void cardToJson(const Card &, JsonObject);
bool cardFromJson(JsonObjectConst, Card &, String &error);
void deckToJson(const Deck &, JsonDocument &);
void deckToJson(const Deck &, JsonObject);
bool deckFromJson(JsonVariantConst, Deck &, String &error);
void defaults(Deck &);
} // namespace badge
