#include "Network.h"
#include <HTTPClient.h>
#include <atomic>
#include <fcntl.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <lwip/sockets.h>
#include <unistd.h>
namespace badge {
namespace {
std::atomic<bool> testRunning{false};
// Use explicit IPv4 socket addresses for bounded local diagnostic connections.
int localSocket(IPAddress ip) {
    int fd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (fd < 0)
        return -1;
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_port = htons(80);
    address.sin_addr.s_addr = ip;
    fcntl(fd, F_SETFL, fcntl(fd, F_GETFL, 0) | O_NONBLOCK);
    int result = ::connect(fd, reinterpret_cast<sockaddr *>(&address), sizeof(address));
    if (result < 0 && errno != EINPROGRESS) {
        Serial.printf("SELFTEST socket connect errno=%d\n", errno);
        ::close(fd);
        return -1;
    }
    fd_set writes;
    FD_ZERO(&writes);
    FD_SET(fd, &writes);
    timeval timeout{2, 0};
    int error = 0;
    socklen_t size = sizeof(error);
    if (select(fd + 1, nullptr, &writes, nullptr, &timeout) <= 0 ||
        getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &size) < 0 || error) {
        Serial.printf("SELFTEST socket error=%d errno=%d\n", error, errno);
        ::close(fd);
        return -1;
    }
    fcntl(fd, F_SETFL, fcntl(fd, F_GETFL, 0) & ~O_NONBLOCK);
    return fd;
}
struct TestContext {
    char password[17];
    IPAddress ip;
};
uint8_t sampleByte(size_t n) {
    static const uint8_t header[] = {66, 77,  66, 88, 2,   0,  0, 0,   0, 0, 66, 0,  0, 0, 40, 0, 0,
                                     0,  240, 0,  0,  0,   64, 1, 0,   0, 1, 0,  16, 0, 3, 0,  0, 0,
                                     0,  88,  2,  0,  0,   0,  0, 0,   0, 0, 0,  0,  0, 0, 0,  0, 0,
                                     0,  0,   0,  0,  248, 0,  0, 224, 7, 0, 0,  31, 0, 0, 0};
    return n < sizeof(header) ? header[n] : uint8_t(n & 255);
}
class ImageStream : public Stream {
    size_t at_ = 0;
    bool corrupt_;

