#include "ymfm_opn.h"
#include <new>
struct Synth {
    ymfm::ymfm_interface interface;
    ymfm::ym2612 chip;
    Synth(): chip(interface) { chip.reset(); }
};
extern "C" {
void* rack_chip_new() { return new(std::nothrow) Synth; }
void rack_chip_delete(void* p) { delete static_cast<Synth*>(p); }
void rack_chip_reset(void* p) { static_cast<Synth*>(p)->chip.reset(); }
void rack_chip_write(void* p, unsigned port, unsigned reg, unsigned value) {
    auto& chip=static_cast<Synth*>(p)->chip;
    chip.write(port*2, reg); chip.write(port*2+1, value);
}
void rack_chip_sample(void* p, float* stereo) {
    ymfm::ym2612::output_data out;
    static_cast<Synth*>(p)->chip.generate(&out);
    stereo[0]=out.data[0]/32768.0f; stereo[1]=out.data[1]/32768.0f;
}
unsigned rack_chip_divider(void* p) {
    return 1440000 / static_cast<Synth*>(p)->chip.sample_rate(1440000);
}
}
