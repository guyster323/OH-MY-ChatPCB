#pragma once

#include <wx/panel.h>
#include <wx/process.h>
#include <wx/webview.h>

class CHATPCB_PANEL : public wxPanel
{
public:
    explicit CHATPCB_PANEL( wxWindow* parent );
    ~CHATPCB_PANEL() override;

    void LoadPanel();

private:
    void EnsureAgentRunning();
    wxString ResolvePanelUrl() const;

    wxWebView* m_webView;
    wxProcess* m_agentProcess;
};
