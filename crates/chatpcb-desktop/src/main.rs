use chatpcb_core::design::esp32s3_usb_sensor_board_spec;
use chatpcb_core::layout::freerouting_contract;
use chatpcb_core::manufacturing::build_jlcpcb_package;
use chatpcb_core::provider::catalog_with_probe;
use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize)]
struct DesktopSelfTest {
    app_name: &'static str,
    ui_runtime: &'static str,
    transport: &'static str,
    layout: LayoutContract,
    chat_transcript: ChatTranscriptContract,
    left_tabs: Vec<&'static str>,
    right_panel: Vec<&'static str>,
    supported_board: String,
    autorouter: String,
    manufacturing_outputs: Vec<String>,
    providers: Vec<String>,
}

#[derive(Debug, Serialize)]
struct LayoutContract {
    left_ratio: f32,
    right_ratio: f32,
}

#[derive(Debug, Serialize)]
struct ChatTranscriptContract {
    multiline: bool,
    read_only: bool,
}

fn main() {
    if std::env::args().any(|arg| arg == "--self-test") {
        print_self_test();
        return;
    }

    run_desktop_app();
}

fn print_self_test() {
    let spec = esp32s3_usb_sensor_board_spec("ESP32-S3 USB-C sensor board");
    let package = build_jlcpcb_package(&spec);
    let route = freerouting_contract();
    let providers = catalog_with_probe(probe_command_version)
        .into_iter()
        .map(|provider| provider.display_name)
        .collect();

    let contract = DesktopSelfTest {
        app_name: "ChatPCB KiCad Preview",
        ui_runtime: "native-win32",
        transport: "stdio-jsonl",
        layout: LayoutContract {
            left_ratio: 0.7,
            right_ratio: 0.3,
        },
        chat_transcript: ChatTranscriptContract {
            multiline: true,
            read_only: true,
        },
        left_tabs: vec![
            "Schematic",
            "PCB Layout",
            "Validation",
            "Manufacturing Preview",
        ],
        right_panel: vec![
            "Provider Login",
            "Model selector",
            "Chat transcript",
            "Chat input",
            "Send design",
            "Pipeline status",
        ],
        supported_board: spec.product_name,
        autorouter: format!("{} {}", route.engine, route.bundled_version),
        manufacturing_outputs: package.files,
        providers,
    };

    println!("{}", serde_json::to_string_pretty(&contract).unwrap());
}

fn probe_command_version(command: &str) -> Option<String> {
    let output = Command::new(command).arg("--version").output().ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !stdout.is_empty() {
        Some(stdout)
    } else if !stderr.is_empty() {
        Some(stderr)
    } else {
        Some(format!("{command} available"))
    }
}

#[cfg(not(windows))]
fn run_desktop_app() {
    eprintln!("chatpcb-desktop is currently implemented for Windows only.");
}

#[cfg(windows)]
fn run_desktop_app() {
    win32_app::run();
}

