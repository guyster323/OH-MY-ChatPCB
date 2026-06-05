#include "chatpcb_panel.h"

#include <wx/filename.h>
#include <wx/log.h>
#include <wx/sizer.h>
#include <wx/stdpaths.h>

namespace
{
constexpr int CHATPCB_AGENT_PORT = 41317;
}

CHATPCB_PANEL::CHATPCB_PANEL( wxWindow* parent ) :
        wxPanel( parent ),
        m_webView( nullptr ),
        m_agentProcess( nullptr )
{
    auto* sizer = new wxBoxSizer( wxVERTICAL );
    m_webView = wxWebView::New( this, wxID_ANY );
    sizer->Add( m_webView, 1, wxEXPAND );
    SetSizer( sizer );
    LoadPanel();
}

CHATPCB_PANEL::~CHATPCB_PANEL()
{
    if( m_agentProcess )
    {
        m_agentProcess->Detach();
        m_agentProcess = nullptr;
    }
}

void CHATPCB_PANEL::LoadPanel()
{
    EnsureAgentRunning();
    m_webView->LoadURL( ResolvePanelUrl() );
}

void CHATPCB_PANEL::EnsureAgentRunning()
{
    if( m_agentProcess )
        return;

    wxString command;
    command.Printf( "chatpcb daemon --host 127.0.0.1 --port %d", CHATPCB_AGENT_PORT );

    m_agentProcess = new wxProcess( this );
    long pid = wxExecute( command, wxEXEC_ASYNC, m_agentProcess );

    if( pid == 0 )
    {
        wxLogWarning( "ChatPCB agent daemon did not start. Run `chatpcb daemon` manually." );
        delete m_agentProcess;
        m_agentProcess = nullptr;
    }
}

wxString CHATPCB_PANEL::ResolvePanelUrl() const
{
#ifdef CHATPCB_PANEL_ASSET_URL
    return wxString::FromUTF8( CHATPCB_PANEL_ASSET_URL );
#else
    wxFileName panelPath( wxStandardPaths::Get().GetExecutablePath() );
    panelPath.RemoveLastDir();
    panelPath.AppendDir( "share" );
    panelPath.AppendDir( "chatpcb" );
    panelPath.SetFullName( "index.html" );
    return panelPath.GetFullPath();
#endif
}
