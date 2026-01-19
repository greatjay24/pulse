use std::fs;
use std::path::Path;

fn main() {
    // Load .env file for compile-time environment variables
    // This allows env!() macro to work during local development
    let env_path = Path::new("../.env");
    if env_path.exists() {
        if let Ok(contents) = fs::read_to_string(env_path) {
            for line in contents.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((key, value)) = line.split_once('=') {
                    println!("cargo:rustc-env={}={}", key.trim(), value.trim());
                }
            }
        }
    }

    tauri_build::build()
}