#[cfg(windows)]
mod win32_app {
    use std::mem::zeroed;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows_sys::Win32::Graphics::Gdi::{GetStockObject, UpdateWindow, WHITE_BRUSH};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::Controls::{TCIF_TEXT, TCITEMW, TCM_INSERTITEMW};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetClientRect, GetMessageW,
        GetWindowLongPtrW, LoadCursorW, MoveWindow, PostQuitMessage, RegisterClassW, SendMessageW,
        SetWindowLongPtrW, SetWindowTextW, ShowWindow, TranslateMessage, CB_ADDSTRING,
        CB_SETCURSEL, CW_USEDEFAULT, ES_AUTOVSCROLL, ES_MULTILINE, ES_READONLY, GWLP_USERDATA,
        HMENU, IDC_ARROW, MSG, SW_SHOW, WINDOW_EX_STYLE, WM_COMMAND, WM_DESTROY, WM_NCDESTROY,
        WM_SIZE, WNDCLASSW, WS_BORDER, WS_CHILD, WS_CLIPSIBLINGS, WS_OVERLAPPEDWINDOW, WS_TABSTOP,
        WS_VISIBLE, WS_VSCROLL,
    };

    const APP_TITLE: &str = "ChatPCB KiCad Preview";
    const CLASS_NAME: &str = "ChatPcbKiCadPreviewWindow";
    const ID_SEND_DESIGN: usize = 1001;

    struct AppControls {
        left_pane: HWND,
        tabs: HWND,
        status: HWND,
        chat_transcript: HWND,
        prompt: HWND,
        send_button: HWND,
        provider_button: HWND,
        model_choice: HWND,
        pipeline_status: HWND,
    }

    pub fn run() {
        unsafe {
            let instance = GetModuleHandleW(null());
            register_window_class(instance);

            let title = wide(APP_TITLE);
            let class = wide(CLASS_NAME);
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                title.as_ptr(),
                WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                CW_USEDEFAULT,
                CW_USEDEFAULT,
                1280,
                820,
                null_mut(),
                null_mut(),
                instance,
                null_mut(),
            );

            if hwnd.is_null() {
                return;
            }

            let controls = Box::new(create_controls(hwnd, instance));
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, Box::into_raw(controls) as isize);
            layout(hwnd);

            ShowWindow(hwnd, SW_SHOW);
            UpdateWindow(hwnd);

            let mut message: MSG = zeroed();
            while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
    }

    unsafe fn register_window_class(instance: HINSTANCE) {
        let class = wide(CLASS_NAME);
        let wc = WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(window_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: instance,
            hIcon: null_mut(),
            hCursor: LoadCursorW(null_mut(), IDC_ARROW),
            hbrBackground: GetStockObject(WHITE_BRUSH) as _,
            lpszMenuName: null(),
            lpszClassName: class.as_ptr(),
        };

        RegisterClassW(&wc);
    }

    unsafe fn create_controls(parent: HWND, instance: HINSTANCE) -> AppControls {
        let left_pane = child(
            parent,
            instance,
            "STATIC",
            "Current Project: ESP32-S3 USB-C Sensor Board",
            WS_BORDER,
            0,
        );
        let tabs = child(
            parent,
            instance,
            WC_TABCONTROLW_STR,
            "",
            WS_CLIPSIBLINGS | WS_TABSTOP,
            0,
        );
        add_tab(tabs, 0, "Schematic");
        add_tab(tabs, 1, "PCB Layout");
        add_tab(tabs, 2, "Validation");
        add_tab(tabs, 3, "Manufacturing Preview");

        let status = child(
            parent,
            instance,
            "STATIC",
            "Schematic/PCB canvas placeholder: KiCad native editors attach here in the fork.",
            WS_BORDER,
            0,
        );
        let chat_transcript = child(
            parent,
            instance,
            "EDIT",
            "Assistant: Describe the PCB you want to build.\r\nSystem: ESP32-S3 USB-C sensor board target is ready.\r\n",
            WS_BORDER
                | WS_VSCROLL
                | ES_MULTILINE as u32
                | ES_AUTOVSCROLL as u32
                | ES_READONLY as u32,
            0,
        );
        let prompt = child(
            parent,
            instance,
            "EDIT",
            "USB-C ESP32-S3 sensor board with I2C sensor and JLCPCB package",
            WS_BORDER,
            0,
        );
        let send_button = child(
            parent,
            instance,
            "BUTTON",
            "Send design",
            WS_TABSTOP,
            ID_SEND_DESIGN,
        );
        let provider_button = child(parent, instance, "BUTTON", "Provider Login", WS_TABSTOP, 0);
        let model_choice = child(parent, instance, "COMBOBOX", "", WS_TABSTOP, 0);
        add_combo_item(model_choice, "codex:auto");
        add_combo_item(model_choice, "claude:auto");
        add_combo_item(model_choice, "gemini:auto");
        SendMessageW(model_choice, CB_SETCURSEL, 0, 0);
        let pipeline_status = child(
            parent,
            instance,
            "STATIC",
            "Pipeline: requirements -> schematic -> placement -> autoroute -> DRC -> JLCPCB package",
            WS_BORDER,
            0,
        );

        AppControls {
            left_pane,
            tabs,
            status,
            chat_transcript,
            prompt,
            send_button,
            provider_button,
            model_choice,
            pipeline_status,
        }
    }

    unsafe fn child(
        parent: HWND,
        instance: HINSTANCE,
        class_name: &str,
        text: &str,
        extra_style: u32,
        control_id: usize,
    ) -> HWND {
        let class = wide(class_name);
        let text = wide(text);

        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class.as_ptr(),
            text.as_ptr(),
            WS_CHILD | WS_VISIBLE | extra_style,
            0,
            0,
            10,
            10,
            parent,
            control_id as HMENU,
            instance,
            null_mut(),
        )
    }

    unsafe fn add_tab(tabs: HWND, index: i32, label: &str) {
        let mut text = wide(label);
        let mut item = TCITEMW {
            mask: TCIF_TEXT,
            dwState: 0,
            dwStateMask: 0,
            pszText: text.as_mut_ptr(),
            cchTextMax: text.len() as i32,
            iImage: 0,
            lParam: 0,
        };
        SendMessageW(
            tabs,
            TCM_INSERTITEMW,
            index as usize,
            &mut item as *mut _ as isize,
        );
    }

    unsafe fn add_combo_item(combo: HWND, label: &str) {
        let text = wide(label);
        SendMessageW(combo, CB_ADDSTRING, 0, text.as_ptr() as isize);
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_COMMAND => {
                if (wparam & 0xffff) == ID_SEND_DESIGN {
                    handle_send_design(hwnd);
                    return 0;
                }

                DefWindowProcW(hwnd, msg, wparam, lparam)
            }
            WM_SIZE => {
                layout(hwnd);
                0
            }
            WM_DESTROY => {
                PostQuitMessage(0);
                0
            }
            WM_NCDESTROY => {
                let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppControls;
                if !ptr.is_null() {
                    SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
                    drop(Box::from_raw(ptr));
                }
                DefWindowProcW(hwnd, msg, wparam, lparam)
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    unsafe fn layout(hwnd: HWND) {
        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return;
        }

        let controls = &*ptr;
        let mut rect: RECT = zeroed();
        GetClientRect(hwnd, &mut rect);

        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        let margin = 12;
        let gap = 10;
        let left_width = ((width - margin * 2 - gap) as f32 * 0.70) as i32;
        let right_width = width - margin * 2 - gap - left_width;
        let right_x = margin + left_width + gap;

        MoveWindow(controls.left_pane, margin, margin, left_width, 34, 1);
        MoveWindow(
            controls.tabs,
            margin,
            margin + 42,
            left_width,
            height - margin * 2 - 120,
            1,
        );
        MoveWindow(
            controls.status,
            margin,
            height - margin - 68,
            left_width,
            68,
            1,
        );

        MoveWindow(
            controls.chat_transcript,
            right_x,
            margin,
            right_width,
            height - 214,
            1,
        );
        MoveWindow(controls.prompt, right_x, height - 190, right_width, 58, 1);
        MoveWindow(
            controls.send_button,
            right_x,
            height - 122,
            right_width,
            30,
            1,
        );
        MoveWindow(controls.provider_button, right_x, height - 82, 132, 32, 1);
        MoveWindow(
            controls.model_choice,
            right_x + 142,
            height - 82,
            right_width - 142,
            180,
            1,
        );
        MoveWindow(
            controls.pipeline_status,
            right_x,
            height - 40,
            right_width,
            32,
            1,
        );
    }

    unsafe fn handle_send_design(hwnd: HWND) {
        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return;
        }

        let controls = &*ptr;
        let transcript = wide(
            "User: USB-C ESP32-S3 sensor board with I2C sensor and JLCPCB package\r\n\
             Assistant: I created the fixed ESP32-S3 target spec, selected the JLCPCB package contract, \
             and queued schematic -> placement -> Freerouting autoroute -> DRC -> manufacturing package.\r\n\
             Status: preview only. Full KiCad fork integration is the next implementation gate.\r\n",
        );
        SetWindowTextW(controls.chat_transcript, transcript.as_ptr());
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    const WC_TABCONTROLW_STR: &str = "SysTabControl32";
}
