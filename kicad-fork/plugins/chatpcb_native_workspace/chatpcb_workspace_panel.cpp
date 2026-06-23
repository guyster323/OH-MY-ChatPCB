#include "chatpcb_workspace_panel.h"

#include <wx/event.h>
#include <wx/sizer.h>
#include <wx/stattext.h>

namespace
{
wxPanel* MakePlaceholderPage( wxWindow* parent, const wxString& label )
{
    auto* page = new wxPanel( parent, wxID_ANY );
    auto* sizer = new wxBoxSizer( wxVERTICAL );
    sizer->Add( new wxStaticText( page, wxID_ANY, label ), 0, wxALL, 12 );
    page->SetSizer( sizer );
    return page;
}
}

CHATPCB_WORKSPACE_PANEL::CHATPCB_WORKSPACE_PANEL( wxWindow* parent ) :
        wxPanel( parent, wxID_ANY ),
        m_splitter( new wxSplitterWindow( this, wxID_ANY ) ),
        m_designTabs( nullptr ),
        m_chatTranscript( nullptr ),
        m_promptInput( nullptr ),
        m_sendDesignButton( nullptr ),
        m_providerLoginButton( nullptr ),
        m_modelChoice( nullptr )
{
    auto* rootSizer = new wxBoxSizer( wxVERTICAL );
    rootSizer->Add( m_splitter, 1, wxEXPAND );
    SetSizer( rootSizer );

    wxPanel* designPane = BuildDesignPane();
    wxPanel* chatPane = BuildChatPane();

    m_splitter->SplitVertically( designPane, chatPane );
    m_splitter->SetSashGravity( CHATPCB_WORKSPACE_LEFT_RATIO );
    m_splitter->SetMinimumPaneSize( 320 );

    m_providerLoginButton->Bind( wxEVT_BUTTON,
            [this]( wxCommandEvent& )
            {
                SendCoreRequest( "provider.list", "{}" );
            } );

    m_sendDesignButton->Bind( wxEVT_BUTTON,
            [this]( wxCommandEvent& )
            {
                wxString prompt = m_promptInput->GetValue();
                prompt.Replace( "\\", "\\\\" );
                prompt.Replace( "\"", "\\\"" );
                SendCoreRequest( "project.create",
                        wxString::Format( "{\"prompt\":\"%s\"}", prompt ) );
            } );
}

void CHATPCB_WORKSPACE_PANEL::SetCoreExecutablePath( const wxString& executablePath )
{
    m_coreClient.SetExecutablePath( executablePath );
}

wxPanel* CHATPCB_WORKSPACE_PANEL::BuildDesignPane()
{
    auto* panel = new wxPanel( m_splitter, wxID_ANY );
    auto* sizer = new wxBoxSizer( wxVERTICAL );

    m_designTabs = new wxNotebook( panel, wxID_ANY );
    m_designTabs->AddPage( MakePlaceholderPage( m_designTabs, "Schematic canvas will host KiCad schematic editor integration." ),
                           "Schematic" );
    m_designTabs->AddPage( MakePlaceholderPage( m_designTabs, "PCB Layout canvas will host KiCad board editor integration." ),
                           "PCB Layout" );
    m_designTabs->AddPage( MakePlaceholderPage( m_designTabs, "Validation shows ERC, DRC, autorouter, and visual-review evidence." ),
                           "Validation" );
    m_designTabs->AddPage( MakePlaceholderPage( m_designTabs, "Manufacturing Preview shows Gerber, drill, BOM, CPL, and release evidence." ),
                           "Manufacturing Preview" );

    sizer->Add( m_designTabs, 1, wxEXPAND );
    panel->SetSizer( sizer );
    return panel;
}

wxPanel* CHATPCB_WORKSPACE_PANEL::BuildChatPane()
{
    auto* panel = new wxPanel( m_splitter, wxID_ANY );
    auto* sizer = new wxBoxSizer( wxVERTICAL );

    m_chatTranscript = new wxTextCtrl( panel, wxID_ANY, wxEmptyString, wxDefaultPosition,
                                       wxDefaultSize, wxTE_MULTILINE | wxTE_READONLY | wxBORDER_NONE );
    m_promptInput = new wxTextCtrl( panel, wxID_ANY, wxEmptyString, wxDefaultPosition,
                                    wxDefaultSize, wxTE_MULTILINE );
    m_sendDesignButton = new wxButton( panel, wxID_ANY, "Send design" );

    sizer->Add( m_chatTranscript, 1, wxEXPAND | wxALL, 8 );
    sizer->Add( new wxStaticText( panel, wxID_ANY, "Chat prompt" ), 0,
                wxEXPAND | wxLEFT | wxRIGHT, 8 );
    sizer->Add( m_promptInput, 0, wxEXPAND | wxLEFT | wxRIGHT | wxBOTTOM, 8 );
    sizer->Add( m_sendDesignButton, 0, wxEXPAND | wxLEFT | wxRIGHT | wxBOTTOM, 8 );
    sizer->Add( BuildProviderBar( panel ), 0, wxEXPAND | wxLEFT | wxRIGHT | wxBOTTOM, 8 );

    panel->SetSizer( sizer );
    return panel;
}

void CHATPCB_WORKSPACE_PANEL::SendCoreRequest( const wxString& method, const wxString& paramsJson )
{
    wxString responseJson;
    wxString errorMessage;

    m_chatTranscript->AppendText( "ChatPCB core request: " + method + "\n" );

    if( m_coreClient.Request( method, paramsJson, &responseJson, &errorMessage ) )
        m_chatTranscript->AppendText( responseJson + "\n" );
    else
        m_chatTranscript->AppendText( "ChatPCB core error: " + errorMessage + "\n" );
}

wxPanel* CHATPCB_WORKSPACE_PANEL::BuildProviderBar( wxWindow* parent )
{
    auto* panel = new wxPanel( parent, wxID_ANY );
    auto* sizer = new wxBoxSizer( wxHORIZONTAL );

    m_providerLoginButton = new wxButton( panel, wxID_ANY, "Provider Login" );
    m_modelChoice = new wxChoice( panel, wxID_ANY );
    m_modelChoice->Append( "codex:auto" );
    m_modelChoice->Append( "claude:auto" );
    m_modelChoice->Append( "gemini:auto" );
    m_modelChoice->SetSelection( 0 );

    sizer->Add( m_providerLoginButton, 0, wxRIGHT, 8 );
    sizer->Add( new wxStaticText( panel, wxID_ANY, "Model" ), 0, wxALIGN_CENTER_VERTICAL | wxRIGHT, 6 );
    sizer->Add( m_modelChoice, 1, wxEXPAND );

    panel->SetSizer( sizer );
    return panel;
}
