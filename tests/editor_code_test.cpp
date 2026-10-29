#include "../src/core/EditorCode.h"
#include <cassert>
int main() {
 badge::EditorCode c; char text[5];
 badge::EditorCode::letters(731,text); // ABDF, any valid four letters.
 c.begin(731,100);assert(c.check(text,101)==200);assert(c.check(text,102)==403);
 c.begin(0,200);assert(c.check("aaaa",201)==200);
 c.begin(0,300);assert(c.check("AAAA",120300)==403);
 for(int i=0;i<5;i++){c.begin(0,400+i);assert(c.check("ZZZZ",400+i)==(i==4?429:401));c.close();}
 c.begin(0,500);assert(c.check("AAAA",500)==429);
 assert(!c.blocked(30404));c.begin(0,30405);assert(c.check("AAAA",30406)==200);
 c.begin(0,UINT32_MAX-100);assert(c.check("AAAA",50)==200);
}
