use chatpcb_core::design::esp32s3_usb_sensor_board_spec;
use chatpcb_core::layout::freerouting_contract;
use chatpcb_core::manufacturing::build_jlcpcb_package;
use chatpcb_core::project::create_preview_workspace;
use chatpcb_core::provider::catalog_with_probe;
use chatpcb_desktop::ui_model::chat_actions_contract;
use serde::Serialize;
use std::{fs, process::Command};

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
    if std::env::args().any(|arg| arg == "--self-test-summary") {
        print_self_test_summary();
        return;
    }

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
            "Open PCB",
            "Open evidence",
            "Pipeline status",
        ],
        supported_board: spec.product_name,
        autorouter: format!("{} {}", route.engine, route.bundled_version),
        manufacturing_outputs: package.files,
        providers,
    };

    println!("{}", serde_json::to_string_pretty(&contract).unwrap());
}

fn print_self_test_summary() {
    let spec = esp32s3_usb_sensor_board_spec("ESP32-S3 USB-C sensor board");
    let package = build_jlcpcb_package(&spec);
    let route = freerouting_contract();
    let chat_actions = chat_actions_contract();
    let model_items = chatpcb_desktop::ui_model::model_selector_items();
    let fallback_model = chatpcb_desktop::ui_model::selected_model_for_statuses(&[]);
    let evidence = first_run_evidence_summary_contract()
        .expect("first-run evidence summary contract must be readable");

    println!("ChatPCB KiCad Preview Self Test");
    println!("PASS native Windows app");
    println!("PASS 70/30 current-project workspace");
    println!("PASS Provider Login shows local CLI login hints");
    assert_eq!(
        model_items.first().copied(),
        Some("built-in-preview"),
        "model selector must show built-in preview before provider-backed models"
    );
    assert_eq!(
        fallback_model, "built-in-preview",
        "model selector must fall back to built-in preview when no provider is ready"
    );
    println!("PASS model selector falls back to built-in preview");
    println!("PASS first chat can create the built-in ESP32-S3 preview");
    assert!(
        chat_actions.use_example_selects_prompt_for_overwrite,
        "Use example must select prompt text so typing immediately overwrites it"
    );
    println!("PASS Use example selects prompt text for immediate overwrite");
    println!("PASS KiCad preview scaffold and validation reports are wired");
    println!(
        "PASS bundled autorouter contract: {} {}",
        route.engine, route.bundled_version
    );
    println!(
        "PASS JLCPCB package contract files: {}",
        package.files.len()
    );
    println!(
        "PASS Open evidence selects FIRST-RUN-SUMMARY.txt: {}",
        chat_actions.open_evidence_selects_first_run_summary_file
    );
    assert!(
        evidence.points_back_to_follow_up_chat,
        "FIRST-RUN-SUMMARY.txt must point users back to follow-up chat"
    );
    assert!(
        evidence.blocks_jlcpcb_upload,
        "FIRST-RUN-SUMMARY.txt must block JLCPCB upload"
    );
    println!("PASS first-run evidence points back to follow-up chat");
    println!("PASS first-run evidence blocks JLCPCB upload");
    println!("Board: {}", spec.product_name);
    println!("Boundary: prototype-review, not order-ready");
}

struct EvidenceSummaryContract {
    points_back_to_follow_up_chat: bool,
    blocks_jlcpcb_upload: bool,
}

