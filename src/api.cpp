#include "api.h"

#include "logging.h"
#include "security.h"
#include "version.h"
#include "wifi_setup.h"
#include "heater.h"
#include "fan.h"
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <Preferences.h>

namespace {
unsigned long lastWifiMutationMs = 0;
constexpr unsigned long WIFI_MUTATION_MIN_INTERVAL_MS = 3000;
}

void setupApi(AsyncWebServer *server) {
  log("setting up api");

  server->on(
      "/api/wifi", HTTP_POST,
      [](AsyncWebServerRequest *request) {
        // handled in body parser
      },
      NULL,
      [](AsyncWebServerRequest *request, uint8_t *data, size_t len,
         size_t index, size_t total) {
        if (index != 0 || len != total) {
          request->send(400, "application/json",
                        "{\"error\":\"chunked body not supported\"}");
          return;
        }

        if (!isAuthorizedRequest(request)) {
          return;
        }

        if (!hasValidCsrfHeader(request)) {
          request->send(403, "application/json",
                        "{\"error\":\"missing/invalid csrf header\"}");
          return;
        }

        unsigned long now = millis();
        if (now - lastWifiMutationMs < WIFI_MUTATION_MIN_INTERVAL_MS) {
          request->send(429, "application/json",
                        "{\"error\":\"too many wifi updates\"}");
          return;
        }

        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, data, len);
        if (err) {
          request->send(400, "application/json",
                        "{\"error\":\"invalid json\"}");
          return;
        }

        const char *ssid = doc["ssid"] | "";
        const char *pass = doc["pass"] | "";

        if (strlen(ssid) == 0 || strlen(pass) < 8) {
          request->send(
              400, "application/json",
              "{\"error\":\"ssid required and pass must be >=8 chars\"}");
          return;
        }

        Preferences prefs;
        prefs.begin(wifiPrefsKey, false);
        prefs.putString(wifiSSIDKey, ssid);
        prefs.putString(wifiPassKey, pass);
        prefs.end();

        lastWifiMutationMs = now;
        logf("saved wifi ssid to prefs: %s", ssid);
        request->send(200, "application/json", "{\"ok\":true}");
      });

  server->on("/api/info", HTTP_GET, [](AsyncWebServerRequest *request) {
    JsonDocument doc;
    doc["firmwareVersion"] = YAEGER_FW_VERSION;
    doc["networkMode"] = getWifiModeString();
    doc["ssid"] = getActiveSSID();
    doc["ip"] = getActiveIP();
    doc["hostname"] = getConfiguredHostname();
    doc["csrfToken"] = getCsrfToken();

    String body;
    serializeJson(doc, body);
    request->send(200, "application/json", body);
  });

  server->on("/api/control-settings", HTTP_GET,
             [](AsyncWebServerRequest *request) {
               JsonDocument doc;
               doc["heaterCyclePeriodMs"] = getHeaterCyclePeriodMs();
               doc["fanRampDelayMs"] = getFanRampDelayMs();

               JsonArray supported = doc["heaterCyclePeriodOptionsMs"].to<JsonArray>();
               supported.add(250);
               supported.add(500);
               supported.add(1000);
               supported.add(2000);
               JsonArray fanRampSupported = doc["fanRampDelayOptionsMs"].to<JsonArray>();
               fanRampSupported.add(0);
               fanRampSupported.add(10);
               fanRampSupported.add(25);
               fanRampSupported.add(50);
               fanRampSupported.add(100);

               String body;
               serializeJson(doc, body);
               request->send(200, "application/json", body);
             });

  server->on(
      "/api/control-settings", HTTP_POST,
      [](AsyncWebServerRequest *request) {
        // handled in body parser
      },
      NULL,
      [](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index,
         size_t total) {
        if (index != 0 || len != total) {
          request->send(400, "application/json",
                        "{\"error\":\"chunked body not supported\"}");
          return;
        }

        if (!isAuthorizedRequest(request)) {
          return;
        }

        if (!hasValidCsrfHeader(request)) {
          request->send(403, "application/json",
                        "{\"error\":\"missing/invalid csrf header\"}");
          return;
        }

        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, data, len);
        if (err) {
          request->send(400, "application/json", "{\"error\":\"invalid json\"}");
          return;
        }

        bool hasHeaterCyclePeriod = !doc["heaterCyclePeriodMs"].isNull();
        bool hasFanRampDelay = !doc["fanRampDelayMs"].isNull();
        if (!hasHeaterCyclePeriod && !hasFanRampDelay) {
          request->send(400, "application/json",
                        "{\"error\":\"no settings provided\"}");
          return;
        }

        if (hasHeaterCyclePeriod && !doc["heaterCyclePeriodMs"].is<long>()) {
          request->send(400, "application/json",
                        "{\"error\":\"heaterCyclePeriodMs must be numeric\"}");
          return;
        }

        if (hasFanRampDelay && !doc["fanRampDelayMs"].is<long>()) {
          request->send(400, "application/json",
                        "{\"error\":\"fanRampDelayMs must be numeric\"}");
          return;
        }

        long heaterCyclePeriodMs = getHeaterCyclePeriodMs();
        if (hasHeaterCyclePeriod) {
          heaterCyclePeriodMs = doc["heaterCyclePeriodMs"].as<long>();
          if (heaterCyclePeriodMs < 100) {
            heaterCyclePeriodMs = 100;
          } else if (heaterCyclePeriodMs > 5000) {
            heaterCyclePeriodMs = 5000;
          }
          setHeaterCyclePeriodMs(heaterCyclePeriodMs);
        }

        long fanRampDelayMs = getFanRampDelayMs();
        if (hasFanRampDelay) {
          fanRampDelayMs = doc["fanRampDelayMs"].as<long>();
          if (fanRampDelayMs < 0) {
            fanRampDelayMs = 0;
          } else if (fanRampDelayMs > 1000) {
            fanRampDelayMs = 1000;
          }
          setFanRampDelayMs(fanRampDelayMs);
        }

        Preferences prefs;
        prefs.begin("preferences", false);
        if (hasHeaterCyclePeriod) {
          prefs.putLong("heaterCycleMs", heaterCyclePeriodMs);
        }
        if (hasFanRampDelay) {
          prefs.putLong("fanRampMs", fanRampDelayMs);
        }
        prefs.end();

        JsonDocument response;
        response["ok"] = true;
        response["heaterCyclePeriodMs"] = getHeaterCyclePeriodMs();
        response["fanRampDelayMs"] = getFanRampDelayMs();
        String body;
        serializeJson(response, body);
        request->send(200, "application/json", body);
      });

  server->on("/api/logs", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send(200, "text/plain", getLogBuffer());
  });

  server->on("/api/logs", HTTP_DELETE, [](AsyncWebServerRequest *request) {
    if (!isAuthorizedRequest(request)) {
      return;
    }
    if (!hasValidCsrfHeader(request)) {
      request->send(403, "application/json",
                    "{\"error\":\"missing/invalid csrf header\"}");
      return;
    }
    clearLogBuffer();
    request->send(200, "application/json", "{\"ok\":true}");
  });

  server->on(
      "/api/logs/upload", HTTP_POST,
      [](AsyncWebServerRequest *request) {
        // handled in body parser
      },
      NULL,
      [](AsyncWebServerRequest *request, uint8_t *data, size_t len,
         size_t index, size_t total) {
        if (index != 0 || len != total) {
          request->send(400, "application/json",
                        "{\"error\":\"chunked body not supported\"}");
          return;
        }
        if (!isAuthorizedRequest(request)) {
          return;
        }
        if (!hasValidCsrfHeader(request)) {
          request->send(403, "application/json",
                        "{\"error\":\"missing/invalid csrf header\"}");
          return;
        }
        String uploaded;
        uploaded.reserve(len + 16);
        uploaded = "[uploaded] ";
        for (size_t i = 0; i < len; i++) {
          uploaded += char(data[i]);
        }
        appendExternalLog(uploaded);
        request->send(200, "application/json", "{\"ok\":true}");
      });
}
