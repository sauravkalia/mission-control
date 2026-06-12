use std::process::Child;
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

// Holds the bundled Node server child so we can reap it when the app exits.
struct ServerProcess(Mutex<Option<Child>>);

// In dev, `beforeDevCommand` (pnpm dev) already runs the server + Vite. In a
// packaged build there's no dev server, so launch the bundled Node backend.
#[cfg(not(debug_assertions))]
fn spawn_server(app: &tauri::AppHandle) {
    if let Ok(dir) = app.path().resource_dir() {
        let entry = dir.join("resources").join("server.mjs");
        match std::process::Command::new("node").arg(&entry).spawn() {
            Ok(child) => *app.state::<ServerProcess>().0.lock().unwrap() = Some(child),
            Err(e) => eprintln!("[mc] failed to start server (is `node` installed?): {e}"),
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(ServerProcess(Mutex::new(None)))
        .setup(|_app| {
            #[cfg(not(debug_assertions))]
            spawn_server(&_app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Mission Control")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(mut child) = app.state::<ServerProcess>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
