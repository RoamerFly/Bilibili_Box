fn main() {
    println!("cargo:rerun-if-env-changed=BILIBOX_UPDATER_PUBLIC_KEY");
    tauri_build::build()
}
