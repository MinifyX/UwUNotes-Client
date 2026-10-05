//! Quitting from outside the window: the Dock's "Beenden", ⌘Q in the app
//! switcher, logging out, shutting down.
//!
//! Closing the window is guarded by the page (`App.tsx`): the session and the
//! drafts are written, then the window goes. On macOS the system can also end
//! the app without ever asking the window — it sends `terminate:` to the app,
//! and tao answers that by ending the event loop on the spot, so nothing would
//! be written. So here the app's delegate gets an `applicationShouldTerminate:`
//! of its own: the first time it answers "later", tells the page through a
//! `quit-requested` event, and the page runs the same close path as the
//! window's close button and then calls [`finish_quit`], which tells macOS to
//! go ahead (or not, when the person chose to stay). A logout waits for that
//! answer instead of being cancelled.
//!
//! What this does not touch: `RunEvent::ExitRequested`. In this Tauri version
//! it is only raised with no exit code once the last window is already gone —
//! which here only happens after the close path has run — and with a code for
//! `app.exit()` and `app.restart()`, which the updater uses on purpose
//! (`updates.rs`) after the page saved. Preventing either would leave a process
//! without a window or stop an update. And tao on macOS ends the loop with
//! `stop:`, not `terminate:`, so neither of those comes through here either.
//!
//! Windows and Linux have no such path: logging out closes the window, which
//! runs the page's own guard.

use tauri::AppHandle;

/// The event the page answers by running its close path.
#[cfg(target_os = "macos")]
const QUIT_EVENT: &str = "quit-requested";

/// The page's answer to `quit-requested`: `proceed` after the session is on
/// disk, or not when the person decided to stay. Does nothing when no quit is
/// waiting, and nothing at all off macOS.
#[tauri::command]
pub(crate) fn finish_quit(app: AppHandle, proceed: bool) {
    #[cfg(target_os = "macos")]
    mac::reply(&app, proceed);
    #[cfg(not(target_os = "macos"))]
    let _ = (app, proceed);
}

/// Hooks the app delegate. Called once from `setup`, on the main thread.
pub(crate) fn install(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    mac::install(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[cfg(target_os = "macos")]
mod mac {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::OnceLock;

    use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
    use objc2::{class, msg_send, sel};
    use tauri::{AppHandle, Emitter as _};

    use super::QUIT_EVENT;

    /// `NSApplicationTerminateReply`, an `NSUInteger`.
    const TERMINATE_NOW: usize = 1;
    const TERMINATE_LATER: usize = 2;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    /// A quit is waiting for the page's answer.
    static PENDING: AtomicBool = AtomicBool::new(false);
    /// The page has saved and said yes: any further `terminate:` goes through.
    static ALLOWED: AtomicBool = AtomicBool::new(false);

    type ShouldTerminate =
        unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize;

    unsafe extern "C-unwind" fn should_terminate(
        _this: *mut AnyObject,
        _cmd: Sel,
        _sender: *mut AnyObject,
    ) -> usize {
        if ALLOWED.load(Ordering::SeqCst) {
            return TERMINATE_NOW;
        }
        let Some(app) = APP.get() else {
            return TERMINATE_NOW;
        };
        // Asked twice while the page is still saving: the first question is
        // still open, so the answer is the same and the page is not asked again.
        if !PENDING.swap(true, Ordering::SeqCst) {
            if let Err(error) = app.emit(QUIT_EVENT, ()) {
                // Nobody to ask means nobody to wait for.
                tracing::warn!(%error, "could not ask the page before quitting");
                PENDING.store(false, Ordering::SeqCst);
                return TERMINATE_NOW;
            }
        }
        TERMINATE_LATER
    }

    pub(super) fn install(app: &AppHandle) {
        let _ = APP.set(app.clone());
        // SAFETY: called on the main thread from `setup`, after tao has set
        // its delegate. The method is added to the delegate's own class, which
        // does not implement `applicationShouldTerminate:` (tao only has
        // `applicationWillTerminate:`), with the type encoding of
        // `- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)`.
        unsafe {
            let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            if ns_app.is_null() {
                return;
            }
            let delegate: *mut AnyObject = msg_send![ns_app, delegate];
            if delegate.is_null() {
                tracing::warn!("no app delegate; quitting from the Dock will not save first");
                return;
            }
            let class: &AnyClass = (*delegate).class();
            let imp = std::mem::transmute::<ShouldTerminate, Imp>(should_terminate);
            let added = objc2::ffi::class_addMethod(
                (class as *const AnyClass).cast_mut(),
                sel!(applicationShouldTerminate:),
                imp,
                c"Q@:@".as_ptr(),
            );
            if !added.as_bool() {
                tracing::warn!("the app delegate already answers applicationShouldTerminate:");
            }
        }
    }

    pub(super) fn reply(app: &AppHandle, proceed: bool) {
        if !PENDING.swap(false, Ordering::SeqCst) {
            return;
        }
        if proceed {
            ALLOWED.store(true, Ordering::SeqCst);
        }
        let result = app.run_on_main_thread(move || {
            // SAFETY: on the main thread, with a quit waiting for this answer.
            unsafe {
                let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
                let _: () =
                    msg_send![ns_app, replyToApplicationShouldTerminate: Bool::new(proceed)];
            }
        });
        if let Err(error) = result {
            tracing::warn!(%error, "could not answer the quit");
        }
    }
}
