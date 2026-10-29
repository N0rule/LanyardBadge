#include "Transfer.h"
#include <algorithm>
namespace badge {
namespace {
uint32_t get32(const uint8_t *p) {
    return uint32_t(p[0]) | uint32_t(p[1]) << 8 | uint32_t(p[2]) << 16 | uint32_t(p[3]) << 24;
}
} // namespace
void Transfer::reset() {
    const bool interruptedCard = uploading_ || (authenticated_ && api_.pendingCardUpload());
    if (uploading_)
        assets_.abortUpload();
    if (authenticated_ || uploading_)
        api_.cancelCardUpload(interruptedCard);
    api_.release(this);
    receiving_ = uploading_ = responding_ = responseHeader_ = authenticated_ = false;
    request_ = response_ = token_ = "";
    responseFile_.close();
    fileOffset_ = fileLength_ = 0;
    header_ = "";
    waitingAck_ = false;
    lastActivity_ = millis();
}
void Transfer::answer(int code, const String &body) {
    receiving_ = false;
    responseCode_ = code;
    response_ = body;
    responding_ = true;
    responseHeader_ = false;
    sent_ = 0;
    waitingAck_ = false;
    request_ = "";
}
void Transfer::fail(int code, const char *message) {
    const bool cardTransfer = uploading_ || api_.pendingCardUpload();
    if (uploading_)
        assets_.abortUpload();
    uploading_ = false;
    if (cardTransfer && api_.progress)
        api_.progress(UploadPhase::Failed, 0);
    JsonDocument d;
    d["error"] = message;
    String out;
    serializeJson(d, out);
    answer(code, out);
}
void Transfer::packet(const uint8_t *p, size_t n) {
    if (n < 7 || n > 512 || !api_.claim(this)) {
        failed_ = true;
        return;
    }
    uint16_t seq = uint16_t(p[1]) | uint16_t(p[2]) << 8;
    uint32_t offset = get32(p + 3);
    uint8_t op = p[0];
    lastActivity_ = millis();
    if (op == 6 && n == 7 && offset == 0) {
        // A new browser page can inherit the same physical BLE connection.
        // Abandon old transfers before authenticating a new editor session.
        reset();
        api_.claim(this);
        api_.revokeSession();
        sessionStarted();
        sequence_ = seq;
        if (!notify(0, 0))
            failed_ = true;
        return;
    }
    if (op == 5) {
        if (responding_ && seq == sequence_ && offset == sent_) {
            waitingAck_ = false;
            if (authenticated_)
                api_.touchSession(token_);
        }
        // Late acknowledgements from an abandoned page are harmless.
        return;
    }
    // Request headers are fragmented as well: works at ATT MTU 23 (13 payload bytes).
    if (op == 4) {
        if (receiving_ || responding_ || offset != header_.length() ||
            header_.length() + n - 7 > 512 || n == 7) {
            fail(409, "Invalid request header fragments");
            header_ = "";
            return;
        }
        if (!header_.length())
            sequence_ = seq;
        if (seq != sequence_ || !header_.concat(reinterpret_cast<const char *>(p + 7), n - 7)) {
            fail(507, "Invalid header or insufficient memory");
            header_ = "";
            return;
        }
        receiving_ = false;
        if (!notify(0, header_.length()))
            failed_ = true;
        return;
    }
    if (op == 1) {
        if (receiving_ || responding_) {
            failed_ = true;
            return;
        }
        sequence_ = seq;
        JsonDocument d;
        auto err =
            header_.length() ? deserializeJson(d, header_) : deserializeJson(d, p + 7, n - 7);
        header_ = "";
        if (err || !d["length"].is<uint32_t>()) {
            fail(400, "Invalid transfer header");
            return;
        }
        method_ = d["method"] | "";
        path_ = d["path"] | "";
        token_ = d["token"] | "";
        length_ = d["length"];
        bool pairing = path_ == "/api/pair" && method_ == "POST";
        if (!pairing && (!authenticated_ || !api_.touchSession(token_))) {
            fail(401, "Connect and enter the code shown on the badge");
            return;
        }
        bool animation = path_ == "/api/animations";
        uploading_ = (path_ == "/api/assets" || animation) && method_ == "POST";
        if ((pairing && length_ > 256) || (!uploading_ && length_ > 24576) ||
            (uploading_ && (animation ? (length_ < 48 || length_ > maxAnimationBytes)
                                      : length_ != bitmapBytes))) {
            uploading_ = false;
            fail(413, "Transfer length is invalid");
            return;
        }
        if (uploading_) {
            String error;
            if (!assets_.beginUpload(error, length_, animation)) {
                uploading_ = false;
                fail(507, error.c_str());
                return;
            }
            if (api_.progress)
                api_.progress(UploadPhase::Receiving, 0);
        }
        received_ = 0;
        request_ = "";
        receiving_ = true;
        if (!notify(0, 0))
            failed_ = true;
        return;
    }
    if (!receiving_ || seq != sequence_ || offset != received_) {
        fail(409, "Transfer order mismatch");
        return;
    }
    if (op == 2) {
        if (n == 7 || received_ + n - 7 > length_) {
            fail(413, "Too many transfer bytes");
            return;
        }
        if (uploading_) {
            if (!assets_.append(p + 7, n - 7)) {
                fail(422, "Invalid image or storage full");
                return;
            }
        } else if (!request_.concat(reinterpret_cast<const char *>(p + 7), n - 7)) {
            fail(507, "Not enough memory");
            return;
        }
        received_ += n - 7;
        if (authenticated_)
            api_.touchSession(token_);
        if (uploading_ && api_.progress)
            api_.progress(UploadPhase::Receiving, received_ * 100U / length_);
        if (!notify(0, received_))
            failed_ = true;
    } else if (op == 3) {
        if (received_ != length_) {
            fail(422, "Transfer incomplete");
            return;
        }
        if (uploading_) {
            String id, error;
            bool ok = assets_.finishUpload(id, error);
            uploading_ = false;
            if (!ok) {
                if (api_.progress)
                    api_.progress(UploadPhase::Failed, 0);
                fail(422, error.c_str());
                return;
            }
            api_.cardAssetReady();
            answer(201, String("{\"id\":\"") + id + "\"}");
        } else if (method_ == "GET" && path_.startsWith("/api/image?id=")) {
            ImageRead read;
            char id[9]{};
            if (path_.length() >= 22)
                memcpy(id, path_.c_str() + 14, 8);
            uint32_t size = assets_.imageSize(id);
            if (!size || !imageRead(path_.c_str() + 14, read, size)) {
                fail(422, "Invalid artwork read range");
                return;
            }
            if (!assets_.bitmapExists(read.id)) {
                fail(404, "Image not found");
                return;
            }
            responseFile_ = LittleFS.open(assets_.imagePath(read.id), "r");
            if (!responseFile_) {
                fail(404, "Image unavailable");
                return;
            }
            fileOffset_ = read.offset;
            fileLength_ = read.length;
            answer(read.ranged ? 206 : 200, "");
        } else {
            String out;
            int code = path_ == "/api/pair"
                           ? pairSession(request_, out)
                           : api_.localRequest(method_, path_, request_, token_, out);
            if (path_ == "/api/pair")
                authenticated_ = code == 200;
            answer(code, out);
        }
    } else
        fail(400, "Unknown transfer operation");
}
void Transfer::transmit() {
    uint32_t total = responseFile_ ? fileLength_ : response_.length();
    if (!responseHeader_) {
        uint8_t code[2] = {uint8_t(responseCode_), uint8_t(responseCode_ >> 8)};
        if (notify(1, total, code, sizeof(code)))
            responseHeader_ = true;
        return;
    }
    if (waitingAck_)
        return;
    if (sent_ < total) {
        uint8_t chunk[500];
        size_t count = std::min<size_t>(
            std::min<size_t>(packetBytes > 7 ? packetBytes - 7 : 13, 500), total - sent_);
        if (responseFile_) {
            responseFile_.seek(fileOffset_ + sent_);
            if (responseFile_.read(chunk, count) != count) {
                failed_ = true;
                return;
            }
        } else
            memcpy(chunk, response_.c_str() + sent_, count);
        if (notify(2, sent_, chunk, count)) {
            sent_ += count;
            waitingAck_ = true;
            lastActivity_ = millis();
        }
    } else if (notify(3, total)) {
        response_ = "";
        responseFile_.close();
        responding_ = false;
    }
}
} // namespace badge
