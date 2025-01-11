#include <SPI.h>
#include <XPT2046_Touchscreen.h>
#include <TFT_eSPI.h>
#include "pfp_icon.h"  // Header file containing the bitmap image array
// Pin definitions already in your code
SPIClass mySpi = SPIClass(VSPI);
XPT2046_Touchscreen ts(XPT2046_CS, XPT2046_IRQ);
TFT_eSPI tft = TFT_eSPI();

// Badge configuration
const char* TOP_NAME = "N0rule.is-a.dev";
const char* NAME = "N0rule";
const char* DESC1 = "IT Enthusiast";
const char* DESC2 = "Love to Code";
const char* DESC3 = "Watch Anime";
const char* DESC4 = "ESP32 320x240";

// Colors (matching the original palette)
const uint16_t LIGHTEST = tft.color565(208, 208, 88);
const uint16_t LIGHT = tft.color565(160, 168, 64);
const uint16_t DARK = tft.color565(112, 128, 40);
const uint16_t DARKEST = tft.color565(64, 80, 16);

// Constants
const int BORDER_SIZE = 4;
const int PADDING = 10;
const int TOP_NAME_HEIGHT = 35;
const int SCREEN_WIDTH = 320;  // Adjust to your screen
const int SCREEN_HEIGHT = 240; // Adjust to your screen

// Brightness modes (0, 25, 50, 100)
int brightnessModes[] = {0, 25, 50, 100};
int BRIGHTNESS = 25;  // Start at 25% brightness
bool isTouching = false; // Track if screen is being touched

// Variables to control animation timing
unsigned long lastSwitchTime = 0;  // Last time the image switched
unsigned long switchInterval = 15000;  // Interval for switching images (in milliseconds)




void drawBadge() {
  // Draw border
  tft.fillScreen(LIGHTEST);
  
  // Draw background
  tft.fillRect(BORDER_SIZE, BORDER_SIZE, 
               SCREEN_WIDTH - (BORDER_SIZE * 2), 
               SCREEN_HEIGHT - (BORDER_SIZE * 2), 
               DARK);
  
  // Draw TOP_NAME box
  tft.fillRect(BORDER_SIZE, BORDER_SIZE,
               SCREEN_WIDTH - (BORDER_SIZE * 2),
               TOP_NAME_HEIGHT,
               DARKEST);
  
  // Draw TOP_NAME text
  tft.setTextColor(LIGHT);
  tft.setTextSize(2);
  tft.setCursor(BORDER_SIZE + PADDING, BORDER_SIZE + PADDING);
  tft.println(TOP_NAME);
  
  // Draw name
  tft.setTextColor(LIGHTEST);
  tft.setTextSize(5);
  tft.setCursor(BORDER_SIZE + PADDING, BORDER_SIZE + PADDING + TOP_NAME_HEIGHT);
  tft.println(NAME);
  
  // Draw bullet points and DESCs
  tft.setTextSize(2);
  int startY = 105;
  for (const char* DESC : {DESC1, DESC2, DESC3, DESC4}) {
    tft.setTextColor(DARKEST);
    tft.setCursor(BORDER_SIZE + PADDING + 120 + PADDING, startY);
    tft.print("*");
    tft.setTextColor(LIGHTEST);
    tft.setCursor(BORDER_SIZE + PADDING + 135 + PADDING, startY);
    tft.println(DESC);
    
    startY += 35;
  }
  
// tft.drawRect(PADDING + BORDER_SIZE - 5, 
//              SCREEN_HEIGHT - ((BORDER_SIZE * 2) + PADDING) - 115 - 1, 
//              120 + 2,  // Width of the border (120 + 2 pixels)
//              120 + 2,  // Height of the border (120 + 2 pixels)
//              DARK);  // Border color

// Display the image in the photo placeholder
      tft.drawBitmap(PADDING + BORDER_SIZE, 
                     SCREEN_HEIGHT - ((BORDER_SIZE * 2) + PADDING) - 115, 
                     epd_bitmap_pfp_icon,  // First image
                     120,  // Width of the image
                     120, 
                     LIGHT,  // Image color
                     DARKEST);  // Background color
}

void BrightnessControl() {
  BRIGHTNESS = (BRIGHTNESS + 1) % 4; // Cycle through 0, 25, 50, 100
  int brightness = brightnessModes[BRIGHTNESS];
  
  if (brightness >= 0 && brightness <= 100) {
    analogWrite(TFT_BL, brightness * 2.55);  // Set the new brightness
    Serial.println("Brightness set to: " + String(brightness));
  } else {
    Serial.println("TFT BACKLIGHT Error \r\n");
  }
}

void animatePFP() {
  // Get the current time
  unsigned long currentTime = millis();

  // Check if it's time to switch the image
  if (currentTime - lastSwitchTime >= switchInterval) {
    lastSwitchTime = currentTime;  // Update the last switch time

    // Clear the area (optional, to avoid image overlap)
    tft.fillRect(PADDING + BORDER_SIZE, 
                 SCREEN_HEIGHT - ((BORDER_SIZE * 2) + PADDING) - 115, 
                 120, 
                 120, 
                 LIGHT);  // Clear with background color

    // Alternate between the two images
    static bool showFirstImage = false;  // Track which image to show

    if (showFirstImage) {
      tft.drawBitmap(PADDING + BORDER_SIZE, 
                     SCREEN_HEIGHT - ((BORDER_SIZE * 2) + PADDING) - 115, 
                     epd_bitmap_pfp_icon,  // First image
                     120,  // Width of the image
                     120, 
                     LIGHT,  // Image color
                     DARKEST);  // Background color
    } else {
      tft.drawBitmap(PADDING + BORDER_SIZE, 
                     SCREEN_HEIGHT - ((BORDER_SIZE * 2) + PADDING) - 115, 
                     epd_bitmap_pfp_icon2,  // Second image
                     120,  // Width of the image
                     120, 
                     LIGHT,  // Image color
                     DARKEST);  // Background color
    }

    // Toggle between the two images
    showFirstImage = !showFirstImage;
  }
}


void setup() {
  Serial.begin(115200);
  
  // Initialize touch screen
  mySpi.begin(XPT2046_CLK, XPT2046_MISO, XPT2046_MOSI, XPT2046_CS);
  ts.begin(mySpi);
  ts.setRotation(3);

  // Initialize display
  tft.init();
  tft.setRotation(3);
  
  drawBadge();
}

void printTouchToSerial() {
  if (ts.tirqTouched() && ts.touched()&& !isTouching) {
    isTouching = true; // Mark as touching
    TS_Point p = ts.getPoint();
    BrightnessControl(); // Change brightness when touched
    Serial.println("P = " + String(p.z) + "|x = " + String(p.x) + "|y = " + String(p.y));
  }
  else if (!ts.tirqTouched()) {  // Reset the touching state when the touch is released
  isTouching = false;
  }
}



void loop() {
  // Check for touch and cycle brightness
  animatePFP();
  printTouchToSerial();
  delay(100);
}

