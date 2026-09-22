#include "segapsg.h"
#include <new>
extern "C" {
void* rack_psg_new(unsigned rate) { return new(std::nothrow) SegaPSG(rate); }
void rack_psg_delete(void* p) { delete static_cast<SegaPSG*>(p); }
void rack_psg_reset(void* p) { static_cast<SegaPSG*>(p)->reset(); }
void rack_psg_write(void* p, unsigned value) { static_cast<SegaPSG*>(p)->write(value); }
void rack_psg_pan(void* p, unsigned voice, float pan) { static_cast<SegaPSG*>(p)->set_pan(voice, pan); }
void rack_psg_sample(void* p, float* stereo) {
    static_cast<SegaPSG*>(p)->generate(stereo, stereo+1, 1);
}
}
