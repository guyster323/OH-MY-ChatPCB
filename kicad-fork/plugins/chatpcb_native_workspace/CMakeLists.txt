cmake_minimum_required( VERSION 3.16 )

if( NOT wxWidgets_FOUND )
    find_package( wxWidgets REQUIRED COMPONENTS core base )
    include( ${wxWidgets_USE_FILE} )
endif()

add_library( chatpcb_native_workspace STATIC
    chatpcb_workspace_panel.cpp
    chatpcb_core_client.cpp
)

target_include_directories( chatpcb_native_workspace
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}
)

target_compile_features( chatpcb_native_workspace
    PUBLIC
        cxx_std_17
)

target_link_libraries( chatpcb_native_workspace
    PUBLIC
        ${wxWidgets_LIBRARIES}
)
