/*
  Trust Link Check — ESP8266 ESP-12E development board
  LCD: 16x2 I2C (SDA=D2/GPIO4, SCL=D1/GPIO5)
  Green LED (SAFE): D5/GPIO14 through 220-330 ohm resistor
  Red LED (DANGEROUS or NOT VERIFIED): D6/GPIO12 through 220-330 ohm resistor
  Push button: D7/GPIO13 to GND (INPUT_PULLUP)

  Install Arduino libraries: LiquidCrystal I2C and ArduinoJson (v6 or compatible).
  In Arduino IDE choose an ESP8266 board such as "NodeMCU 1.0 (ESP-12E Module)".
*/

#include <ESP8266WiFi.h>
#include <WiFiClientSecure.h>
#include <ESP8266HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// ---- EDIT THESE 3 VALUES BEFORE UPLOADING ----
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* DEVICE_KEY = "PASTE_THE_SAME_DEVICE_KEY_FROM_RENDER";
const char* SERVER_URL = "https://YOUR-RENDER-SERVICE.onrender.com/api/device/latest";
// ---------------------------------------------

#define LCD_SDA D2
#define LCD_SCL D1
#define GREEN_LED D5
#define RED_LED D6
#define PUSH_BUTTON D7

LiquidCrystal_I2C lcd(0x27, 16, 2);
unsigned long lastPollMs = 0;
const unsigned long POLL_INTERVAL_MS = 15000;
int lastButtonReading = HIGH;
int stableButtonState = HIGH;
unsigned long lastDebounceMs = 0;
const unsigned long DEBOUNCE_MS = 50;

void printRow(uint8_t row, const String& text) {
  lcd.setCursor(0, row);
  lcd.print("                ");
  lcd.setCursor(0, row);
  lcd.print(text.substring(0, 16));
}

void showUnverified(const String& row1, const String& row2) {
  digitalWrite(GREEN_LED, LOW);
  digitalWrite(RED_LED, HIGH);
  printRow(0, row1);
  printRow(1, row2);
}

void applyStatus(const String& status, const String& reason) {
  if (status == "SAFE") {
    digitalWrite(GREEN_LED, HIGH);
    digitalWrite(RED_LED, LOW);
    printRow(0, "TRUST LINK CHECK");
    printRow(1, "STATUS: SAFE");
    Serial.println("Latest status: SAFE");
  } else {
    // Fail closed: anything missing/unknown/unverified is shown as DANGEROUS.
    digitalWrite(GREEN_LED, LOW);
    digitalWrite(RED_LED, HIGH);
    printRow(0, "DANGEROUS LINK!");
    printRow(1, "DO NOT PAY!");
    Serial.print("Latest status: DANGEROUS / NOT VERIFIED. Reason: ");
    Serial.println(reason);
  }
}

bool serverSettingsPresent() {
  return String(WIFI_SSID) != "YOUR_WIFI_NAME" &&
         String(SERVER_URL).indexOf("YOUR-RENDER-SERVICE") < 0 &&
         String(DEVICE_KEY) != "PASTE_THE_SAME_DEVICE_KEY_FROM_RENDER";
}

void fetchLatestResult() {
  if (WiFi.status() != WL_CONNECTED) {
    showUnverified("WIFI OFFLINE", "DO NOT PAY");
    Serial.println("Wi-Fi disconnected; cannot verify latest result.");
    return;
  }

  WiFiClientSecure secureClient;
  // Prototype convenience only: encrypts HTTPS traffic but skips certificate validation.
  // For a production security device, validate the server certificate/root CA instead.
  secureClient.setInsecure();

  HTTPClient http;
  http.setTimeout(10000);
  if (!http.begin(secureClient, SERVER_URL)) {
    showUnverified("SERVER ERROR", "DO NOT PAY");
    Serial.println("Could not start HTTPS request.");
    return;
  }
  http.addHeader("x-device-key", DEVICE_KEY);
  int code = http.GET();
  if (code != HTTP_CODE_OK) {
    Serial.printf("Server request failed: HTTP %d\n", code);
    showUnverified("NOT VERIFIED", "DO NOT PAY");
    http.end();
    return;
  }

  String payload = http.getString();
  http.end();

  StaticJsonDocument<1024> doc;
  DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    Serial.print("JSON parse error: ");
    Serial.println(error.c_str());
    showUnverified("BAD SERVER DATA", "DO NOT PAY");
    return;
  }

  String status = doc["status"] | "DANGEROUS";
  String reason = doc["reason"] | "No verification result";
  applyStatus(status, reason);
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  printRow(0, "Connecting WiFi");
  printRow(1, "Please wait...");
  Serial.print("Connecting to Wi-Fi");
  unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 20000) {
    delay(300);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi connected. IP: ");
    Serial.println(WiFi.localIP());
    printRow(0, "WiFi Connected");
    printRow(1, "Loading status");
  } else {
    showUnverified("WIFI OFFLINE", "DO NOT PAY");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(GREEN_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);
  pinMode(PUSH_BUTTON, INPUT_PULLUP);
  digitalWrite(GREEN_LED, LOW);
  digitalWrite(RED_LED, HIGH);  // Red until a trusted result is fetched.

  Wire.begin(LCD_SDA, LCD_SCL);
  lcd.init();
  lcd.backlight();
  showUnverified("NOT VERIFIED", "DO NOT PAY");

  if (!serverSettingsPresent()) {
    showUnverified("SET WIFI/API", "IN CODE FIRST");
    Serial.println("Edit Wi-Fi name/password, Render server URL, and DEVICE_KEY first.");
    return;
  }

  connectWiFi();
  if (WiFi.status() == WL_CONNECTED) {
    fetchLatestResult();
    lastPollMs = millis();
  }
}

void loop() {
  // If setup stopped because the placeholder values were not changed, do nothing else.
  if (!serverSettingsPresent()) return;

  if (WiFi.status() != WL_CONNECTED) {
    showUnverified("WIFI OFFLINE", "DO NOT PAY");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    delay(1000);
    return;
  }

  int reading = digitalRead(PUSH_BUTTON);
  if (reading != lastButtonReading) lastDebounceMs = millis();
  if (millis() - lastDebounceMs > DEBOUNCE_MS && reading != stableButtonState) {
    stableButtonState = reading;
    if (stableButtonState == LOW) {
      // The button refreshes the server result; it does NOT toggle SAFE/DANGEROUS locally.
      fetchLatestResult();
      lastPollMs = millis();
    }
  }
  lastButtonReading = reading;

  if (millis() - lastPollMs >= POLL_INTERVAL_MS) {
    fetchLatestResult();
    lastPollMs = millis();
  }
  delay(10);
}
