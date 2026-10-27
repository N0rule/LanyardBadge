#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>
namespace badge {
// BMP rows are read backwards. Align cache fills so nearby backwards reads reuse
// a block too; ordinary forward-only stream read-ahead cannot do that.
template <size_t BlockSize> class CachedReader {
    static_assert(BlockSize && !(BlockSize & (BlockSize - 1)), "Block size must be a power of two");
    uint8_t bytes_[BlockSize];
    uint32_t position_ = 0, base_ = 0;
    size_t valid_ = 0;
    bool loaded_ = false;

  public:
    uint32_t position() const { return position_; }
    bool seek(uint32_t position, uint32_t size) {
        if (position > size)
            return false;
        position_ = position;
        return true;
    }
    template <class Source> size_t read(Source &source, void *output, size_t length) {
        auto *target = static_cast<uint8_t *>(output);
        size_t copied = 0;
        while (copied < length && position_ < source.size()) {
            uint32_t block = position_ & ~uint32_t(BlockSize - 1);
            if (!loaded_ || base_ != block) {
                if (!source.seek(block))
                    break;
                valid_ = source.read(bytes_, BlockSize);
                base_ = block;
                loaded_ = true;
            }
            size_t offset = position_ - base_;
            if (offset >= valid_)
                break;
            size_t n = valid_ - offset;
            if (n > length - copied)
                n = length - copied;
            memcpy(target + copied, bytes_ + offset, n);
            copied += n;
            position_ += n;
        }
        return copied;
    }
};
} // namespace badge
