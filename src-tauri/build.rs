fn main() {
    println!("cargo:rerun-if-changed=vendor/ymfm");
    println!("cargo:rerun-if-changed=src/ymfm_bridge.cpp");
    cc::Build::new().cpp(true).std("c++14").include("vendor/ymfm")
        .file("src/ymfm_bridge.cpp").file("vendor/ymfm/ymfm_opn.cpp")
        .file("vendor/ymfm/ymfm_adpcm.cpp").file("vendor/ymfm/ymfm_ssg.cpp")
        .warnings(false).compile("tetorica_ymfm");
    tauri_build::build()
}