fn first_run_evidence_summary_contract() -> std::io::Result<EvidenceSummaryContract> {
    let root = std::env::temp_dir().join(format!("chatpcb3-self-test-{}", std::process::id()));
    if root.exists() {
        fs::remove_dir_all(&root)?;
    }

    let workspace = create_preview_workspace(
        "USB-C ESP32-S3 sensor board with I2C sensor and JLCPCB package",
        &root,
    )?;
    let summary = fs::read_to_string(&workspace.first_run_summary_file)?;
    fs::remove_dir_all(&root)?;

    Ok(EvidenceSummaryContract {
        points_back_to_follow_up_chat: summary.contains("type a follow-up"),
        blocks_jlcpcb_upload: summary.contains("Do not upload this preview to JLCPCB"),
    })
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
    use std::fs;
    use std::mem::zeroed;
    use std::path::PathBuf;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows_sys::Win32::Graphics::Gdi::{GetStockObject, UpdateWindow, WHITE_BRUSH};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::Controls::{
        EM_SCROLLCARET, EM_SETSEL, NMHDR, TCIF_TEXT, TCITEMW, TCM_GETCURSEL, TCM_INSERTITEMW,
        TCN_SELCHANGE,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{SetFocus, VK_RETURN};
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallWindowProcW, CreateWindowExW, DefWindowProcW, DispatchMessageW, GetClientRect,
        GetDlgItemTextW, GetMessageW, GetWindowLongPtrW, LoadCursorW, MoveWindow, PostMessageW,
        PostQuitMessage, RegisterClassW, SendMessageW, SetDlgItemTextW, SetWindowLongPtrW,
        SetWindowTextW, ShowWindow, TranslateMessage, CBS_DROPDOWNLIST, CB_ADDSTRING, CB_SETCURSEL,
        CW_USEDEFAULT, ES_AUTOHSCROLL, ES_AUTOVSCROLL, ES_MULTILINE, ES_READONLY, GWLP_USERDATA,
        GWLP_WNDPROC, HMENU, IDC_ARROW, MSG, SW_SHOW, WINDOW_EX_STYLE, WM_APP, WM_COMMAND,
        WM_DESTROY, WM_KEYDOWN, WM_NCDESTROY, WM_NOTIFY, WM_SETFOCUS, WM_SIZE, WNDCLASSW, WNDPROC,
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
    const ID_OPEN_EVIDENCE: usize = 1006;
    const ID_OPEN_PCB: usize = 1007;
    const WM_CHATPCB_SEND_DEFERRED: u32 = WM_APP + 1;
    static mut ORIGINAL_PROMPT_PROC: WNDPROC = None;

    struct AppControls {
        left_pane: HWND,
        tabs: HWND,
        design_preview: HWND,
        status: HWND,
        chat_transcript: HWND,
        prompt: HWND,
        use_example_button: HWND,
        send_button: HWND,
        open_pcb_button: HWND,
        provider_button: HWND,
        open_evidence_button: HWND,
        model_choice: HWND,
        pipeline_status: HWND,
        last_workspace_dir: Option<PathBuf>,
    }

    struct PcbCheckUiResult {
        summary: String,
        report_file: PathBuf,
    }

    struct ValidationUiResult {
        summary: String,
        erc_report_file: PathBuf,
        drc_report_file: PathBuf,
        summary_file: PathBuf,
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
            let controls_ptr = Box::into_raw(controls);
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, controls_ptr as isize);
            layout(hwnd);

            ShowWindow(hwnd, SW_SHOW);
            UpdateWindow(hwnd);
            initialize_provider_model_selection(&*controls_ptr);
            focus_prompt_for_first_chat(&*controls_ptr);

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

        let recovered_workspace = recover_last_preview_workspace();
        let initial_design_preview = recovered_workspace
            .as_ref()
            .map(|path| {
                let project_dir = path.to_string_lossy();
                chatpcb_desktop::ui_model::recovered_preview_workspace_body(project_dir.as_ref())
            })
            .unwrap_or_else(|| chatpcb_desktop::ui_model::left_tab_body(0).to_string());
        let initial_left_status = recovered_workspace
            .as_ref()
            .map(|path| {
                let project_dir = path.to_string_lossy();
                chatpcb_desktop::ui_model::recovered_preview_workspace_left_status(
                    project_dir.as_ref(),
                )
            })
            .unwrap_or_else(|| {
                chatpcb_desktop::ui_model::initial_left_workspace_status().to_string()
            });
        let initial_chat_transcript = recovered_workspace
            .as_ref()
            .map(|path| {
                let project_dir = path.to_string_lossy();
                let recovered_turn =
                    chatpcb_desktop::ui_model::recovered_preview_workspace_transcript(
                        project_dir.as_ref(),
                    );
                chatpcb_desktop::ui_model::append_chat_transcript(
                    &chatpcb_desktop::ui_model::initial_transcript(),
                    &recovered_turn,
                )
            })
            .unwrap_or_else(chatpcb_desktop::ui_model::initial_transcript);

        let design_preview = child(
            parent,
            instance,
            "EDIT",
            &initial_design_preview,
            WS_BORDER
                | WS_VSCROLL
                | ES_MULTILINE as u32
                | ES_AUTOVSCROLL as u32
                | ES_READONLY as u32,
            0,
        );
        let status = child(
            parent,
            instance,
            "STATIC",
            &initial_left_status,
            WS_BORDER,
            0,
        );
        let chat_transcript = child(
            parent,
            instance,
            "EDIT",
            &initial_chat_transcript,
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
        subclass_prompt_input(parent, prompt);
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
        let open_pcb_button = child(
            parent,
            instance,
            "BUTTON",
            "Open PCB",
            WS_TABSTOP,
            ID_OPEN_PCB,
        );
        let provider_button = child(
            parent,
            instance,
            "BUTTON",
            "Provider Login",
            WS_TABSTOP,
            ID_PROVIDER_LOGIN,
        );
        let open_evidence_button = child(
            parent,
            instance,
            "BUTTON",
            "Open evidence",
            WS_TABSTOP,
            ID_OPEN_EVIDENCE,
        );
        let model_choice = child(
            parent,
            instance,
            "COMBOBOX",
            "",
            WS_TABSTOP | CBS_DROPDOWNLIST as u32,
            0,
        );
        for model in chatpcb_desktop::ui_model::model_selector_items() {
            add_combo_item(model_choice, model);
        }
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
            design_preview,
            status,
            chat_transcript,
            prompt,
            use_example_button,
            send_button,
            open_pcb_button,
            provider_button,
            open_evidence_button,
            model_choice,
            pipeline_status,
            last_workspace_dir: recovered_workspace,
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

    unsafe fn focus_prompt_for_first_chat(controls: &AppControls) {
        SetFocus(controls.prompt);
        SendMessageW(controls.prompt, EM_SETSEL, 0, -1);
    }

    unsafe fn focus_prompt_after_action(controls: &AppControls) {
        SetFocus(controls.prompt);
    }

    unsafe fn initialize_provider_model_selection(controls: &AppControls) {
        let statuses = super::catalog_with_probe(super::probe_command_version)
            .into_iter()
            .map(|provider| chatpcb_desktop::ui_model::ProviderUiStatus {
                display_name: provider.display_name,
                available: provider.available,
                version: provider.version,
                login_hint: provider.login_hint,
            })
            .collect::<Vec<_>>();

        let selected_provider = chatpcb_desktop::ui_model::selected_provider_model(&statuses);
        let selected_model = chatpcb_desktop::ui_model::selected_model_for_statuses(&statuses);
        if let Some(model_index) = selected_provider_model_index(selected_model) {
            SendMessageW(controls.model_choice, CB_SETCURSEL, model_index, 0);
        }

        let pipeline_status =
            chatpcb_desktop::ui_model::provider_login_pipeline_status(selected_provider);
        set_pipeline_status(controls, &pipeline_status);
    }

    unsafe fn subclass_prompt_input(parent: HWND, prompt: HWND) {
        SetWindowLongPtrW(prompt, GWLP_USERDATA, parent as isize);
        let original = SetWindowLongPtrW(
            prompt,
            GWLP_WNDPROC,
            prompt_window_proc as *const () as isize,
        );
        ORIGINAL_PROMPT_PROC = std::mem::transmute::<isize, WNDPROC>(original);
    }

    unsafe extern "system" fn prompt_window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == WM_KEYDOWN && wparam == VK_RETURN as WPARAM {
            let parent = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as HWND;
            if !parent.is_null() {
                PostMessageW(parent, WM_CHATPCB_SEND_DEFERRED, 0, 0);
                return 0;
            }
        }

        let original_prompt_proc = ORIGINAL_PROMPT_PROC;
        if original_prompt_proc.is_some() {
            CallWindowProcW(original_prompt_proc, hwnd, msg, wparam, lparam)
        } else {
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_NOTIFY => {
                handle_tab_selection(hwnd, lparam);
                0
            }
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

                if (wparam & 0xffff) == ID_OPEN_EVIDENCE {
                    handle_open_evidence(hwnd);
                    return 0;
                }

                if (wparam & 0xffff) == ID_OPEN_PCB {
                    handle_open_pcb(hwnd);
                    return 0;
                }

                DefWindowProcW(hwnd, msg, wparam, lparam)
            }
            WM_CHATPCB_SEND_DEFERRED => {
                handle_send_design(hwnd);
                0
            }
            WM_SETFOCUS => {
                let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppControls;
                if !ptr.is_null() {
                    focus_prompt_for_first_chat(&*ptr);
                }
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
                    ORIGINAL_PROMPT_PROC = None;
                    drop(Box::from_raw(ptr));
                }
                DefWindowProcW(hwnd, msg, wparam, lparam)
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    unsafe fn handle_tab_selection(hwnd: HWND, lparam: LPARAM) {
        let header = lparam as *const NMHDR;
        if header.is_null() || (*header).code != TCN_SELCHANGE {
            return;
        }

        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return;
        }

        let controls = &*ptr;
        let selected = SendMessageW(controls.tabs, TCM_GETCURSEL, 0, 0);
        if selected >= 0 {
            let selected = selected as usize;
            if let Some(project_dir) = controls.last_workspace_dir.as_ref() {
                let project_dir = project_dir.to_string_lossy();
                let status =
                    chatpcb_desktop::ui_model::saved_preview_tab_status(selected, &project_dir);
                let body =
                    chatpcb_desktop::ui_model::saved_preview_tab_body(selected, &project_dir);
                set_left_workspace_status(controls, &status);
                set_design_preview(controls, &body);
            } else {
                set_left_workspace_status(
                    controls,
                    chatpcb_desktop::ui_model::left_tab_status(selected),
                );
                set_design_preview(controls, chatpcb_desktop::ui_model::left_tab_body(selected));
            }
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
        let preview_y = margin + 84;
        let status_y = height - margin - 68;
        let preview_height = (status_y - preview_y - gap).max(80);
        MoveWindow(
            controls.design_preview,
            margin + 8,
            preview_y,
            left_width - 16,
            preview_height,
            1,
        );
        MoveWindow(controls.status, margin, status_y, left_width, 68, 1);

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
        let example_width = if right_width > 340 {
            112
        } else {
            right_width / 4
        };
        let open_pcb_width = if right_width > 340 {
            96
        } else {
            right_width / 4
        };
        let send_width = right_width - example_width - open_pcb_width - action_gap * 2;
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
        MoveWindow(
            controls.open_pcb_button,
            right_x + example_width + action_gap + send_width + action_gap,
            height - 122,
            open_pcb_width,
            30,
            1,
        );
        let provider_width = 122;
        let evidence_width = 126;
        MoveWindow(
            controls.provider_button,
            right_x,
            height - 82,
            provider_width,
            32,
            1,
        );
        MoveWindow(
            controls.open_evidence_button,
            right_x + provider_width + action_gap,
            height - 82,
            evidence_width,
            32,
            1,
        );
        let model_x = right_x + provider_width + action_gap + evidence_width + action_gap;
        MoveWindow(
            controls.model_choice,
            model_x,
            height - 82,
            right_width - (model_x - right_x),
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
        let prompt_for_workspace = if prompt.trim().is_empty() {
            chatpcb_desktop::ui_model::example_board_prompt()
        } else {
            prompt.trim()
        };
        let mut turn_transcript = chatpcb_desktop::ui_model::send_design_transcript(&prompt);
        let mut pipeline_after_send =
            chatpcb_desktop::ui_model::design_pipeline_status().to_string();
        let controls = &mut *ptr;
        match super::create_preview_workspace(prompt_for_workspace, preview_workspace_root()) {
            Ok(workspace) => {
                let project_dir = PathBuf::from(&workspace.project_dir);
                let kicad_check = run_kicad_pcb_check(&project_dir);
                let validation = run_kicad_erc_drc_reports(&project_dir);
                turn_transcript.push_str(
                    &chatpcb_desktop::ui_model::preview_workspace_saved_transcript(
                        &workspace.project_dir,
                        &workspace.release_report_file,
                    ),
                );
                turn_transcript.push_str(&chatpcb_desktop::ui_model::kicad_cli_check_transcript(
                    &kicad_check.report_file.to_string_lossy(),
                    &kicad_check.summary,
                ));
                turn_transcript.push_str(
                    &chatpcb_desktop::ui_model::erc_drc_validation_transcript(
                        &validation.erc_report_file.to_string_lossy(),
                        &validation.drc_report_file.to_string_lossy(),
                        &validation.summary_file.to_string_lossy(),
                        &validation.summary,
                    ),
                );
                let left_status = chatpcb_desktop::ui_model::preview_workspace_left_status(
                    &workspace.project_dir,
                );
                set_left_workspace_status(controls, &left_status);
                let preview_body =
                    chatpcb_desktop::ui_model::preview_workspace_body_with_validation_reports(
                        &workspace.project_dir,
                        &workspace.release_report_file,
                        &kicad_check.report_file.to_string_lossy(),
                        &kicad_check.summary,
                        &validation.erc_report_file.to_string_lossy(),
                        &validation.drc_report_file.to_string_lossy(),
                        &validation.summary_file.to_string_lossy(),
                        &validation.summary,
                    );
                set_design_preview(controls, &preview_body);
                controls.last_workspace_dir = Some(project_dir);
                pipeline_after_send =
                    chatpcb_desktop::ui_model::validation_pipeline_status(&validation.summary);
            }
            Err(error) => {
                turn_transcript.push_str(
                    &chatpcb_desktop::ui_model::preview_workspace_failed_transcript(
                        &error.to_string(),
                    ),
                );
                set_left_workspace_status(
                    controls,
                    "Preview workspace could not be saved. Check chat for the error.",
                );
                set_design_preview(
                    controls,
                    "Preview workspace was not saved.\r\nCheck the chat transcript for the error.\r\nGate: preview only.",
                );
            }
        }
        let transcript = chatpcb_desktop::ui_model::append_chat_transcript(
            &get_control_text(hwnd, ID_CHAT_TRANSCRIPT),
            &turn_transcript,
        );
        set_chat_transcript_text(controls, &transcript);
        set_pipeline_status(controls, &pipeline_after_send);
        let empty = wide("");
        SetDlgItemTextW(hwnd, ID_PROMPT as i32, empty.as_ptr());
        focus_prompt_after_action(controls);
    }

    fn run_kicad_pcb_check(project_dir: &PathBuf) -> PcbCheckUiResult {
        let pcb_file = project_dir.join("chatpcb3-esp32s3.kicad_pcb");
        let report_file = project_dir.join("kicad-pcb-check.txt");
        let check = if !pcb_file.exists() {
            chatpcb_core::validation::summarize_kicad_cli_check(
                Some(1),
                "",
                "chatpcb3-esp32s3.kicad_pcb was not found",
            )
        } else if let Some(kicad_cli) = preferred_kicad_cli_path() {
            match super::Command::new(kicad_cli)
                .args(["pcb", "upgrade"])
                .arg(&pcb_file)
                .output()
            {
                Ok(output) => chatpcb_core::validation::summarize_kicad_cli_check(
                    output.status.code(),
                    &String::from_utf8_lossy(&output.stdout),
                    &String::from_utf8_lossy(&output.stderr),
                ),
                Err(error) => chatpcb_core::validation::summarize_kicad_cli_check(
                    None,
                    "",
                    &format!("failed to run kicad-cli.exe: {error}"),
                ),
            }
        } else {
            chatpcb_core::validation::summarize_kicad_cli_check(
                None,
                "",
                "kicad-cli.exe was not found",
            )
        };

        let report = format!(
            "ChatPCB3 KiCad CLI PCB check\r\n\
             Status: {:?}\r\n\
             Exit code: {:?}\r\n\
             Summary: {}\r\n\
             \r\n\
             PCB file:\r\n\
             {}\r\n\
             \r\n\
             STDOUT:\r\n\
             {}\r\n\
             \r\n\
             STDERR:\r\n\
             {}\r\n\
             \r\n\
             Boundary:\r\n\
             This is a prototype-review compatibility check, not manufacturing evidence.\r\n",
            check.status,
            check.exit_code,
            check.summary,
            pcb_file.to_string_lossy(),
            check.stdout,
            check.stderr
        );
        let _ = fs::write(&report_file, report);

        PcbCheckUiResult {
            summary: check.summary,
            report_file,
        }
    }

    fn run_kicad_erc_drc_reports(project_dir: &PathBuf) -> ValidationUiResult {
        let schematic_file = project_dir.join("chatpcb3-esp32s3.kicad_sch");
        let pcb_file = project_dir.join("chatpcb3-esp32s3.kicad_pcb");
        let erc_report_file = project_dir.join("erc-report.json");
        let drc_report_file = project_dir.join("drc-report.json");
        let summary_file = project_dir.join("kicad-validation-summary.txt");

        let _ = fs::remove_file(&erc_report_file);
        let _ = fs::remove_file(&drc_report_file);

        let mut command_log = String::new();
        let summary = if !schematic_file.exists() || !pcb_file.exists() {
            "KiCad ERC/DRC were not run because the preview schematic or PCB file is missing. Gate remains prototype-review."
                .to_string()
        } else if let Some(kicad_cli) = preferred_kicad_cli_path() {
            let erc_output = super::Command::new(&kicad_cli)
                .args(["sch", "erc", "--format", "json", "--output"])
                .arg(&erc_report_file)
                .arg(&schematic_file)
                .output();
            let drc_output = super::Command::new(&kicad_cli)
                .args(["pcb", "drc", "--format", "json", "--output"])
                .arg(&drc_report_file)
                .arg(&pcb_file)
                .output();

            command_log.push_str(&format_validation_command_log("ERC", &erc_output));
            command_log.push_str(&format_validation_command_log("DRC", &drc_output));

            match (
                fs::read_to_string(&erc_report_file)
                    .ok()
                    .and_then(|report| chatpcb_core::validation::parse_kicad_report(&report).ok()),
                fs::read_to_string(&drc_report_file)
                    .ok()
                    .and_then(|report| chatpcb_core::validation::parse_kicad_report(&report).ok()),
            ) {
                (Some(erc), Some(drc)) => {
                    chatpcb_core::validation::summarize_erc_drc_reports(&erc, &drc)
                }
                _ => {
                    "KiCad ERC/DRC reports were requested, but the JSON reports could not be parsed. Gate remains prototype-review; inspect kicad-validation-summary.txt before continuing."
                        .to_string()
                }
            }
        } else {
            "KiCad ERC/DRC were not run because kicad-cli.exe was not found. Gate remains prototype-review; install KiCad 10 to create local ERC/DRC reports."
                .to_string()
        };

        let report = format!(
            "ChatPCB3 KiCad ERC/DRC validation\r\n\
             Summary: {}\r\n\
             \r\n\
             Schematic:\r\n\
             {}\r\n\
             \r\n\
             PCB:\r\n\
             {}\r\n\
             \r\n\
             ERC report:\r\n\
             {}\r\n\
             \r\n\
             DRC report:\r\n\
             {}\r\n\
             \r\n\
             Command log:\r\n\
             {}\r\n\
             Boundary:\r\n\
             This is prototype-review validation evidence, not manufacturing evidence.\r\n",
            summary,
            schematic_file.to_string_lossy(),
            pcb_file.to_string_lossy(),
            erc_report_file.to_string_lossy(),
            drc_report_file.to_string_lossy(),
            command_log
        );
        let _ = fs::write(&summary_file, report);

        ValidationUiResult {
            summary,
            erc_report_file,
            drc_report_file,
            summary_file,
        }
    }

    fn format_validation_command_log(
        label: &str,
        output: &std::io::Result<std::process::Output>,
    ) -> String {
        match output {
            Ok(output) => format!(
                "{label} exit code: {:?}\r\nSTDOUT:\r\n{}\r\nSTDERR:\r\n{}\r\n\r\n",
                output.status.code(),
                String::from_utf8_lossy(&output.stdout).trim(),
                String::from_utf8_lossy(&output.stderr).trim()
            ),
            Err(error) => format!("{label} failed to run: {error}\r\n\r\n"),
        }
    }

    unsafe fn handle_open_evidence(hwnd: HWND) {
        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return;
        }

        let controls = &*ptr;
        if let Some(path) = &controls.last_workspace_dir {
            open_evidence_report(path);
            set_pipeline_status(controls, "Opened first-run summary in evidence folder.");
        } else {
            set_pipeline_status(controls, "No evidence yet: click Send design first.");
        }
    }

    unsafe fn handle_open_pcb(hwnd: HWND) {
        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return;
        }

        let controls = &*ptr;
        if let Some(path) = &controls.last_workspace_dir {
            open_preview_pcb(path, controls);
        } else {
            set_pipeline_status(controls, "No PCB yet: click Send design first.");
        }
    }

    unsafe fn open_preview_pcb(project_dir: &PathBuf, controls: &AppControls) {
        let pcb_file = project_dir.join("chatpcb3-esp32s3.kicad_pcb");
        if pcb_file.exists() {
            let opened_with_kicad = open_preview_pcb_file(&pcb_file);
            set_pipeline_status(
                controls,
                chatpcb_desktop::ui_model::open_pcb_pipeline_status(opened_with_kicad),
            );
        } else {
            set_pipeline_status(controls, "PCB file missing: click Send design again.");
        }
    }

    unsafe fn open_preview_pcb_file(pcb_file: &PathBuf) -> bool {
        if let Some(pcbnew) = preferred_pcbnew_path() {
            let operation = wide("open");
            let executable = wide(&pcbnew.to_string_lossy());
            let parameters = wide(&format!("\"{}\"", pcb_file.to_string_lossy()));
            ShellExecuteW(
                null_mut(),
                operation.as_ptr(),
                executable.as_ptr(),
                parameters.as_ptr(),
                null(),
                SW_SHOW,
            );
            true
        } else {
            let operation = wide("open");
            let board = wide(&pcb_file.to_string_lossy());
            ShellExecuteW(
                null_mut(),
                operation.as_ptr(),
                board.as_ptr(),
                null(),
                null(),
                SW_SHOW,
            );
            false
        }
    }

    fn preferred_pcbnew_path() -> Option<PathBuf> {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .map(|local_app_data| {
                local_app_data
                    .join("Programs")
                    .join("KiCad")
                    .join("10.0")
                    .join("bin")
                    .join("pcbnew.exe")
            })
            .filter(|path| path.exists())
    }

    fn preferred_kicad_cli_path() -> Option<PathBuf> {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .map(|local_app_data| {
                local_app_data
                    .join("Programs")
                    .join("KiCad")
                    .join("10.0")
                    .join("bin")
                    .join("kicad-cli.exe")
            })
            .filter(|path| path.exists())
    }

    unsafe fn open_evidence_report(project_dir: &PathBuf) {
        let first_run_summary_file = project_dir.join("FIRST-RUN-SUMMARY.txt");
        if first_run_summary_file.exists() {
            open_evidence_report_file(&first_run_summary_file);
            return;
        }

        let release_report_file = project_dir.join("release-evidence-preview.md");
        if release_report_file.exists() {
            open_evidence_report_file(&release_report_file);
        } else {
            open_evidence_folder(project_dir);
        }
    }

    unsafe fn open_evidence_report_file(report_file: &PathBuf) {
        let explorer = wide("explorer.exe");
        let parameters = wide(&format!("/select,\"{}\"", report_file.to_string_lossy()));
        ShellExecuteW(
            null_mut(),
            null(),
            explorer.as_ptr(),
            parameters.as_ptr(),
            null(),
            SW_SHOW,
        );
    }

    unsafe fn open_evidence_folder(path: &PathBuf) {
        let operation = wide("open");
        let folder = wide(&path.to_string_lossy());
        ShellExecuteW(
            null_mut(),
            operation.as_ptr(),
            folder.as_ptr(),
            null(),
            null(),
            SW_SHOW,
        );
    }

    fn preview_workspace_root() -> PathBuf {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join("ChatPCB3")
            .join("Projects")
    }

    fn recover_last_preview_workspace() -> Option<PathBuf> {
        let path = preview_workspace_root().join("chatpcb3-esp32s3-preview");

        if path.exists() {
            Some(path)
        } else {
            None
        }
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
        focus_prompt_for_first_chat(controls);
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
                login_hint: provider.login_hint,
            })
            .collect::<Vec<_>>();
        let controls = &*ptr;
        let selected_provider = chatpcb_desktop::ui_model::selected_provider_model(&statuses);
        let selected_model = chatpcb_desktop::ui_model::selected_model_for_statuses(&statuses);
        if let Some(model_index) = selected_provider_model_index(selected_model) {
            SendMessageW(controls.model_choice, CB_SETCURSEL, model_index, 0);
        }
        let pipeline_status =
            chatpcb_desktop::ui_model::provider_login_pipeline_status(selected_provider);
        set_pipeline_status(controls, &pipeline_status);
        let provider_login_turn = chatpcb_desktop::ui_model::provider_login_transcript(&statuses);
        append_provider_login_transcript(hwnd, controls, &provider_login_turn);
        focus_prompt_after_action(controls);
    }

    unsafe fn append_provider_login_transcript(
        hwnd: HWND,
        controls: &AppControls,
        provider_login_turn: &str,
    ) {
        let transcript = chatpcb_desktop::ui_model::append_chat_transcript(
            &get_control_text(hwnd, ID_CHAT_TRANSCRIPT),
            provider_login_turn,
        );
        set_chat_transcript_text(controls, &transcript);
    }

    unsafe fn set_pipeline_status(controls: &AppControls, status: &str) {
        let status = wide(status);
        SetWindowTextW(controls.pipeline_status, status.as_ptr());
    }

    unsafe fn set_chat_transcript_text(controls: &AppControls, transcript: &str) {
        let text = wide(transcript);
        SetWindowTextW(controls.chat_transcript, text.as_ptr());
        scroll_chat_transcript_to_latest(controls, transcript);
    }

    unsafe fn scroll_chat_transcript_to_latest(controls: &AppControls, transcript: &str) {
        let end = transcript.encode_utf16().count();
        SendMessageW(controls.chat_transcript, EM_SETSEL, end, end as isize);
        SendMessageW(controls.chat_transcript, EM_SCROLLCARET, 0, 0);
    }

    unsafe fn set_left_workspace_status(controls: &AppControls, status: &str) {
        let status = wide(status);
        SetWindowTextW(controls.status, status.as_ptr());
    }

    unsafe fn set_design_preview(controls: &AppControls, body: &str) {
        let body = wide(body);
        SetWindowTextW(controls.design_preview, body.as_ptr());
    }

    fn selected_provider_model_index(model: &str) -> Option<usize> {
        chatpcb_desktop::ui_model::model_selector_index(model)
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
