#pragma once

#include <wx/panel.h>
#include <wx/process.h>
#include <wx/webview.h>

#include <nlohmann/json_fwd.hpp>

class SCH_EDIT_FRAME;

class CHATPCB_PANEL : public wxPanel
{
public:
    explicit CHATPCB_PANEL( wxWindow* parent );
    ~CHATPCB_PANEL() override;

    void LoadPanel();

private:
    void EnsureAgentRunning();
    void OnScriptMessage( wxWebViewEvent& aEvent );
    void PostHostEvent( const nlohmann::json& aEvent );
    void OpenProject( const wxString& aProjectPath );
    bool IsEditorDirty() const;
    void ReloadActiveProject( const wxString& aProjectPath );
    wxString ResolvePanelUrl() const;

    SCH_EDIT_FRAME* m_frame;
    wxWebView*      m_webView;
    wxProcess*      m_agentProcess;
};
