use chatpcb_core::design::esp32s3_usb_sensor_board_spec;
use chatpcb_core::layout::freerouting_contract;
use chatpcb_core::manufacturing::build_jlcpcb_package;
use chatpcb_core::provider::catalog_with_probe;
use chatpcb_desktop::ui_model::chat_actions_contract;
use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize)]
struct DesktopSelfTest {
    app_name: &'static str,
    ui_runtime: &'static str,
    transport: &'static str,
    layout: LayoutContract,
    chat_transcript: ChatTranscriptContract,
    chat_actions: chatpcb_desktop::ui_model::ChatActionsContract,
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
        chat_actions: chat_actions_contract(),
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
            "Use example",
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
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetClientRect, GetDlgItemTextW,
        GetMessageW, GetWindowLongPtrW, LoadCursorW, MoveWindow, PostMessageW, PostQuitMessage,
        RegisterClassW, SendMessageW, SetDlgItemTextW, SetWindowLongPtrW, SetWindowTextW,
        ShowWindow, TranslateMessage, CB_ADDSTRING, CB_SETCURSEL, CW_USEDEFAULT, ES_AUTOHSCROLL,
        ES_AUTOVSCROLL, ES_MULTILINE, ES_READONLY, GWLP_USERDATA, HMENU, IDC_ARROW, MSG, SW_SHOW,
        WINDOW_EX_STYLE, WM_APP, WM_COMMAND, WM_DESTROY, WM_NCDESTROY, WM_SIZE, WNDCLASSW,
        WS_BORDER, WS_CHILD, WS_CLIPSIBLINGS, WS_OVERLAPPEDWINDOW, WS_TABSTOP, WS_VISIBLE,
        WS_VSCROLL,
    };

    const APP_TITLE: &str = "ChatPCB KiCad Preview";
    const CLASS_NAME: &str = "ChatPcbKiCadPreviewWindow";
    const ID_SEND_DESIGN: usize = 1001;
    const ID_PROVIDER_LOGIN: usize = 1002;
    const ID_CHAT_TRANSCRIPT: usize = 1003;
    const ID_PROMPT: usize = 1004;
    const ID_USE_EXAMPLE: usize = 1005;
    const WM_CHATPCB_SEND_DEFERRED: u32 = WM_APP + 1;

    struct AppControls {
        left_pane: HWND,
        tabs: HWND,
        status: HWND,
        chat_transcript: HWND,
        prompt: HWND,
        use_example_button: HWND,
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
                WS_OVERLAPPEDWINDOW,
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
            &chatpcb_desktop::ui_model::initial_transcript(),
            WS_BORDER
                | WS_VSCROLL
                | ES_MULTILINE as u32
                | ES_AUTOVSCROLL as u32
                | ES_READONLY as u32,
            ID_CHAT_TRANSCRIPT,
        );
        let prompt = child(
            parent,
            instance,
            "EDIT",
            "USB-C ESP32-S3 sensor board with I2C sensor and JLCPCB package",
            WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL as u32,
            ID_PROMPT,
        );
        let use_example_button = child(
            parent,
            instance,
            "BUTTON",
            "Use example",
            WS_TABSTOP,
            ID_USE_EXAMPLE,
        );
        let send_button = child(
            parent,
            instance,
            "BUTTON",
            "Send design",
            WS_TABSTOP,
            ID_SEND_DESIGN,
        );
        let provider_button = child(
            parent,
            instance,
            "BUTTON",
            "Provider Login",
            WS_TABSTOP,
            ID_PROVIDER_LOGIN,
        );
        let model_choice = child(parent, instance, "COMBOBOX", "", WS_TABSTOP, 0);
        add_combo_item(model_choice, "codex:auto");
        add_combo_item(model_choice, "claude:auto");
        add_combo_item(model_choice, "gemini:auto");
        SendMessageW(model_choice, CB_SETCURSEL, 0, 0);
        let pipeline_status = child(
            parent,
            instance,
            "STATIC",
            chatpcb_desktop::ui_model::initial_pipeline_status(),
            WS_BORDER,
            0,
        );

        AppControls {
            left_pane,
            tabs,
            status,
            chat_transcript,
            prompt,
            use_example_button,
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
                    PostMessageW(hwnd, WM_CHATPCB_SEND_DEFERRED, 0, 0);
                    return 0;
                }

                if (wparam & 0xffff) == ID_PROVIDER_LOGIN {
                    handle_provider_login(hwnd);
                    return 0;
                }

                if (wparam & 0xffff) == ID_USE_EXAMPLE {
                    handle_use_example(hwnd);
                    return 0;
                }

                DefWindowProcW(hwnd, msg, wparam, lparam)
            }
            WM_CHATPCB_SEND_DEFERRED => {
                handle_send_design(hwnd);
                0
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
        let action_gap = 8;
        let example_width = if right_width > 300 {
            124
        } else {
            right_width / 3
        };
        let send_width = right_width - example_width - action_gap;
        MoveWindow(
            controls.use_example_button,
            right_x,
            height - 122,
            example_width,
            30,
            1,
        );
        MoveWindow(
            controls.send_button,
            right_x + example_width + action_gap,
            height - 122,
            send_width,
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

        let prompt = get_control_text(hwnd, ID_PROMPT);
        let transcript = wide(&chatpcb_desktop::ui_model::send_design_transcript(&prompt));
        SetDlgItemTextW(hwnd, ID_CHAT_TRANSCRIPT as i32, transcript.as_ptr());
        let controls = &*ptr;
        set_pipeline_status(
            controls,
            chatpcb_desktop::ui_model::design_pipeline_status(),
        );
        let empty = wide("");
        SetDlgItemTextW(hwnd, ID_PROMPT as i32, empty.as_ptr());
    }

    unsafe fn handle_use_example(hwnd: HWND) {
        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return;
        }

        let prompt = wide(chatpcb_desktop::ui_model::example_board_prompt());
        SetDlgItemTextW(hwnd, ID_PROMPT as i32, prompt.as_ptr());
        let controls = &*ptr;
        set_pipeline_status(
            controls,
            chatpcb_desktop::ui_model::example_loaded_pipeline_status(),
        );
    }

    unsafe fn handle_provider_login(hwnd: HWND) {
        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return;
        }

        let statuses = super::catalog_with_probe(super::probe_command_version)
            .into_iter()
            .map(|provider| chatpcb_desktop::ui_model::ProviderUiStatus {
                display_name: provider.display_name,
                available: provider.available,
                version: provider.version,
            })
            .collect::<Vec<_>>();
        let controls = &*ptr;
        if let Some(model_index) = chatpcb_desktop::ui_model::selected_provider_model(&statuses)
            .and_then(selected_provider_model_index)
        {
            SendMessageW(controls.model_choice, CB_SETCURSEL, model_index, 0);
        }
        let selected_model = chatpcb_desktop::ui_model::selected_provider_model(&statuses);
        let pipeline_status =
            chatpcb_desktop::ui_model::provider_login_pipeline_status(selected_model);
        set_pipeline_status(controls, &pipeline_status);
        let transcript = wide(&chatpcb_desktop::ui_model::provider_login_transcript(
            &statuses,
        ));
        SetDlgItemTextW(hwnd, ID_CHAT_TRANSCRIPT as i32, transcript.as_ptr());
    }

    unsafe fn set_pipeline_status(controls: &AppControls, status: &str) {
        let status = wide(status);
        SetWindowTextW(controls.pipeline_status, status.as_ptr());
    }

    fn selected_provider_model_index(model: &str) -> Option<usize> {
        match model {
            "codex:auto" => Some(0),
            "claude:auto" => Some(1),
            "gemini:auto" => Some(2),
            _ => None,
        }
    }

    unsafe fn get_control_text(parent: HWND, control_id: usize) -> String {
        let mut buffer = vec![0u16; 2048];
        let copied = GetDlgItemTextW(
            parent,
            control_id as i32,
            buffer.as_mut_ptr(),
            buffer.len() as i32,
        );
        String::from_utf16_lossy(&buffer[..copied as usize])
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    const WC_TABCONTROLW_STR: &str = "SysTabControl32";
}
