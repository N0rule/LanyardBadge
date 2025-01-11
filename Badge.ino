#include <SPI.h>
#include <XPT2046_Touchscreen.h>
#include <TFT_eSPI.h>
#include "pfp_icon.h"

// Hardware configuration
SPIClass mySpi = SPIClass(VSPI);
XPT2046_Touchscreen ts(XPT2046_CS, XPT2046_IRQ);
TFT_eSPI tft = TFT_eSPI();

// Badge content configuration
const char* TOP_NAME = "N0rule.is-a.dev";
const char* NAME = "N0rule";
const char* DESCRIPTIONS[] = {
    "IT Enthusiast",
    "Love to Code",
    "Watch Anime",
    "ESP32 320x240"
};

// Screen constants
constexpr int SCREEN_WIDTH = 320;
constexpr int SCREEN_HEIGHT = 240;
constexpr int BORDER_SIZE = 4;
constexpr int PADDING = 10;
constexpr int TOP_NAME_HEIGHT = 35;

// Color palette structure
struct ColorPalette {
    uint16_t lightest;
    uint16_t light;
    uint16_t dark;
    uint16_t darkest;
    const char* name;
};

// Refined retro color palettes
const ColorPalette PALETTES[] = {
    // GameBoy - Green tones
    {
        0xDED6, // Lightest (208, 208, 88)
        0xA534, // Light (160, 168, 64)
        0x7408, // Dark (112, 128, 40)
        0x4284, // Darkest (64, 80, 16)
        "GameBoy"
    },
    // Commodore VIC-20
    {
        0xFFDD, // Lightest (255, 251, 232)
        0xFCA0, // Light (255, 164, 0)
        0xC800, // Dark (200, 0, 0)
        0x6800, // Darkest (104, 0, 0)
        "VIC-20"
    },
    // ZX Spectrum - Blue theme
    {
        0xEF7D, // Lightest (238, 239, 239)
        0x651F, // Light (99, 162, 255)
        0x421F, // Dark (66, 129, 255)
        0x001F, // Darkest (0, 0, 255)
        "ZX Blue"
    },
    // Atari 2600 - Sunset
    {
        0xFE19, // Lightest (255, 195, 204)
        0xFB2C, // Light (255, 153, 153)
        0xE124, // Dark (227, 73, 35)
        0x8800, // Darkest (136, 0, 0)
        "Atari"
    },
    // NES - Purple theme
    {
        0xFFDF, // Lightest (255, 255, 255)
        0xF81F, // Light (255, 0, 255)
        0x780F, // Dark (119, 0, 119)
        0x4007, // Darkest (64, 0, 64)
        "NES"
    },
    // Apple II - Monochrome
    {
        0xFFFF, // Lightest (255, 255, 255)
        0xBDF7, // Light (189, 189, 189)
        0x7BEF, // Dark (123, 123, 123)
        0x0000, // Darkest (0, 0, 0)
        "Apple II"
    }
};

// State management
const int NUM_PALETTES = sizeof(PALETTES) / sizeof(PALETTES[0]);
int currentPalette = 0;
int currentBrightnessIndex = 1; // Start at 25%
const int BRIGHTNESS_LEVELS[] = {0, 25, 50, 100};
bool isTouching = false;
bool currentImageAlternate = false;

// Animation timing
unsigned long lastImageSwitch = 0;
constexpr unsigned long IMAGE_SWITCH_INTERVAL = 15000; // 15 seconds

// New palette switch timing
unsigned long lastPaletteSwitch = 0;
constexpr unsigned long PALETTE_SWITCH_INTERVAL = 30000; // 30 seconds

// Function prototypes
void drawBadgeFrame(bool preserveImage = false);
void drawTexts();
void drawProfileImage();
void handleTouch();
void updateAnimations();
void cyclePalette();
void cycleBrightness();

void setup() {
    Serial.begin(115200);
    
    // Initialize touch screen
    mySpi.begin(XPT2046_CLK, XPT2046_MISO, XPT2046_MOSI, XPT2046_CS);
    ts.begin(mySpi);
    ts.setRotation(3);

    // Initialize display
    tft.init();
    tft.setRotation(3);
    
    // Initialize backlight
    pinMode(TFT_BL, OUTPUT);
    analogWrite(TFT_BL, BRIGHTNESS_LEVELS[currentBrightnessIndex] * 2.55);
    
    // Initial draw
    drawBadgeFrame();
}

void loop() {
    handleTouch();
    updateAnimations();
    delay(16);
}

