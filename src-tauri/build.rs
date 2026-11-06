fn main() {
    tauri_build::build();

    // Tauri's own manifest (embedded into the app binary by tauri-build) asks
    // for Common-Controls v6. Test executables do not get that manifest, so on
    // Windows they can bind the legacy comctl32 5.82, which lacks imports such
    // as TaskDialogIndirect, and the process dies with STATUS_ENTRYPOINT_NOT_FOUND.
    // Embedding the same dependency for test binaries keeps `cargo test` usable.
    #[cfg(windows)]
    {
        let manifest = std::path::Path::new("windows-test.manifest");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }
}