  public:
    ImageStream(bool corrupt = false) : corrupt_(corrupt) {}
    int available() override { return bitmapBytes - at_; }
    int read() override {
        if (at_ >= bitmapBytes)
            return -1;
        size_t n = at_++;
        return corrupt_ && n == 0 ? 'X' : sampleByte(n);
    }
    int peek() override {
        return at_ >= bitmapBytes ? -1 : corrupt_ && at_ == 0 ? 'X' : sampleByte(at_);
    }
    void flush() override {}
    size_t write(uint8_t) override { return 0; }
};
void run(void *arg) {
    auto *context = static_cast<TestContext *>(arg);
    String base = "http://" + context->ip.toString();
    String token;
    unsigned passed = 0, failed = 0;
    auto check = [&](const char *name, int actual, int expected) {
        bool ok = actual == expected;
        if (ok)
            ++passed;
        else
            ++failed;
        Serial.printf("SELFTEST %s: %s (%d / %d)\n", name, ok ? "PASS" : "FAIL", actual, expected);
    };
    auto request = [&](const char *path, const char *method, const String &body, String &out,
                       const char *type = "application/json", bool authorized = true) {
        int fd = localSocket(context->ip);
        if (fd < 0)
            return -100;
        WiFiClient client(fd);
        HTTPClient http;
        http.setTimeout(4000);
        http.setConnectTimeout(2000);
        http.begin(client, base + path);
        if (authorized && token.length())
            http.addHeader("Authorization", "Bearer " + token);
        if (!strcmp(method, "POST"))
            http.addHeader("Content-Type", type);
        int code = !strcmp(method, "GET") ? http.GET() : http.POST(body);
        out = http.getString();
        http.end();
        return code;
    };
    String out;
    Serial.println("SELFTEST START (local TCP; no external Wi-Fi required)");
    Serial.printf("SELFTEST target: %s\n", context->ip.toString().c_str());
    int first = request("/api/status", "GET", "", out);
    check("authentication required", first, 401);
    if (first < 0) {
        Serial.println("SELFTEST DONE: 0 passed, 1 failed (TCP transport unavailable)");
        memset(context->password, 0, sizeof(context->password));
        delete context;
        testRunning.store(false);
        vTaskDelete(nullptr);
        return;
    }
    check("wrong pairing password", request("/api/pair", "POST", "{\"password\":\"wrong\"}", out),
          401);
    JsonDocument pairing;
    pairing["password"] = context->password;
    String payload;
    serializeJson(pairing, payload);
    check("pair", request("/api/pair", "POST", payload, out), 200);
    JsonDocument d;
    deserializeJson(d, out);
    token = d["token"].as<String>();
    check("authenticated status", request("/api/status", "GET", "", out), 200);
    deserializeJson(d, out);
    unsigned originalSelected = d["selected"] | 0;
    check("display requires authentication",
          request("/api/display", "POST", "{}", out, "application/json", false), 401);
    check("show badge without closing editor", request("/api/display", "POST", "{}", out), 200);
    check("editor still reachable", request("/api/status", "GET", "", out), 200);
    deserializeJson(d, out);
    check("badge screen is visible", d["screen"] == "badge" ? 1 : 0, 1);
    check("read cards", request("/api/cards", "GET", "", out), 200);
    String original = out;
    check("invalid settings", request("/api/settings", "POST", "{\"brightness\":0}", out), 422);
    check("path traversal rejected", request("/api/image?id=../cards", "GET", "", out), 404);
    check("short bitmap rejected", request("/api/assets", "POST", "invalid", out, "image/bmp"),
          413);
    check("wrong content type", request("/api/cards", "POST", "{}", out, "text/plain"), 415);
    check("malformed JSON rejected", request("/api/cards", "POST", "{broken", out), 422);
    deserializeJson(d, original);
    d["revision"] = d["revision"].as<uint32_t>() + 1;
    payload = "";
    serializeJson(d, payload);
    check("stale revision rejected", request("/api/cards", "POST", payload, out), 409);
    deserializeJson(d, original);
    d["cards"][0]["id"] = "../../xx";
    payload = "";
    serializeJson(d, payload);
    check("invalid card ID", request("/api/cards", "POST", payload, out), 422);
    check("transactional unchanged save", request("/api/cards", "POST", original, out), 200);
    deserializeJson(d, out);
    if (d["cards"].size()) {
        JsonDocument choice;
        choice["id"] = d["cards"][originalSelected]["id"];
        payload = "";
        serializeJson(choice, payload);
        for (int i = 0; i < 12; ++i)
            check("repeated selection", request("/api/select", "POST", payload, out), 200);
    }
    auto image = [&](bool corrupt) {
        int fd = localSocket(context->ip);
        if (fd < 0)
            return -100;
        WiFiClient client(fd);
        HTTPClient http;
        http.setTimeout(5000);
        http.begin(client, base + "/api/assets");
        http.addHeader("Authorization", "Bearer " + token);
        http.addHeader("Content-Type", "image/bmp");
        ImageStream stream(corrupt);
        int code = http.sendRequest("POST", &stream, bitmapBytes);
        out = http.getString();
        http.end();
        return code;
    };
    check("invalid full bitmap rejected", image(true), 422);
    check("complete image upload", image(false), 201);
    deserializeJson(d, out);
    String id = d["id"] | "";
    if (id.length()) {
        int fd = localSocket(context->ip);
        if (fd < 0) {
            check("download socket", 500, 200);
        } else {
            WiFiClient client(fd);
            HTTPClient http;
            http.setTimeout(4000);
            http.begin(client, base + "/api/image?id=" + id);
            http.addHeader("Authorization", "Bearer " + token);
            int code = http.GET();
            check("read uploaded image", code, 200);
            uint8_t chunk[1024];
            size_t received = 0;
            bool valid = code == 200;
            auto *stream = http.getStreamPtr();
            while (code == 200 && received < bitmapBytes) {
                size_t n = bitmapBytes - received;
                if (n > sizeof(chunk))
                    n = sizeof(chunk);
                size_t count = stream->readBytes(chunk, n);
                if (!count) {
                    valid = false;
                    break;
                }
                for (size_t i = 0; i < count; ++i)
                    if (chunk[i] != sampleByte(received + i))
                        valid = false;
                received += count;
            }
            valid = valid && received == bitmapBytes;
            http.end();
            check("uploaded image bytes", valid ? 200 : 500, 200);
        }
    }
    {
        int fd = localSocket(context->ip);
        if (fd >= 0) {
            WiFiClient client(fd);
            client.print("POST /api/assets HTTP/1.1\r\nHost: badge\r\nContent-Type: "
                         "image/bmp\r\nAuthorization: Bearer " +
                         token + "\r\nContent-Length: 153666\r\nConnection: close\r\n\r\n");
            uint8_t header[66];
            for (unsigned i = 0; i < 66; ++i)
                header[i] = sampleByte(i);
            client.write(header, 66);
            client.stop();
        }
    }
    check("recovery after interrupted upload", request("/api/status", "GET", "", out), 200);
    check("clean orphan background", request("/api/gc", "POST", "{}", out), 200);
    check("editor served", request("/", "GET", "", out), 200);
    Serial.printf("SELFTEST DONE: %u passed, %u failed; heap=%u\n", passed, failed,
                  unsigned(ESP.getFreeHeap()));
    memset(context->password, 0, sizeof(context->password));
    delete context;
    testRunning.store(false);
    vTaskDelete(nullptr);
}
} // namespace
bool Network::selfTest() {
    if (!active_ || !assets_.ready()) {
        Serial.println("Open setup and initialize storage before selftest");
        return false;
    }
    if (testRunning.exchange(true))
        return false;
    auto *context = new TestContext{};
    strlcpy(context->password, settings_.value.apPassword, sizeof(context->password));
    context->ip = IPAddress(127, 0, 0, 1);
    if (xTaskCreate(run, "badge-api-test", 8192, context, 1, nullptr) != pdPASS) {
        delete context;
        testRunning.store(false);
        return false;
    }
    return true;
}
} // namespace badge
