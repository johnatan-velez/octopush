use std::path::PathBuf;

fn main() {
    // Tauri's externalBin validates that the triple-suffixed binary exists at a
    // path relative to CARGO_MANIFEST_DIR (the src-tauri/ folder).
    //
    // We copy `target/<profile>/octopush-pty-server` →
    //         `<manifest-dir>/octopush-pty-server-<target-triple>`
    //
    // so the bundler can find it during `tauri build`.
    //
    // Path computation for OUT_DIR:
    //   OUT_DIR = .../target/<profile>/build/<pkg>-<hash>/out
    //   ancestors():
    //     nth(0) = .../target/<profile>/build/<pkg>-<hash>/out  (the dir itself)
    //     nth(1) = .../target/<profile>/build/<pkg>-<hash>
    //     nth(2) = .../target/<profile>/build
    //     nth(3) = .../target/<profile>        ← this is what we want

    let target_triple = std::env::var("TARGET").unwrap_or_default();
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default());

    if !target_triple.is_empty() && manifest_dir.exists() {
        let dst_name = format!("octopush-pty-server-{target_triple}");
        let dst = manifest_dir.join(&dst_name);

        // Locate the already-built daemon binary.
        let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap_or_default());
        // nth(3) in ancestors() = .../target/<profile>/
        let src_opt = out_dir
            .ancestors()
            .nth(3)
            .map(|p| p.join("octopush-pty-server"))
            .filter(|p| p.exists() && p.metadata().map(|m| m.len() > 0).unwrap_or(false));

        if let Some(src) = src_opt {
            // Real binary is built — copy to manifest dir with triple suffix.
            match std::fs::copy(&src, &dst) {
                Ok(_) => {
                    println!("cargo:rerun-if-changed={}", src.display());
                }
                Err(e) => {
                    println!(
                        "cargo:warning=build.rs: could not copy {} → {}: {e}",
                        src.display(),
                        dst.display()
                    );
                }
            }
        } else if !dst.exists() {
            // Daemon binary not built yet — create a small placeholder so that
            // tauri-build's externalBin validation passes.  The real binary will
            // overwrite this during `tauri build`.
            if let Err(e) = std::fs::write(&dst, b"") {
                println!(
                    "cargo:warning=build.rs: could not create placeholder {}: {e}",
                    dst.display()
                );
            } else {
                println!(
                    "cargo:warning=build.rs: created placeholder {}; \
                     run `cargo build --bin octopush-pty-server` first",
                    dst.display()
                );
            }
        }
        // If dst already exists but src is empty/missing, leave dst in place.
    }

    tauri_build::build();
}
