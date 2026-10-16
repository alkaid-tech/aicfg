pub mod domain;
pub mod engine;
pub mod files;
pub mod planner;
pub mod repository;
#[cfg(target_os = "macos")]
mod runtime;
pub mod source;

#[cfg(feature = "desktop")]
pub fn run() {
    use std::sync::{Arc, Mutex};
    use tauri::Manager;
    #[tauri::command]
    async fn dispatch(
        state: tauri::State<'_, Arc<Mutex<engine::Engine>>>,
        request: engine::Request,
    ) -> domain::Result<engine::Response> {
        let engine = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            engine
                .lock()
                .map_err(|_| "Application state lock is unavailable".to_string())?
                .execute(request)
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    async fn dispatch_with_progress(
        state: tauri::State<'_, Arc<Mutex<engine::Engine>>>,
        request: engine::Request,
        on_progress: tauri::ipc::Channel<String>,
    ) -> domain::Result<engine::Response> {
        let engine = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            engine
                .lock()
                .map_err(|_| "Application state lock is unavailable".to_string())?
                .execute_with_progress(request, &|message| {
                    let _ = on_progress.send(message.to_string());
                })
        })
        .await
        .map_err(|e| e.to_string())?
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let preference = app
                .path()
                .app_config_dir()?
                .join("configuration-repository");
            app.manage(Arc::new(Mutex::new(engine::Engine::new(Some(preference)))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![dispatch, dispatch_with_progress])
        .run(tauri::generate_context!())
        .expect("Could not start aicfg");
}
