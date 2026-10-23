# Trust Link Check — Website + Public API + ESP8266

This starter project links a static website, a public API and an ESP-12E/ESP8266 development board. It is a student prototype, not a payment processor. A SAFE result means only that the selected lookup did not report a known unsafe match; it does **not** guarantee a shop, seller, or payment is genuine. If the lookup is unavailable, the system fails closed and reports DANGEROUS / NOT VERIFIED.

## What is included

- `frontend/index.html` — front-end site. Copy this into the root of your GitHub Pages site (for the existing project, likely the repository that publishes `https://mahaagomu.github.io/MONEY/`). Set `API_BASE` after the backend is deployed.
- `backend/server.js` — Express API. It checks the supplied URL with Google Safe Browsing and stores the latest result in memory for the ESP8266.
- `hardware/TrustLinkCheck_ESP8266.ino` — ESP8266 firmware. It polls the public API, controls the LCD and LEDs, and uses the push button to refresh the latest result.
- `render.yaml` — Render Blueprint for a free public Web Service (may also configure from the Render dashboard manually).

## A. Host the backend publicly on Render

1. Put this project in a GitHub repository. The repository may contain `backend/`, `hardware/`, `frontend/`, and `render.yaml`.
2. In Render, choose **New → Blueprint** and select the repository containing `render.yaml`. If Blueprint is unavailable, create **New → Web Service**, select the repository, set **Root Directory** to `backend`, **Build Command** to `npm install`, and **Start Command** to `npm start`.
3. Select the free plan for a college demo. Render gives the service a public URL resembling `https://trust-link-check-api.onrender.com`. Copy the actual URL shown in your dashboard; do not guess it.
4. In the service's **Environment** settings, add:
   - `SAFE_BROWSING_API_KEY` — create an API key in Google Cloud and enable the Google Safe Browsing API for a non-commercial project. Keep the key only in Render Environment Variables; never put it in frontend HTML or a public repository.
   - `DEVICE_KEY` — a long random secret string. Use the same value in the ESP8266 sketch. Do not share it publicly.
   - `FRONTEND_ORIGINS` — for the existing GitHub Pages account site, set `https://mahaagomu.github.io` (origin only; no `/MONEY/`).
5. Deploy/redeploy. Test `https://YOUR-ACTUAL-RENDER-URL/health`; it should return JSON with `"ok":true`.
6. Render's free web services can sleep after inactivity and may restart; initial requests can take time. Latest result is stored only in memory and resets after a restart, so submit a new link after any restart.

## B. Host the website on GitHub Pages

1. Open the repository that publishes your site.
2. Copy `frontend/index.html` to the repository's published root as `index.html` (keep a backup of your old file first).
3. Edit the line near the bottom: `const API_BASE = "https://YOUR-RENDER-SERVICE.onrender.com";` and replace it with the exact Render URL from step A. Do not add `/api/check` at the end.
4. Commit/push the change. In GitHub, open **Settings → Pages** and confirm the site publishes from the intended branch/folder.
5. Wait for Pages to publish, then open your public website and test a link. You can also test the server's health path directly.

## C. Configure Arduino IDE / ESP8266

1. Install ESP8266 board support in Arduino IDE using Boards Manager. Select a board that matches your USB development board, commonly **NodeMCU 1.0 (ESP-12E Module)**.
2. Install compatible libraries: **LiquidCrystal I2C** and **ArduinoJson** (v6-compatible).
3. Open `hardware/TrustLinkCheck_ESP8266.ino` and edit the Wi-Fi name, Wi-Fi password, exact Render URL (`/api/device/latest` path included), and the same `DEVICE_KEY` used in Render.
4. Select the correct COM port and upload over the USB cable. Open Serial Monitor at 115200 baud.
5. The board polls every 15 seconds and also fetches immediately when you press the push button. Button press refreshes the server result; it does not fake-toggle the verdict.

## D. Wiring (ESP-12E development board with D-pin labels)

- LCD I2C GND → GND
- LCD I2C SDA → D2 (GPIO4)
- LCD I2C SCL → D1 (GPIO5)
- Green LED anode → 220–330 Ω resistor → D5 (GPIO14); cathode → GND
- Red LED anode → 220–330 Ω resistor → D6 (GPIO12); cathode → GND
- Push button terminal 1 → D7 (GPIO13); terminal 2 → GND
- ESP8266 board power → laptop USB

**LCD voltage:** many 16×2 I2C backpacks are designed for 5 V and pull SDA/SCL up to their VCC. ESP8266 GPIOs are 3.3 V only. For a 5 V LCD backpack, power the LCD from the board's USB-derived 5 V/VIN only if supported, and place a bidirectional I2C logic-level shifter between ESP8266 D1/D2 and LCD SCL/SDA. If the particular backpack is confirmed 3.3 V-compatible (including pull-ups), it can be powered at 3.3 V and connected directly. Do not apply 5 V to ESP8266 GPIO pins or to the board's 3V3 pin.

## E. Important limitations

- Google Safe Browsing is a known-threat lookup, not a full audit of a website. A clean lookup is not a guarantee of safety.
- If the API key is missing, the lookup is down, or the URL is rejected, the result is DANGEROUS / NOT VERIFIED (red LED).
- This simple demo keeps only one latest result in server memory. It is for one hardware prototype, not a multi-user production system.
- The ESP8266 example uses `WiFiClientSecure::setInsecure()` for easier student-demo HTTPS connectivity. This encrypts traffic but skips server-certificate validation; do not use this setting for a real payment/security product. Production hardware should validate the server certificate/root CA.
- The hardware indicates a recommendation; it does not actually authorize or block a bank payment.
