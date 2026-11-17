import React, { useCallback, useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import { AnalyzerView } from './components/AnalyzerView';
import { AuthModal } from './components/AuthModal';
import { ClipEditorView } from './components/ClipEditorView';
import { DashboardView } from './components/DashboardView';
import { DownloadsView } from './components/DownloadsView';
import { LandingPage } from './components/LandingPage';
import { ProjectsView } from './components/ProjectsView';
import { SettingsView } from './components/SettingsView';
import { Sidebar, WorkspaceTab } from './components/Sidebar';
import { TemplatesView } from './components/TemplatesView';
import { AuthProvider, useAuth } from './context/AuthContext';
import type { ClipDTO, ProjectConfig, ProjectDTO } from './shared/types';

function AppShell() {
  const { authFetch, profile, loading, token, startDemoSession, logout } = useAuth();
  const [viewMode, setViewMode] = useState<'landing' | 'workspace'>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('autostart') === '1' ? 'workspace' : 'landing';
  });

  const [activeTab, setActiveTab] = useState<WorkspaceTab>('dashboard');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [pendingYoutubeUrl, setPendingYoutubeUrl] = useState('');
  const [templateConfig, setTemplateConfig] = useState<Partial<ProjectConfig> | null>(null);
  const [editingClip, setEditingClip] = useState<{ clip: ClipDTO; project: ProjectDTO } | null>(
    null
  );
  const [projectRefreshKey, setProjectRefreshKey] = useState(0);

  // Auto-enter workspace if ?autostart=1 or existing authenticated session
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1' && !token && !loading) {
      void startDemoSession().then(() => setViewMode('workspace'));
    }
  }, [token, loading, startDemoSession]);

  const enterWorkspace = useCallback(
    async (tab: WorkspaceTab = 'dashboard', prefillUrl?: string) => {
      if (!token) {
        await startDemoSession();
      }
      if (prefillUrl) {
        setPendingYoutubeUrl(prefillUrl);
        setSelectedProjectId(null);
        setActiveTab('create');
      } else {
        setActiveTab(tab);
      }
      setViewMode('workspace');
    },
    [token, startDemoSession]
  );

  const handleOpenProject = (projectId: number) => {
    setSelectedProjectId(projectId);
    setPendingYoutubeUrl('');
    setEditingClip(null);
    setActiveTab('create');
    setViewMode('workspace');
  };

  const handleEditClipById = useCallback(
    async (clipId: number) => {
      const res = await authFetch(`/api/clips/${clipId}/context`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not load clip for editing.');
      }
      setSelectedProjectId(data.project.id);
      setEditingClip({ clip: data.clip, project: data.project });
      setActiveTab('editor');
      setViewMode('workspace');
    },
    [authFetch]
  );

  if (viewMode === 'landing') {
    return (
      <>
        <LandingPage
          isAuthenticated={Boolean(token)}
          onOpenAuth={() => setAuthModalOpen(true)}
          onEnterStudio={(url) => void enterWorkspace(url ? 'create' : 'dashboard', url)}
        />
        <AuthModal
          open={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          onSuccess={() => setViewMode('workspace')}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#090B10] text-slate-100 flex">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setEditingClip(null);
          if (tab === 'create') {
            setSelectedProjectId(null);
          }
          setActiveTab(tab);
        }}
        onGoLanding={() => setViewMode('landing')}
        profile={profile}
        onOpenAuth={() => setAuthModalOpen(true)}
        onLogout={() => {
          void logout();
          setViewMode('landing');
        }}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Workspace Header */}
        <header className="sticky top-0 z-20 border-b border-white/10 bg-[#090B10]/90 backdrop-blur-md px-5 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 text-slate-300 hover:text-white rounded-lg hover:bg-white/5 cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <p className="hidden sm:block text-xs text-slate-400 truncate">
              ClipGenius Studio <span className="mx-1.5 text-slate-600">/</span>
              <span className="text-slate-200 font-medium capitalize">
                {activeTab === 'create'
                  ? 'Video Analyzer & Clips'
                  : activeTab === 'editor'
                    ? 'Clip Editor'
                    : activeTab}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {profile?.isDemo && (
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                className="px-3 py-1.5 text-xs font-medium text-indigo-300 bg-indigo-600/15 hover:bg-indigo-600/25 border border-indigo-500/30 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
              >
                Sign in with Google to Sync
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setEditingClip(null);
                setSelectedProjectId(null);
                setActiveTab('create');
              }}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
            >
              Create Clips
            </button>
          </div>
        </header>

        <main className="flex-1 p-5 md:p-8 max-w-7xl w-full mx-auto">
          {activeTab === 'dashboard' && (
            <DashboardView
              onStartAnalyzeUrl={(url) => void enterWorkspace('create', url)}
              onStartCreate={() => {
                setSelectedProjectId(null);
                setActiveTab('create');
              }}
              onOpenProject={handleOpenProject}
              onOpenDownloads={() => setActiveTab('downloads')}
            />
          )}

          {activeTab === 'create' && (
            <AnalyzerView
              initialProjectId={selectedProjectId}
              refreshKey={projectRefreshKey}
              initialYoutubeUrl={pendingYoutubeUrl}
              initialTemplateConfig={templateConfig}
              onClearInitialUrl={() => setPendingYoutubeUrl('')}
              onProjectLoaded={(proj) => setSelectedProjectId(proj.id)}
              onEditClip={(clip, project) => {
                setEditingClip({ clip, project });
                setActiveTab('editor');
              }}
            />
          )}

          {activeTab === 'editor' && editingClip && (
            <ClipEditorView
              clip={editingClip.clip}
              project={editingClip.project}
              onBack={() => setActiveTab('create')}
              onClipUpdated={(updated) => {
                setEditingClip((prev) => (prev ? { ...prev, clip: updated } : null));
                setProjectRefreshKey((k) => k + 1);
              }}
            />
          )}

          {activeTab === 'projects' && (
            <ProjectsView
              onOpenProject={handleOpenProject}
              onCreateNew={() => {
                setSelectedProjectId(null);
                setActiveTab('create');
              }}
            />
          )}

          {activeTab === 'templates' && (
            <TemplatesView
              onApplyTemplate={(cfg) => {
                setTemplateConfig(cfg);
                setSelectedProjectId(null);
                setActiveTab('create');
              }}
            />
          )}

          {activeTab === 'downloads' && (
            <DownloadsView
              onOpenProject={handleOpenProject}
              onEditClipById={handleEditClipById}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView onOpenAuth={() => setAuthModalOpen(true)} />
          )}
        </main>
      </div>

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={() => setViewMode('workspace')}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
