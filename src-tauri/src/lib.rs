use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use tauri::{Manager, Window};

// ---------------------------------------------------------------------------
// Book loading + encoding detection (mirrors the VSCode extension's encoding.ts)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct BookFile {
    text: String,
    encoding: String,
    byte_size: usize,
    base_name: String,
}

/// Validate whether a buffer is well-formed UTF-8 (scans a 64KB prefix for speed).
fn is_valid_utf8(buf: &[u8]) -> bool {
    let scan_len = buf.len().min(64 * 1024);
    let mut i = 0usize;
    while i < scan_len {
        let b = buf[i];
        if b <= 0x7f {
            i += 1;
        } else if (0xc2..=0xdf).contains(&b) {
            if i + 1 >= scan_len {
                break;
            }
            if buf[i + 1] & 0xc0 != 0x80 {
                return false;
            }
            i += 2;
        } else if (0xe0..=0xef).contains(&b) {
            if i + 2 >= scan_len {
                break;
            }
            if buf[i + 1] & 0xc0 != 0x80 || buf[i + 2] & 0xc0 != 0x80 {
                return false;
            }
            i += 3;
        } else if (0xf0..=0xf4).contains(&b) {
            if i + 3 >= scan_len {
                break;
            }
            if buf[i + 1] & 0xc0 != 0x80
                || buf[i + 2] & 0xc0 != 0x80
                || buf[i + 3] & 0xc0 != 0x80
            {
                return false;
            }
            i += 4;
        } else {
            return false;
        }
    }
    true
}

fn decode_buffer(buf: &[u8], forced: &str) -> (String, String) {
    // Forced encoding.
    match forced {
        "utf-8" => return (String::from_utf8_lossy(buf).into_owned(), "utf-8".into()),
        "gbk" | "gb18030" => {
            let (cow, _, _) = encoding_rs::GB18030.decode(buf);
            return (cow.into_owned(), "gb18030".into());
        }
        _ => {}
    }

    // BOM checks.
    if buf.len() >= 3 && buf[0] == 0xef && buf[1] == 0xbb && buf[2] == 0xbf {
        return (String::from_utf8_lossy(&buf[3..]).into_owned(), "utf-8".into());
    }
    if buf.len() >= 2 && buf[0] == 0xff && buf[1] == 0xfe {
        let (cow, _, _) = encoding_rs::UTF_16LE.decode(buf);
        return (cow.into_owned(), "utf-16le".into());
    }
    if buf.len() >= 2 && buf[0] == 0xfe && buf[1] == 0xff {
        let (cow, _, _) = encoding_rs::UTF_16BE.decode(buf);
        return (cow.into_owned(), "utf-16be".into());
    }

    if is_valid_utf8(buf) {
        return (String::from_utf8_lossy(buf).into_owned(), "utf-8".into());
    }

    // Fallback: GB18030 is a superset of GBK and covers most Chinese txt files.
    let (cow, _, _) = encoding_rs::GB18030.decode(buf);
    (cow.into_owned(), "gb18030".into())
}

#[derive(Serialize)]
pub struct FileBytes {
    base64: String,
    byte_size: usize,
    base_name: String,
}

/// Read a file's raw bytes (base64) — for binary formats (EPUB/FB2) parsed in the webview.
#[tauri::command]
fn read_bytes(path: String) -> Result<FileBytes, String> {
    use base64::Engine;
    let p = PathBuf::from(&path);
    let bytes = fs::read(&p).map_err(|e| format!("读取失败: {e}"))?;
    let base_name = p
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "book".into());
    Ok(FileBytes {
        base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
        byte_size: bytes.len(),
        base_name,
    })
}

#[tauri::command]
fn read_book(path: String, forced: Option<String>) -> Result<BookFile, String> {
    let p = PathBuf::from(&path);
    let bytes = fs::read(&p).map_err(|e| format!("读取失败: {e}"))?;
    let forced = forced.unwrap_or_else(|| "auto".into());
    let (text, encoding) = decode_buffer(&bytes, &forced);
    let base_name = p
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "book.txt".into());
    Ok(BookFile {
        text,
        encoding,
        byte_size: bytes.len(),
        base_name,
    })
}

// ---------------------------------------------------------------------------
// State persistence (a single JSON blob in the app config dir — like globalState)
// ---------------------------------------------------------------------------

fn state_path(window: &Window) -> Result<PathBuf, String> {
    let dir = window
        .app_handle()
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法定位配置目录: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建配置目录: {e}"))?;
    Ok(dir.join("fishreader-state.json"))
}

#[tauri::command]
fn load_state(window: Window) -> Result<String, String> {
    let path = state_path(&window)?;
    match fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(_) => Ok("{}".into()),
    }
}

#[tauri::command]
fn save_state(window: Window, json: String) -> Result<(), String> {
    let path = state_path(&window)?;
    fs::write(&path, json).map_err(|e| format!("保存失败: {e}"))
}

// ---------------------------------------------------------------------------
// Boss-mode window actions (desktop has no editor tab — we hide/minimize instead)
// ---------------------------------------------------------------------------

#[tauri::command]
fn boss_window(window: Window, action: String) -> Result<(), String> {
    let map = |e: tauri::Error| e.to_string();
    match action.as_str() {
        "minimize" => window.minimize().map_err(map),
        "hide" => window.hide().map_err(map),
        "show" => {
            window.show().map_err(map)?;
            window.unminimize().ok();
            window.set_focus().map_err(map)
        }
        "pin" => window.set_always_on_top(true).map_err(map),
        "unpin" => window.set_always_on_top(false).map_err(map),
        _ => Ok(()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_global_shortcut::Builder::new().build())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            read_book,
            read_bytes,
            load_state,
            save_state,
            boss_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
