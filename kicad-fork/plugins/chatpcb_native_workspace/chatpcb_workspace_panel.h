#pragma once

#include "chatpcb_core_client.h"

#include <wx/button.h>
#include <wx/choice.h>
#include <wx/notebook.h>
#include <wx/panel.h>
#include <wx/splitter.h>
#include <wx/textctrl.h>

constexpr double CHATPCB_WORKSPACE_LEFT_RATIO = 0.7;

class CHATPCB_WORKSPACE_PANEL : public wxPanel
{
public:
    explicit CHATPCB_WORKSPACE_PANEL( wxWindow* parent );

    void SetCoreExecutablePath( const wxString& executablePath );

private:
    wxPanel* BuildDesignPane();
    wxPanel* BuildChatPane();
    wxPanel* BuildProviderBar( wxWindow* parent );
    void SendCoreRequest( const wxString& method, const wxString& paramsJson );

    CHATPCB_CORE_CLIENT m_coreClient;
    wxSplitterWindow* m_splitter;
    wxNotebook*       m_designTabs;
    wxTextCtrl*       m_chatTranscript;
    wxTextCtrl*       m_promptInput;
    wxButton*         m_sendDesignButton;
    wxButton*         m_providerLoginButton;
    wxChoice*         m_modelChoice;
};