void drawBadgeFrame(bool preserveImage) {
    const auto& palette = PALETTES[currentPalette];
    
    tft.startWrite();
    
    // Optimized border and background drawing
    tft.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, palette.dark);
    tft.fillRect(0, 0, SCREEN_WIDTH, BORDER_SIZE, palette.lightest);
    tft.fillRect(0, SCREEN_HEIGHT - BORDER_SIZE, SCREEN_WIDTH, BORDER_SIZE, palette.lightest);
    tft.fillRect(0, 0, BORDER_SIZE, SCREEN_HEIGHT, palette.lightest);
    tft.fillRect(SCREEN_WIDTH - BORDER_SIZE, 0, BORDER_SIZE, SCREEN_HEIGHT, palette.lightest);
    
    // Header bar
    tft.fillRect(BORDER_SIZE, BORDER_SIZE,
                 SCREEN_WIDTH - (BORDER_SIZE * 2),
                 TOP_NAME_HEIGHT,
                 palette.darkest);
    
    tft.endWrite();
    
    drawTexts();
    if (!preserveImage) {
        drawProfileImage();
    }
}

// Animation frame counter
int waveFrame = 0;

void drawTexts() {
    const auto& palette = PALETTES[currentPalette];

    // Draw TOP_NAME
    tft.setTextColor(palette.light);
    tft.setTextSize(2);
    tft.setCursor(BORDER_SIZE + PADDING, BORDER_SIZE + PADDING);
    tft.println(TOP_NAME);

    // Draw Palette Name aligned to the upper-right corner
    tft.setTextSize(2);  // Ensure text size is consistent
    int paletteNameWidth = tft.textWidth(palette.name);
    tft.setCursor(SCREEN_WIDTH - paletteNameWidth - BORDER_SIZE - PADDING, BORDER_SIZE + PADDING);
    tft.setTextColor(palette.lightest);
    tft.println(palette.name);

    // Draw NAME
    tft.setTextColor(palette.lightest);
    tft.setTextSize(5);
    tft.setCursor(BORDER_SIZE + PADDING, BORDER_SIZE + PADDING + TOP_NAME_HEIGHT);
    tft.println(NAME);

    // Draw descriptions
    tft.setTextSize(2);
    int startY = 105;

    for (const char* desc : DESCRIPTIONS) {
        tft.setTextColor(palette.darkest);
        tft.setCursor(BORDER_SIZE + PADDING + 120 + PADDING, startY);
        tft.print("*");

        tft.setTextColor(palette.lightest);
        tft.setCursor(BORDER_SIZE + PADDING + 135 + PADDING, startY);
        tft.println(desc);

        startY += 35;
    }
}



void drawProfileImage() {
    const uint8_t* currentImage = currentImageAlternate ? epd_bitmap_pfp_icon2 : epd_bitmap_pfp_icon;
    
    tft.startWrite();
    tft.drawBitmap(PADDING + BORDER_SIZE, 
                   SCREEN_HEIGHT - ((BORDER_SIZE * 2) + PADDING) - 115, 
                   currentImage,
                   120,
                   120,
                   PALETTES[currentPalette].light,
                   PALETTES[currentPalette].darkest);
    tft.endWrite();
    serial.println("Drawing profile image" );
}

void handleTouch() {
    static unsigned long lastTapTime = 0;
    static bool waitingForDoubleTap = false;
    const unsigned long DOUBLE_TAP_DELAY = 220;
    
    if (ts.tirqTouched() && ts.touched() && !isTouching) {
        isTouching = true;
        TS_Point p = ts.getPoint();
        unsigned long currentTime = millis();
        
        if (waitingForDoubleTap) {
            // Double tap detected
            if (currentTime - lastTapTime < DOUBLE_TAP_DELAY) {
                cycleBrightness();
                waitingForDoubleTap = false;
            }
        } else {
            // First tap
            lastTapTime = currentTime;
            waitingForDoubleTap = true;
        }
        
        Serial.println("Touch: X=" + String(p.x) + " Y=" + String(p.y) + " P=" + String(p.z));
    }
    else if (!ts.tirqTouched()) {
        isTouching = false;
        
        // Check if we should process as single tap
        if (waitingForDoubleTap && (millis() - lastTapTime >= DOUBLE_TAP_DELAY)) {
            cyclePalette();
            waitingForDoubleTap = false;
        }
    }
}

void cyclePalette() {
    int nextPalette = (currentPalette + 1) % NUM_PALETTES;
    if (nextPalette != currentPalette) {
        currentPalette = nextPalette;
        drawBadgeFrame(true); // Preserve current image state
        drawProfileImage();
        Serial.println("Palette: " + String(PALETTES[currentPalette].name));
    }
}

void cycleBrightness() {
    currentBrightnessIndex = (currentBrightnessIndex + 1) % 4;
    analogWrite(TFT_BL, BRIGHTNESS_LEVELS[currentBrightnessIndex] * 2.55);
    Serial.println("Brightness: " + String(BRIGHTNESS_LEVELS[currentBrightnessIndex]) + "%");
}

void updateAnimations() {
    unsigned long currentTime = millis();

    // Image switch logic
    if (currentTime - lastImageSwitch >= IMAGE_SWITCH_INTERVAL) {
        currentImageAlternate = !currentImageAlternate;
        drawProfileImage();
        lastImageSwitch = currentTime;
    }

    // Automatic palette switch logic
    if (currentTime - lastPaletteSwitch >= PALETTE_SWITCH_INTERVAL) {
        cyclePalette();
        lastPaletteSwitch = currentTime;
    }
}