#define word(...) 0 // Arduino macro must never intercept the decoder helper.
#define main original_animation_main
#include "animation_test.cpp"
#undef main
int main() {
 std::ifstream file("test-results/dictionary.lba", std::ios::binary);
 std::vector<uint8_t> bytes{std::istreambuf_iterator<char>(file), {}};
 assert(valid(bytes));
 Source source{bytes}; AnimationDecoder decoder;AnimationFrame frame;uint16_t row[240];unsigned at=0;
 assert(decoder.begin(source));
 assert(decoder.next(source,row,240,frame,[&](unsigned,unsigned,unsigned w,unsigned h,uint16_t *p){
  for(unsigned i=0;i<w*h;++i,++at)assert(p[i]==uint16_t((at%131)*503));return true;
 }));
 assert(at==76800 && decoder.finished());
 for(size_t n=0;n<bytes.size();++n){auto bad=bytes;bad.resize(n);assert(!valid(bad));}

 std::ifstream lf("test-results/dictionary-long.lba",std::ios::binary);
 std::vector<uint8_t> longer{std::istreambuf_iterator<char>(lf),{}};assert(valid(longer));
 auto bad=bytes;bad[48]=0;bad[49]=128;bad[50]=0;bad[51]=0;seal(bad);assert(!valid(bad));
}
